'use strict'
/**
 * SkillNet Demo Server
 * In-memory simulation of all three smart contracts:
 *   SkillNFT       — skill registry and ERC-721 ownership
 *   CompositionDAG — dependency graph with cycle detection and max-depth enforcement
 *   FeeRouter      — recursive, depth-weighted fee distribution (pull pattern)
 *
 * HCS-26 Integration (optional):
 *   If demo/.env.hedera is present with valid credentials, each new skill minted
 *   via the API is published to the HCS-26 Discovery Registry on Hedera Testnet.
 *   The HCS-26 sequence number (skill_uid) becomes the authoritative skill ID.
 *   Seeded skills use local auto-increment IDs and are not published to Hedera.
 */
const express = require('express')
const path    = require('path')
const fs      = require('fs')
const crypto  = require('node:crypto')
const { execFileSync } = require('child_process')

const security = require('./security')

// ─── Runtime configuration ───────────────────────────────────────────────────
// AUTH_MODE: 'signature' (default — all writes must be Ed25519-signed) or 'dev'
//            (legacy string-identity behaviour, signatures ignored).
const AUTH_MODE = (process.env.AUTH_MODE || 'signature').toLowerCase() === 'dev' ? 'dev' : 'signature'
const getAuthMode = () => AUTH_MODE

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173,http://localhost:3000')
  .split(',').map(s => s.trim()).filter(Boolean)

const STATE_FILE = process.env.STATE_FILE || path.join(__dirname, 'data', 'state.json')

// ─── Load Hedera env (demo/.env.hedera) if present ───────────────────────────
// Set SKILLNET_SKIP_ENV_FILE=1 to bypass this (e.g. tests that must not touch Hedera/Qwen).
const hederaEnvPath = path.join(__dirname, '.env.hedera')
if (!process.env.SKILLNET_SKIP_ENV_FILE && fs.existsSync(hederaEnvPath)) {
  fs.readFileSync(hederaEnvPath, 'utf8')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('#') && l.includes('='))
    .forEach(l => {
      const idx = l.indexOf('=')
      const key = l.slice(0, idx).trim()
      const val = l.slice(idx + 1).trim()
      if (val && !process.env[key]) process.env[key] = val
    })
}

const hcs26        = require('./hcs26')
const agentNetwork = require('./agent-network')

const app = express()
app.set('trust proxy', true)                 // honour X-Forwarded-For behind Render/Docker proxies
app.use(security.makeCors(ALLOWED_ORIGINS))  // origin allow-list + preflight (incl. x-skillnet-* headers)
// Capture the raw request body so the signature middleware can hash the exact bytes.
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf } }))

// ─── Rate limiting (per-IP token bucket) ─────────────────────────────────────
const generalLimiter   = security.makeRateLimiter('general',   60, 60 * 1000)  // 60 req/min
const expensiveLimiter = security.makeRateLimiter('expensive', 10, 60 * 1000)  // 10 req/min (paid LLM)
app.use('/api', generalLimiter)

// ─── Signature enforcement (writes) ──────────────────────────────────────────
const requireSignature = security.makeSignatureMiddleware(getAuthMode)

// Fallback Ed25519 key used to sign HCS-26 registrations in dev mode when the
// named creator has no seeded keypair (generated once per boot).
let _serverRegistryKey = null
function getServerRegistryKey() {
  if (!_serverRegistryKey) _serverRegistryKey = security.generateCreatorKeypair()
  return _serverRegistryKey
}

/** 403 unless the signed request's pubkey matches the resource's registered creator key. */
function requireOwner(resourcePubKey, req, res) {
  if (AUTH_MODE === 'dev') return true
  if (!resourcePubKey || req.authPubKey !== resourcePubKey) {
    res.status(403).json({ error: 'Signer is not the registered owner of this resource' })
    return false
  }
  return true
}

app.use(express.static(path.join(__dirname, 'public')))

app.get('/healthz', (_req, res) => res.json({ ok: true, authMode: AUTH_MODE, skills: Object.keys(state.skills).length }))

// ─── Fee constants (mirrors FeeRouter.sol / settlement/engine.mjs) ────────────
// Internal money accounting is exact BigInt integer math in "wei" micro-units
// (1 display unit = 1e18 wei), identical to the settlement engine's integer model
// so there is no float dust and conservation holds exactly. API responses still
// return display numbers (wei / 1e18) plus a parallel *Micro string field carrying
// the exact integer for precision consumers.
const PROTOCOL_BPS = 1000n   // 10% protocol fee off the top  (== old PROTOCOL_SHARE 0.10)
const RHO_BPS      = 2000n   // 20% upstream pass-through per composition hop (== old RHO 0.20)
const WEI          = 10n ** 18n
const MAX_DEPTH      = 5
const TIERS          = ['OPEN', 'SHIELDED', 'PRIVATE']

// Loaded asynchronously at boot from the vendored settlement engine (demo/settlement/
// engine.mjs — the copy that ships in the Docker build context). See the async boot
// block at the bottom of this file.
let SettlementEngine = null

/** Expand a JS number to a plain (non-exponential) decimal string via its shortest
 *  round-trip form, so 0.015 → "0.015" (NOT "0.0149999…" that toFixed(18) would give). */
function numToDecimalString(n) {
  let s = String(n)
  if (!/e/i.test(s)) return s
  let sign = ''
  if (s.startsWith('-')) { sign = '-'; s = s.slice(1) }
  const [mant, expStr] = s.split(/e/i)
  const exp = parseInt(expStr, 10)
  const [i, f = ''] = mant.split('.')
  const digits = i + f
  const pointPos = i.length + exp
  if (pointPos <= 0)                 return sign + '0.' + '0'.repeat(-pointPos) + digits
  if (pointPos >= digits.length)     return sign + digits + '0'.repeat(pointPos - digits.length)
  return sign + digits.slice(0, pointPos) + '.' + digits.slice(pointPos)
}

/** Exact decimal → BigInt wei conversion (18 decimals). No float dust for demo prices. */
function toWei(value) {
  if (typeof value === 'bigint') return value
  if (value == null) return 0n
  const raw = typeof value === 'number' ? numToDecimalString(value) : String(value).trim()
  const neg = raw.startsWith('-')
  const [intPart, fracPart = ''] = raw.replace(/^-/, '').split('.')
  const frac = (fracPart + '0'.repeat(18)).slice(0, 18)   // pad/truncate to 18 decimals
  const w = BigInt(intPart || '0') * WEI + BigInt(frac || '0')
  return neg ? -w : w
}

/** BigInt wei → display number (wei / 1e18). Lossy for display only; balances stay exact. */
function fromWei(wei) {
  return Number(typeof wei === 'bigint' ? wei : toWei(wei)) / 1e18
}

// ─── In-memory state ──────────────────────────────────────────────────────────
const state = {
  nextId:   1,
  skills:   {},    // id -> SkillMetadata
  deps:     {},    // childId  -> [{parentSkillId, weight}]
  depOf:    {},    // parentId -> [childId]
  depth:    {},    // skillId  -> depth in DAG (0 = leaf)
  balances: { treasury: 0n, deployer: 0n, alice: 0n, bob: 0n, carol: 0n },  // BigInt wei — exact, withdrawable
  txLog:    [],
  creators: {},    // name -> { pubKey (base64url raw), privJwk } — Ed25519 identity per seeded creator
  settlements: [], // on-chain settlement receipts (newest first, cap 50) — set by the settlement gateway
}

// Settlement gateway (settlement/gateway.mjs) — the on-chain shadow. Constructed in the async
// boot block AFTER state is restored/seeded, so it captures the final skills/deps references and
// excludes the pre-boot seed call history. Stays null until then; all touch-points guard on it.
let gateway = null

// ─────────────────────────────────────────────────────────────────────────────
// SkillNFT
// ─────────────────────────────────────────────────────────────────────────────

/** Mint a skill using the next auto-increment ID (used by seed + non-Hedera path) */
function mintSkill({ name, description, skillType, tier, pricePerCall = 0, creator = 'deployer', previousVersion = 0 }) {
  const id = state.nextId++
  mintSkillWithId(id, { name, description, skillType, tier, pricePerCall, creator, previousVersion })
  return id
}

/** Mint a skill using a supplied ID; optional hcs26_uid stores the Hedera sequence number */
function mintSkillWithId(id, { name, description, skillType, tier, pricePerCall = 0, creator = 'deployer', creatorPubKey = null, previousVersion = 0, hcs26_uid, status = 'approved', scores = null } = {}) {
  // Fall back to a seeded creator's registered key when one isn't supplied explicitly.
  if (!creatorPubKey && state.creators[creator]) creatorPubKey = state.creators[creator].pubKey
  state.skills[id] = {
    id, name, description, skillType, tier, pricePerCall,
    creator, creatorPubKey, version: id, previousVersion,
    totalCalls: 0, totalRevenue: 0,
    createdAt: new Date().toISOString(),
    status,
    scores,
    ...(hcs26_uid != null ? { hcs26_uid } : {}),
  }
  state.deps[id]  = []
  state.depOf[id] = []
  state.depth[id] = 0
}

function upgradeTier(skillId, newTier, caller) {
  const skill = state.skills[skillId]
  if (!skill)                                       throw new Error('Skill not found')
  if (skill.creator !== caller)                     throw new Error('Not the skill owner')
  if (TIERS.indexOf(newTier) >= TIERS.indexOf(skill.tier)) throw new Error('Can only upgrade to a more public tier (PRIVATE→SHIELDED→OPEN)')
  skill.tier = newTier
}

// ─────────────────────────────────────────────────────────────────────────────
// CompositionDAG
// ─────────────────────────────────────────────────────────────────────────────

/** BFS ancestor check — returns true if `target` is reachable from `start` via its deps */
function isAncestor(start, target) {
  const queue   = (state.deps[start] || []).map(d => d.parentSkillId)
  const visited = new Set()
  while (queue.length) {
    const cur = queue.shift()
    if (cur === target) return true
    if (visited.has(cur)) continue
    visited.add(cur)
    ;(state.deps[cur] || []).forEach(d => queue.push(d.parentSkillId))
  }
  return false
}

function compose(childId, parentIds, weights, caller) {
  const child = state.skills[childId]
  if (!child)                                throw new Error('Child skill not found')
  if (child.creator !== caller)              throw new Error('Not the skill owner')
  if (state.deps[childId].length > 0)        throw new Error('Already composed')
  if (!parentIds.length)                     throw new Error('Must provide at least one parent')
  if (parentIds.length !== weights.length)   throw new Error('parentIds and weights length mismatch')

  const sum = weights.reduce((a, b) => a + b, 0)
  if (sum !== 100) throw new Error(`Weights must sum to 100 (got ${sum})`)

  let maxParentDepth = 0
  for (let i = 0; i < parentIds.length; i++) {
    const pid = parentIds[i]
    if (pid === childId)                          throw new Error('Self-reference not allowed')
    if (!state.skills[pid])                       throw new Error(`Parent skill #${pid} not found`)
    if (weights[i] <= 0)                          throw new Error('Each weight must be > 0')
    if (parentIds.slice(0, i).includes(pid))      throw new Error(`Duplicate parent #${pid}`)
    if (isAncestor(pid, childId))                 throw new Error(`Cycle detected: #${childId} is already an ancestor of #${pid}`)
    if (state.depth[pid] > maxParentDepth) maxParentDepth = state.depth[pid]
  }

  const childDepth = maxParentDepth + 1
  if (childDepth > MAX_DEPTH) throw new Error(`Max depth ${MAX_DEPTH} exceeded (would be depth ${childDepth})`)

  for (let i = 0; i < parentIds.length; i++) {
    state.deps[childId].push({ parentSkillId: parentIds[i], weight: weights[i] })
    state.depOf[parentIds[i]].push(childId)
  }
  state.depth[childId] = childDepth
}

// ─────────────────────────────────────────────────────────────────────────────
// FeeRouter
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Conserving weight-proportional royalty walk in BigInt wei — byte-for-byte the same
 * integer semantics as SettlementEngine._royalty / FeeRouter._royalty. Produces a
 * depth-aware log (for the human-readable tx breakdown); it does NOT mutate balances.
 * A leaf credits its creator the full amount; a composite passes `amount * RHO` upstream
 * (split by edge weight) and keeps `amount - distributed` (which absorbs any integer-
 * division dust, so the walk conserves exactly for ANY DAG shape).
 */
function royaltyWalk(skillId, amountWei, depth, log, inWeight) {
  const skill = state.skills[skillId]
  const edges = state.deps[skillId] || []
  if (!edges.length) {
    log.push({ skillId, skillName: skill.name, creator: skill.creator, amount: amountWei, weight: inWeight, depth })
    return
  }
  const passUp = (amountWei * RHO_BPS) / 10000n
  let distributed = 0n
  for (const edge of edges) {
    const share = (passUp * BigInt(edge.weight)) / 100n
    royaltyWalk(edge.parentSkillId, share, depth + 1, log, edge.weight)
    distributed += share
  }
  log.push({ skillId, skillName: skill.name, creator: skill.creator, amount: amountWei - distributed, weight: inWeight, depth })
}

/**
 * Accrue one paid call. All money math is exact BigInt wei, computed by the vendored
 * SettlementEngine (the same engine the on-chain SettlementVault batches verify), so the
 * demo's off-chain accounting is identical to the canonical engine. Balances are credited
 * from the engine's per-recipient accrual map; a parallel royaltyWalk produces the display
 * breakdown. A runtime conservation guard asserts credited == value before persisting.
 */
function payForCall(skillId, value, caller) {
  const skill = state.skills[skillId]
  if (!skill) throw new Error('Skill not found')
  if (!SettlementEngine) throw new Error('Settlement engine not loaded yet')

  const valueWei = toWei(value)

  skill.totalCalls++
  skill.totalRevenue += value    // display-only running total (unchanged semantics)

  // Canonical distribution: fresh engine fed exactly this one call. engine.accrued is the
  // authoritative per-recipient credit map (creators + 'treasury').
  const engine = new SettlementEngine(state.skills, state.deps)
  engine.recordCall(skillId, valueWei, caller)

  let engineTotal = 0n
  for (const [recipient, amtWei] of engine.accrued) {
    state.balances[recipient] = (state.balances[recipient] || 0n) + amtWei
    engineTotal += amtWei
  }
  // Conservation guard — everything credited this call must equal the price, exactly.
  if (engineTotal !== valueWei) {
    throw new Error(`conservation broken: credited=${engineTotal} value=${valueWei}`)
  }
  const protocolWei = engine.accrued.get('treasury') || 0n

  // Display breakdown via the identical BigInt walk over the net (post-protocol) amount.
  const royaltyLog = []
  royaltyWalk(skillId, valueWei - protocolWei, 1, royaltyLog, 100)
  const top = royaltyLog.find(e => e.skillId === skillId && e.depth === 1)
  const creatorTotalWei = top ? top.amount : 0n
  const upstream = royaltyLog
    .filter(e => !(e.skillId === skillId && e.depth === 1))
    .map(e => ({ skillId: e.skillId, skillName: e.skillName, creator: e.creator, amount: fromWei(e.amount), amountMicro: e.amount.toString(), weight: e.weight, depth: e.depth }))

  const tx = {
    id:        Date.now(),
    ts:        new Date().toISOString(),
    type:      'CALL',
    skillId,
    skillName: skill.name,
    caller,
    value,
    valueMicro: valueWei.toString(),
    breakdown: {
      protocol:        fromWei(protocolWei),
      protocolMicro:   protocolWei.toString(),
      creatorTotal:    fromWei(creatorTotalWei),
      creatorTotalMicro: creatorTotalWei.toString(),
      upstream,
    },
  }
  state.txLog.unshift(tx)

  // Feed the on-chain shadow engine (additive; does NOT touch state.balances above). Then a
  // fire-and-forget threshold settle. Guarded on `gateway` so pre-boot seed calls are excluded.
  if (gateway) gateway.onCall(skillId, valueWei, caller)

  return tx
}

function withdraw(user) {
  const amount = state.balances[user] || 0n
  if (amount <= 0n) throw new Error('Nothing to withdraw')
  state.balances[user] = 0n
  const tx = { id: Date.now(), ts: new Date().toISOString(), type: 'WITHDRAW', user, amount: fromWei(amount), amountMicro: amount.toString() }
  state.txLog.unshift(tx)
  return tx
}

// ─────────────────────────────────────────────────────────────────────────────
// Persistence — debounced atomic JSON snapshot of `state`
// ─────────────────────────────────────────────────────────────────────────────
//
// `state` is mostly JSON-serialisable (plain objects/arrays/numbers/strings). Two
// exceptions are handled here:
//   • state.balances values are BigInt wei — encoded as decimal STRINGS on write and
//     decoded back to BigInt on load (old float snapshots migrate via toWei on load).
//   • state.creators values hold a private JWK; private keys are persisted ONLY in dev
//     mode (so seeded creators survive a restart for local impersonation), else stripped.

function serializeState() {
  const creators = {}
  for (const [name, c] of Object.entries(state.creators)) {
    creators[name] = AUTH_MODE === 'dev'
      ? { pubKey: c.pubKey, privJwk: c.privJwk }
      : { pubKey: c.pubKey }
  }
  const balances = {}
  for (const [name, v] of Object.entries(state.balances)) {
    balances[name] = (typeof v === 'bigint' ? v : toWei(v)).toString()   // BigInt wei → decimal string
  }
  // Additive settlement keys (old snapshots without them still load fine):
  //   settlement  — the gateway engine's cumulative + current-window state (all BigInts as strings)
  //   settlements — on-chain settlement receipts (already plain/string-encoded)
  const settlement = gateway ? gateway.serializeEngine() : (state._settlementRaw || undefined)
  return JSON.stringify({
    nextId:   state.nextId,
    skills:   state.skills,
    deps:     state.deps,
    depOf:    state.depOf,
    depth:    state.depth,
    balances,
    txLog:    state.txLog,
    creators,
    settlement,
    settlements: state.settlements || [],
  })
}

/** Decode a persisted balances object into BigInt wei, migrating old float snapshots. */
function decodeBalances(raw) {
  const out = {}
  for (const [name, v] of Object.entries(raw || {})) {
    if (typeof v === 'string')      out[name] = BigInt(v)     // new format: decimal wei string
    else if (typeof v === 'bigint') out[name] = v
    else if (typeof v === 'number') out[name] = toWei(v)      // legacy float snapshot → micro-units
    else                            out[name] = 0n
  }
  return out
}

let _saveTimer = null
/** Debounce ~1s, then write atomically (tmp + rename). */
function scheduleSave() {
  if (_saveTimer) return
  _saveTimer = setTimeout(() => {
    _saveTimer = null
    try {
      fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true })
      const tmp = STATE_FILE + '.tmp'
      fs.writeFileSync(tmp, serializeState())
      fs.renameSync(tmp, STATE_FILE)
    } catch (e) {
      console.error('  ⚠ state snapshot failed:', e.message)
    }
  }, 1000)
}

/** Load a snapshot into `state`. Returns true if a snapshot existed and loaded. */
function loadState() {
  if (!fs.existsSync(STATE_FILE)) return false
  try {
    const snap = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'))
    state.nextId   = snap.nextId   ?? state.nextId
    state.skills   = snap.skills   || {}
    state.deps     = snap.deps     || {}
    state.depOf    = snap.depOf    || {}
    state.depth    = snap.depth    || {}
    state.balances = snap.balances ? decodeBalances(snap.balances) : state.balances
    state.txLog    = snap.txLog    || []
    state.creators = snap.creators || {}
    state.settlements    = snap.settlements || []   // on-chain settlement receipts
    state._settlementRaw = snap.settlement  || null // consumed by gateway.hydrate() after construction
    return true
  } catch (e) {
    console.error('  ⚠ failed to load state snapshot, re-seeding:', e.message)
    return false
  }
}

/** Ensure every named creator has an Ed25519 identity (generated per-boot at seed time). */
function ensureCreatorKeys(names) {
  for (const name of names) {
    if (!state.creators[name]) state.creators[name] = security.generateCreatorKeypair()
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed — 9 skills (matches the original plan + save-hello)
// ─────────────────────────────────────────────────────────────────────────────

function seed() {
  // Generate deterministic-per-boot Ed25519 identities for the demo creators.
  ensureCreatorKeys(['deployer', 'alice', 'bob', 'carol'])

  // 1 — JSON Parser
  mintSkillWithId(state.nextId++, {
    name: 'JSON Parser', description: 'Parses and validates JSON payloads, extracts nested fields by path, and normalizes structures for downstream consumption.',
    skillType: 'TOOL_ADAPTER', tier: 'OPEN', pricePerCall: 0, creator: 'alice',
    scores: { schema: 92, discover: 78, callable: 95, success: 88, percentile: 82 },
  })
  // 2 — Web Scraper
  mintSkillWithId(state.nextId++, {
    name: 'Web Scraper', description: 'Fetches and extracts structured content from web pages using CSS selectors and headless rendering.',
    skillType: 'TOOL_ADAPTER', tier: 'OPEN', pricePerCall: 0, creator: 'bob',
    scores: { schema: 85, discover: 72, callable: 88, success: 79, percentile: 71 },
  })
  // 3 — Sentiment Analyzer
  mintSkillWithId(state.nextId++, {
    name: 'Sentiment Analyzer', description: 'Analyzes text sentiment using LLM chain-of-thought, returns polarity score and confidence with entity-level breakdown.',
    skillType: 'PROMPT_WORKFLOW', tier: 'SHIELDED', pricePerCall: 0.001, creator: 'carol',
    scores: { schema: 88, discover: 85, callable: 82, success: 73, percentile: 84 },
  })
  // 4 — Solidity Auditor
  mintSkillWithId(state.nextId++, {
    name: 'Solidity Auditor', description: 'Evaluates Solidity smart contracts for reentrancy, overflow, access control, and gas optimization issues.',
    skillType: 'EVAL_PIPELINE', tier: 'SHIELDED', pricePerCall: 0.005, creator: 'alice',
    scores: { schema: 91, discover: 89, callable: 86, success: 81, percentile: 90 },
  })
  // 5 — Medical Diagnosis
  mintSkillWithId(state.nextId++, {
    name: 'Medical Diagnosis', description: 'Preliminary symptom analysis and differential diagnosis assistant for healthcare professionals.',
    skillType: 'AGENT_BEHAVIOR', tier: 'PRIVATE', pricePerCall: 0.01, creator: 'bob',
    scores: { schema: 78, discover: 65, callable: 71, success: 68, percentile: 62 },
  })
  // 6 — Data Pipeline (composed: 1+2)
  mintSkillWithId(state.nextId++, {
    name: 'Data Pipeline', description: 'End-to-end data ingestion: scrapes web sources, parses JSON responses, and normalizes into a unified schema.',
    skillType: 'COMPOSITE_BUNDLE', tier: 'OPEN', pricePerCall: 0.001, creator: 'carol',
    scores: { schema: 87, discover: 80, callable: 90, success: 82, percentile: 78 },
  })
  compose(6, [1, 2], [40, 60], 'carol')
  // 7 — DeFi Research Agent (composed: 3+4)
  mintSkillWithId(state.nextId++, {
    name: 'DeFi Research Agent', description: 'Researches DeFi protocols by combining sentiment analysis with smart contract security evaluation.',
    skillType: 'COMPOSITE_BUNDLE', tier: 'SHIELDED', pricePerCall: 0.008, creator: 'alice',
    scores: { schema: 83, discover: 81, callable: 79, success: 75, percentile: 80 },
  })
  compose(7, [3, 4], [50, 50], 'alice')
  // 8 — Full Audit Suite (composed: 6+7+5)
  mintSkillWithId(state.nextId++, {
    name: 'Full Audit Suite', description: 'Comprehensive audit pipeline: data collection, DeFi research, sentiment scoring, Solidity review, and risk assessment.',
    skillType: 'COMPOSITE_BUNDLE', tier: 'SHIELDED', pricePerCall: 0.015, creator: 'bob',
    scores: { schema: 86, discover: 84, callable: 82, success: 78, percentile: 85 },
  })
  compose(8, [6, 7, 5], [33, 33, 34], 'bob')

  // Pre-seed call history: 10 calls to Full Audit Suite, 5 to Sentiment Analyzer
  for (let i = 0; i < 10; i++) {
    const callers = ['dave', 'eve', 'frank', 'grace', 'heidi']
    payForCall(8, 0.015, callers[i % callers.length])
  }
  for (let i = 0; i < 5; i++) {
    payForCall(3, 0.001, ['dave', 'eve', 'frank'][i % 3])
  }

  console.log(`  ✓ Seeded 8 skills (5 base + 3 composed) with call history`)
}

// Boot (engine import → restore/seed → listen) runs in the async IIFE at the bottom
// of this file, because the settlement engine is an ESM module loaded via import().

// ─────────────────────────────────────────────────────────────────────────────
// REST API
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/state', (_req, res) => {
  // Balances are exact BigInt wei internally; expose display numbers (wei/1e18) for
  // backward compatibility plus a parallel balancesMicro string map for precision.
  const balances = {}, balancesMicro = {}
  for (const [name, v] of Object.entries(state.balances)) {
    const wei = typeof v === 'bigint' ? v : toWei(v)
    balances[name]      = fromWei(wei)
    balancesMicro[name] = wei.toString()
  }
  res.json({
    skills:   Object.values(state.skills),
    balances,
    balancesMicro,
    txLog:    state.txLog.slice(0, 50),
  })
})

/** Build a recursive tree for the DAG visualizer */
function buildTree(id) {
  const s = state.skills[id]
  if (!s) return null
  return {
    id, name: s.name, tier: s.tier, creator: s.creator, depth: state.depth[id],
    children: (state.deps[id] || []).map(e => ({ weight: e.weight, ...buildTree(e.parentSkillId) })),
  }
}
app.get('/api/dag/:id', (req, res) => res.json(buildTree(+req.params.id)))

app.post('/api/mint', requireSignature, async (req, res) => {
  try {
    // In signature mode you may only mint under your own key.
    if (AUTH_MODE !== 'dev') {
      if (!req.body.creatorPubKey) return res.status(400).json({ error: 'creatorPubKey required' })
      if (req.body.creatorPubKey !== req.authPubKey) {
        return res.status(403).json({ error: 'creatorPubKey must match the signing key' })
      }
    }
    // Local ID always comes from the auto-increment counter
    const id = state.nextId++
    let hcs26_uid = null

    if (hcs26.isConfigured()) {
      // Publish to Hedera asynchronously; skill_uid is the HCS-2 sequence number
      try {
        // Bind the registration to content + creator identity. In signature mode
        // the client signs the manifest (registrySignature); in dev mode a
        // server-held key (the seeded creator's, else a per-boot registry key) signs.
        const contentHash = hcs26.contentHashOf(req.body)
        let registryPubKey, registrySignature
        if (AUTH_MODE === 'dev') {
          const signer = state.creators[req.body.creator] || getServerRegistryKey()
          registryPubKey    = signer.pubKey
          registrySignature = security.signEd25519(signer.privJwk, hcs26.registrySigningMessage(contentHash, req.body.name))
        } else {
          registryPubKey    = req.body.creatorPubKey
          registrySignature = req.body.registrySignature
          if (!hcs26.verifyRegistrationSignature(contentHash, req.body.name, registryPubKey, registrySignature)) {
            return res.status(400).json({ error: 'Invalid or missing registrySignature for HCS-26 publish' })
          }
        }

        const versionTopicId = await hcs26.createVersionRegistryTopic(req.body.name)
        hcs26_uid = await hcs26.publishSkill(req.body, versionTopicId, { creatorPubKey: registryPubKey, signature: registrySignature })

        // Fire-and-forget: publish version entry to the per-skill version registry
        hcs26.publishVersion(versionTopicId, {
          skill_uid: hcs26_uid,
          version: '1.0.0',
          manifestTopicId: versionTopicId,
          status: 'active',
        }).catch(err => console.error('  HCS-26 version publish failed:', err.message))

        console.log(`  HCS-26: registered skill_uid=${hcs26_uid} (local id=${id}) "${req.body.name}"`)
      } catch (hcsErr) {
        console.error(`  HCS-26 publish failed (local-only): ${hcsErr.message}`)
      }
    }

    mintSkillWithId(id, { ...req.body, hcs26_uid, status: req.body.status || 'pending', scores: req.body.scores || null })
    scheduleSave()
    res.json({ success: true, id, hcs26: hcs26.isConfigured(), hcs26_uid })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/api/compose', requireSignature, (req, res) => {
  try {
    const { childId, parentIds, weights } = req.body
    const child = state.skills[childId]
    if (!child) return res.status(404).json({ error: 'Child skill not found' })
    if (!requireOwner(child.creatorPubKey, req, res)) return
    // In signature mode ownership is proven by the key; satisfy the domain string check with the owner.
    const caller = AUTH_MODE === 'dev' ? req.body.caller : child.creator
    compose(childId, parentIds, weights, caller)
    scheduleSave()
    res.json({ success: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

/** Build a nested execution trace for a skill call (walks DAG) */
function buildExecutionTrace(skillId) {
  const skill = state.skills[skillId]
  if (!skill) return null
  const edges = state.deps[skillId] || []
  const subCalls = edges.map(e => {
    const sub = buildExecutionTrace(e.parentSkillId)
    return sub
  }).filter(Boolean)
  return {
    skillId,
    name: skill.name,
    tier: skill.tier,
    time: subCalls.length ? subCalls.reduce((s, c) => s + c.time, 0) + 100 + Math.floor(Math.random() * 200)
      : 200 + Math.floor(Math.random() * 800),
    ...(subCalls.length ? { subCalls } : {}),
  }
}

/**
 * Build the detailed fee-distribution object for a call (preview — does not modify balances).
 * Uses the exact BigInt royaltyWalk, then converts to display numbers for the UI. Keys are
 * "Skill (creator)" → display amount; plus a "Protocol treasury" entry.
 */
function buildFeeDistribution(skillId, value) {
  const skill = state.skills[skillId]
  if (!skill) return {}
  const valueWei    = toWei(value)
  const protocolWei = (valueWei * PROTOCOL_BPS) / 10000n
  const netWei      = valueWei - protocolWei

  const items = []
  royaltyWalk(skillId, netWei, 1, items, 100)
  const acc = {}
  for (const item of items) {
    const key = `${item.skillName} (${item.creator})`
    acc[key] = (acc[key] || 0n) + item.amount
  }
  const result = {}
  for (const [key, wei] of Object.entries(acc)) result[key] = fromWei(wei)
  result['Protocol treasury'] = fromWei(protocolWei)   // 100% to treasury (mirrors FeeRouter.sol)
  return result
}

app.post('/api/call/:id', expensiveLimiter, requireSignature, async (req, res) => {
  try {
    const skill  = state.skills[+req.params.id]
    if (!skill) return res.status(404).json({ error: 'Skill not found' })
    const value  = req.body.value ?? skill.pricePerCall ?? 0
    const caller = req.body.caller || 'user'
    const input  = req.body.input || ''
    // Payment floor — mirrors FeeRouter.sol `require(msg.value >= skill.pricePerCall)`.
    // Compare in exact BigInt wei (never floats) so no rounding lets an underpayment slip
    // through. Overpay stays allowed; a price-0 skill is legitimately called with value 0.
    if (toWei(value) < toWei(skill.pricePerCall ?? 0)) {
      return res.status(400).json({ error: `Insufficient payment: skill price is ${skill.pricePerCall ?? 0}` })
    }
    const tx     = payForCall(+req.params.id, value, caller)
    scheduleSave()

    // Actually execute the save-hello skill when it's called
    if (skill.name === 'save-hello') {
      const skillPath = path.join(__dirname, '..', 'skills', 'save-hello', 'skill.js')
      try { execFileSync('node', [skillPath]); tx.fileWritten = true }
      catch { tx.fileWritten = false }
    }

    // Build execution trace for composed skills
    const execution = buildExecutionTrace(+req.params.id)
    const feeDistribution = buildFeeDistribution(+req.params.id, value)

    // If input is provided and Qwen is available, call LLM
    let result = null
    if (input && agentNetwork) {
      try {
        const qwenResult = await agentNetwork.__callQwen(
          `You are the "${skill.name}" AI skill. ${skill.description}\n\nProvide a detailed, structured JSON response.`,
          input
        )
        // Try to parse as JSON, otherwise wrap as text
        try { result = JSON.parse(qwenResult.content.replace(/^```json\n?/i, '').replace(/```$/, '').trim()) }
        catch { result = { response: qwenResult.content } }
      } catch (e) {
        result = { response: `[Simulated] Analysis of "${input}" using ${skill.name}`, note: 'Qwen API not available — showing simulated result' }
      }
    }

    res.json({ success: true, tx, result, execution, feeDistribution })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/api/withdraw', requireSignature, (req, res) => {
  try {
    const user = req.body.user
    // Balance ownership: the withdrawable balance for a creator name is owned by that
    // creator's registered Ed25519 key (state.creators[name].pubKey). In signature mode
    // only that key may withdraw it (treasury/unknown names have no key → 403). Dev mode
    // keeps the legacy unsigned behaviour.
    if (!requireOwner(state.creators[user]?.pubKey, req, res)) return
    const tx = withdraw(user)
    scheduleSave()
    res.json({ success: true, tx })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ─── Settlement gateway endpoints ─────────────────────────────────────────────

/**
 * Manual / cron settle trigger. Signature-gated in signature mode (same as other writes).
 * Safe by construction: the gateway enforces its own mutex + min-interval. External cron can
 * hit this to wake a sleeping Render instance and flush the batch.
 */
app.post('/api/settle', requireSignature, async (req, res) => {
  try {
    if (!gateway) return res.json({ enabled: false })
    const result = await gateway.settle()
    scheduleSave()
    res.json(result)
  } catch (e) { res.status(400).json({ error: e.message }) }
})

/** Public read: gateway status + pending accrual + recent on-chain settlement receipts. */
app.get('/api/settlements', (_req, res) => {
  if (!gateway) return res.json({ enabled: false })
  res.json(gateway.publicStatus())
})

app.post('/api/upgrade-tier', requireSignature, (req, res) => {
  try {
    const skill = state.skills[+req.body.skillId]
    if (!skill) return res.status(404).json({ error: 'Skill not found' })
    if (!requireOwner(skill.creatorPubKey, req, res)) return
    const caller = AUTH_MODE === 'dev' ? req.body.caller : skill.creator
    upgradeTier(+req.body.skillId, req.body.newTier, caller)
    scheduleSave()
    res.json({ success: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ─── Validation + Approval endpoints ─────────────────────────────────────────

app.post('/api/validate/:id', expensiveLimiter, requireSignature, async (req, res) => {
  const skill = state.skills[+req.params.id]
  if (!skill) return res.status(404).json({ error: 'Skill not found' })

  // Try Qwen LLM for real scoring
  let baseScores = { schema: 82, discover: 76, callable: 84, success: 75, percentile: 78 }
  let testScenario = `Test the ${skill.name} skill with a representative input`
  let suggestion = 'Add more descriptive parameter names for better auto-fill success'

  try {
    const prompt = `You are evaluating an AI skill for quality.\nSkill name: ${skill.name}\nDescription: ${skill.description}\nType: ${skill.skillType}\nTier: ${skill.tier}\n\nRate this skill on 5 dimensions (0-100):\n1. schema (well-formed params, defaults, naming)\n2. discover (description clarity, semantic precision)\n3. callable (can an agent fill params without extra info?)\n4. success (estimate based on description quality)\n5. percentile (relative to similar tools)\n\nAlso provide:\n- testScenario: a test scenario you would use\n- suggestion: one specific improvement suggestion\n\nReturn JSON only: {"schema":N,"discover":N,"callable":N,"success":N,"percentile":N,"testScenario":"...","suggestion":"..."}`
    const qwenResult = await agentNetwork.__callQwen('You are an AI skill quality evaluator. Return valid JSON only, no markdown.', prompt)
    const parsed = JSON.parse(qwenResult.content.replace(/^```json\n?/i, '').replace(/```$/, '').trim())
    baseScores = {
      schema:     Math.min(100, Math.max(0, parsed.schema || 80)),
      discover:   Math.min(100, Math.max(0, parsed.discover || 75)),
      callable:   Math.min(100, Math.max(0, parsed.callable || 80)),
      success:    Math.min(100, Math.max(0, parsed.success || 70)),
      percentile: Math.min(100, Math.max(0, parsed.percentile || 75)),
    }
    testScenario = parsed.testScenario || testScenario
    suggestion = parsed.suggestion || suggestion
  } catch (e) {
    console.warn('  Qwen validation call failed, using defaults:', e.message)
  }

  // Generate 3 validator reports with variance
  function vary(score, lo, hi) { return Math.min(100, Math.max(0, score + lo + Math.floor(Math.random() * (hi - lo + 1)))) }
  const validators = [
    {
      nodeId: 'node-alpha', stake: 0.1,
      scores: {
        schema: vary(baseScores.schema, -3, 5), discover: vary(baseScores.discover, -4, 3),
        callable: vary(baseScores.callable, -2, 4), success: vary(baseScores.success, -5, 3),
        percentile: vary(baseScores.percentile, -3, 4),
      },
    },
    {
      nodeId: 'node-beta', stake: 0.1,
      scores: {
        schema: vary(baseScores.schema, -8, 5), discover: vary(baseScores.discover, -6, 4),
        callable: vary(baseScores.callable, -5, 6), success: vary(baseScores.success, -8, 5),
        percentile: vary(baseScores.percentile, -7, 5),
      },
    },
    {
      nodeId: 'node-gamma', stake: 0.1,
      scores: {
        schema: vary(baseScores.schema, -4, 8), discover: vary(baseScores.discover, -3, 7),
        callable: vary(baseScores.callable, -4, 8), success: vary(baseScores.success, -4, 8),
        percentile: vary(baseScores.percentile, -4, 6),
      },
    },
  ]

  // Consensus = median of each dimension
  function median3(a, b, c) { return [a, b, c].sort((x, y) => x - y)[1] }
  const consensus = {
    schema:     median3(validators[0].scores.schema, validators[1].scores.schema, validators[2].scores.schema),
    discover:   median3(validators[0].scores.discover, validators[1].scores.discover, validators[2].scores.discover),
    callable:   median3(validators[0].scores.callable, validators[1].scores.callable, validators[2].scores.callable),
    success:    median3(validators[0].scores.success, validators[1].scores.success, validators[2].scores.success),
    percentile: median3(validators[0].scores.percentile, validators[1].scores.percentile, validators[2].scores.percentile),
  }
  consensus.composite = Math.round((consensus.schema + consensus.discover + consensus.callable + consensus.success + consensus.percentile) / 5)
  consensus.approved = consensus.composite >= 50

  // Max deviation check
  let maxDeviation = 0
  for (const v of validators) {
    for (const dim of ['schema', 'discover', 'callable', 'success', 'percentile']) {
      maxDeviation = Math.max(maxDeviation, Math.abs(v.scores[dim] - consensus[dim]))
    }
  }

  res.json({
    validators,
    consensus: { ...consensus, maxDeviation },
    diagnostic: { testScenario, suggestion, responseTime: (1.5 + Math.random() * 2).toFixed(1) + 's' },
  })
})

// Approval is a network/validator governance action, not an owner action: require a
// valid signature (authenticated identity) but not skill ownership. Dev mode is open.
app.post('/api/approve/:id', requireSignature, (req, res) => {
  const skill = state.skills[+req.params.id]
  if (!skill) return res.status(404).json({ error: 'Skill not found' })
  skill.status = 'approved'
  if (req.body.scores) {
    skill.scores = req.body.scores
  }
  scheduleSave()
  res.json({ success: true, id: +req.params.id })
})

app.post('/api/reject/:id', requireSignature, (req, res) => {
  const skill = state.skills[+req.params.id]
  if (!skill) return res.status(404).json({ error: 'Skill not found' })
  skill.status = 'rejected'
  scheduleSave()
  res.json({ success: true, id: +req.params.id })
})

// ─── Dev-only: expose seeded creator keypairs so the local UI can impersonate ─
app.get('/api/dev/keys', (_req, res) => {
  if (AUTH_MODE !== 'dev') return res.status(403).json({ error: 'Only available when AUTH_MODE=dev' })
  const out = {}
  for (const [name, c] of Object.entries(state.creators)) out[name] = { pubKey: c.pubKey, privJwk: c.privJwk }
  res.json(out)
})

// ─── HCS-26 endpoints ─────────────────────────────────────────────────────────

/** Return all skills registered on the Hedera HCS-26 Discovery Registry */
app.get('/api/hcs26/skills', async (_req, res) => {
  if (!hcs26.isConfigured()) {
    return res.status(503).json({ error: 'HCS-26 not configured (set HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY, HCS26_DISCOVERY_TOPIC in .env.hedera)' })
  }
  try {
    const skills = await hcs26.fetchRegisteredSkills()
    res.json({
      skills,
      count:         skills.length,
      verifiedCount: skills.filter(s => s.verified).length,
      topic:         process.env.HCS26_DISCOVERY_TOPIC,
    })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

/** Return HCS-26 connection status */
app.get('/api/hcs26/status', (_req, res) => {
  res.json({
    configured:      hcs26.isConfigured(),
    account_id:      process.env.HEDERA_ACCOUNT_ID || null,
    discovery_topic: process.env.HCS26_DISCOVERY_TOPIC || null,
    mirror_node:     'https://testnet.mirrornode.hedera.com',
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Agent Network API  (simulated ERC-8004 + x402)
// ─────────────────────────────────────────────────────────────────────────────

/** List all registered agents */
app.get('/api/agents', (_req, res) => {
  res.json({ agents: agentNetwork.listAgents() })
})

/** Agent invocation log — must be before /:id to avoid param capture */
app.get('/api/agents/log', (_req, res) => {
  res.json({ log: agentNetwork.getLog(50) })
})

/** Agent balances — must be before /:id */
app.get('/api/agents/balances', (_req, res) => {
  res.json({ balances: agentNetwork.getBalances() })
})

/** ERC-8004 metadata for a single agent (the metadataURI endpoint) */
app.get('/api/agents/:id', (req, res) => {
  const a = agentNetwork.getAgent(+req.params.id)
  if (!a) return res.status(404).json({ error: 'Agent not found' })
  res.json(a)
})

/** Register a new agent (ERC-8004 mint) — authenticated; binds ownerPubKey to the signer. */
app.post('/api/agents/register', requireSignature, (req, res) => {
  try {
    // In signature mode the agent's owning key is the signer (so only they can later
    // pause/revoke it via /status). Dev mode keeps the legacy free-form ownerPubKey.
    const ownerPubKey = AUTH_MODE === 'dev' ? (req.body.ownerPubKey || null) : req.authPubKey
    const id = agentNetwork.registerAgent({ ...req.body, owner: req.body.owner || 'deployer', ownerPubKey })
    res.json({ success: true, agentId: id, agent: agentNetwork.getAgent(id) })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

/**
 * Invoke an agent.
 *
 * Without X-Payment-Receipt header:
 *   → 402 with simulated x402 payment-required body
 *
 * With X-Payment-Receipt header (from /pay):
 *   → validates receipt, calls Qwen, returns result
 */
app.post('/api/agents/:id/invoke', expensiveLimiter, requireSignature, async (req, res) => {
  const agent = agentNetwork.getAgent(+req.params.id)
  if (!agent) return res.status(404).json({ error: 'Agent not found' })
  if (agent.status !== 'ACTIVE') return res.status(403).json({ error: `Agent is ${agent.status}` })

  const receiptId = req.headers['x-payment-receipt'] || req.body.receiptId

  // No receipt → return 402
  if (!receiptId && agent.feePerTask > 0) {
    return res.status(402).json({
      payment402: agentNetwork.build402(agent),
      hint: `POST /api/agents/${agent.agentId}/pay  body: { "payer": "<user>", "amount": ${agent.feePerTask} }`,
    })
  }

  // Free agent (Orchestrator) or receipt provided → proceed
  let effectiveReceiptId = receiptId
  if (!receiptId && agent.feePerTask === 0) {
    // Issue a zero-value internal receipt so invokeAgent flow is uniform
    const r = agentNetwork.issueReceipt(agent.agentId, req.body.caller || 'user', 0)
    effectiveReceiptId = r.receiptId
  }

  try {
    const inv = await agentNetwork.invokeAgent(
      +req.params.id,
      req.body.caller || 'user',
      req.body.task   || 'No task specified',
      req.body.input  || '',
      effectiveReceiptId,
    )
    res.json({ success: true, invocation: inv })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

/**
 * Simulate paying for an agent call.
 * Returns a receipt UUID that must be included in the next /invoke request
 * (either as X-Payment-Receipt header or body.receiptId).
 */
app.post('/api/agents/:id/pay', requireSignature, (req, res) => {
  try {
    const result = agentNetwork.issueReceipt(
      +req.params.id,
      req.body.payer  || 'user',
      req.body.amount ?? agentNetwork.getAgent(+req.params.id)?.feePerTask ?? 0,
    )
    res.json({ success: true, ...result })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

/** Pause or revoke an agent */
app.post('/api/agents/:id/status', requireSignature, (req, res) => {
  try {
    const agent = agentNetwork.getAgent(+req.params.id)
    if (!agent) return res.status(404).json({ error: 'Agent not found' })
    if (!requireOwner(agent.ownerPubKey, req, res)) return
    const caller = AUTH_MODE === 'dev' ? req.body.caller : agent.owner
    agentNetwork.setAgentStatus(+req.params.id, req.body.status, caller)
    res.json({ success: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})


// ─────────────────────────────────────────────────────────────────────────────
// Async boot: load the ESM settlement engine (from the vendored demo/settlement/ copy,
// which is what ships in the Docker build context), then restore/seed and listen. The
// engine is loaded BEFORE seed()/any paid call so payForCall always has it.
const PORT = process.env.PORT || 3000
;(async () => {
  const { pathToFileURL } = require('node:url')
  const enginePath = path.join(__dirname, 'settlement', 'engine.mjs')
  const engineMod  = await import(pathToFileURL(enginePath).href)
  SettlementEngine = engineMod.SettlementEngine

  // Boot: restore snapshot or seed fresh
  if (loadState()) {
    // Existing creators keep their persisted keys; only fill in any that are missing.
    ensureCreatorKeys(['deployer', 'alice', 'bob', 'carol'])
    console.log(`  ✓ Restored state from ${STATE_FILE} (${Object.keys(state.skills).length} skills)`)
  } else {
    seed()
    scheduleSave()
  }
  agentNetwork.seedAgents(state.creators.deployer?.pubKey)

  // ── Settlement gateway ──────────────────────────────────────────────────────
  // Constructed AFTER restore/seed so it captures the final skills/deps refs and excludes the
  // pre-boot seed call history. A construction failure must NOT take down the demo — on error
  // the gateway stays null (endpoints report {enabled:false}) and the demo runs exactly as today.
  try {
    const gatewayMod = await import(pathToFileURL(path.join(__dirname, 'gateway.mjs')).href)
    gateway = new gatewayMod.SettlementGateway({ state, env: process.env, scheduleSave })
    gateway.hydrate(state._settlementRaw)
    if (gateway.enabled) {
      console.log(`  → Settlement gateway: ENABLED (gateway ${gateway.gatewayAccount.address}, vault ${gateway.vaultAddress})`)
      // Boot reconciliation — adopt on-chain spent where it exceeds local (chain is truth).
      gateway.reconcile()
        .then(r => { if (r.adopted) console.log(`  → Settlement reconcile: adopted chain spent for ${r.adopted} payer(s)`) })
        .catch(err => console.error('  ⚠ settlement reconcile failed:', err.message))
    } else {
      console.log('  → Settlement gateway: disabled (set GATEWAY_PRIVATE_KEY/PRIVATE_KEY, BASE_SEPOLIA_RPC_URL, SETTLEMENT_VAULT_ADDRESS to enable)')
    }
  } catch (err) {
    console.error('  ⚠ settlement gateway init failed (running without it):', err.message)
    gateway = null
  }

  app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║   SkillNet Demo  +  HCS-26            ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`\n  → http://localhost:${PORT}`)
  if (AUTH_MODE === 'dev') {
    console.log('\n  ⚠⚠⚠  AUTH_MODE=dev — SIGNATURE CHECKS DISABLED  ⚠⚠⚠')
    console.log('  ⚠  Any client can mint/compose/call as any identity. Never use in production.')
    console.log('  ⚠  GET /api/dev/keys is exposed (seeded creator private keys).')
  } else {
    console.log('  → Auth: signature mode (Ed25519-signed writes required)')
  }
  console.log(`  → CORS allow-list: ${ALLOWED_ORIGINS.join(', ')}`)
  console.log(`  → State snapshot: ${STATE_FILE}`)
  if (hcs26.isConfigured()) {
    console.log(`  → HCS-26 Discovery Registry: ${process.env.HCS26_DISCOVERY_TOPIC}`)
    console.log(`  → Hedera Account: ${process.env.HEDERA_ACCOUNT_ID}`)
  } else {
    console.log('  → HCS-26: not configured (skills run in local-only mode)')
    console.log('    To enable: fill in demo/.env.hedera and run scripts/setup-hedera.mjs')
  }
  console.log()
  })
})()
