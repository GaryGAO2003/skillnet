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
const { execFileSync } = require('child_process')

// ─── Load Hedera env (demo/.env.hedera) if present ───────────────────────────
const hederaEnvPath = path.join(__dirname, '.env.hedera')
if (fs.existsSync(hederaEnvPath)) {
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
app.use(express.json())
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*')
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Payment-Receipt')
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})
app.use(express.static(path.join(__dirname, 'public')))

// ─── Fee constants (mirrors FeeRouter.sol) ────────────────────────────────────
const PROTOCOL_SHARE = 0.10   // protocol fee taken off the top
const RHO            = 0.20   // upstream pass-through per composition hop (conserving rho-flow — mirrors FeeRouter.sol)
const MAX_DEPTH      = 5
const TIERS          = ['OPEN', 'SHIELDED', 'PRIVATE']

// ─── In-memory state ──────────────────────────────────────────────────────────
const state = {
  nextId:   1,
  skills:   {},    // id -> SkillMetadata
  deps:     {},    // childId  -> [{parentSkillId, weight}]
  depOf:    {},    // parentId -> [childId]
  depth:    {},    // skillId  -> depth in DAG (0 = leaf)
  balances: { treasury: 0, deployer: 0, alice: 0, bob: 0, carol: 0 },
  txLog:    [],
}

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
function mintSkillWithId(id, { name, description, skillType, tier, pricePerCall = 0, creator = 'deployer', previousVersion = 0, hcs26_uid, status = 'approved', scores = null } = {}) {
  state.skills[id] = {
    id, name, description, skillType, tier, pricePerCall,
    creator, version: id, previousVersion,
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
 * Conserving weight-proportional royalty flow (single decay knob RHO) — mirrors FeeRouter.sol._royalty.
 * A leaf credits its creator the full amount; a composite passes `amount * RHO` to its parents
 * (split by edge weight, each share fully distributed by recursion) and credits its own creator
 * `amount - distributed`. Conserves for ANY DAG shape (chains, diamonds, bundles-of-bundles) and
 * never over-distributes. Replaces the old depth-band model that over-paid (>100% of the pool) on
 * any composite-of-composites, which silently shorted the creator here and reverted on-chain.
 */
function distributeRoyalty(skillId, amount, depth, log, inWeight) {
  const skill   = state.skills[skillId]
  const creator = skill.creator
  const edges   = state.deps[skillId] || []

  // Leaf: keeps the whole amount
  if (!edges.length) {
    state.balances[creator] = (state.balances[creator] || 0) + amount
    log.push({ skillId, skillName: skill.name, creator, amount, weight: inWeight, depth })
    return
  }

  // Composite: pass RHO upstream (by weight), keep the remainder
  const passUp = amount * RHO
  let distributed = 0
  for (const edge of edges) {
    const share = passUp * (edge.weight / 100)
    distributeRoyalty(edge.parentSkillId, share, depth + 1, log, edge.weight)
    distributed += share
  }
  const kept = amount - distributed
  state.balances[creator] = (state.balances[creator] || 0) + kept
  log.push({ skillId, skillName: skill.name, creator, amount: kept, weight: inWeight, depth })
}

function payForCall(skillId, value, caller) {
  const skill = state.skills[skillId]
  if (!skill) throw new Error('Skill not found')

  skill.totalCalls++
  skill.totalRevenue += value

  // Protocol fee off the top; the remainder flows through the DAG, conserving exactly.
  const protocolAmt = value * PROTOCOL_SHARE
  state.balances.treasury += protocolAmt
  const net = value - protocolAmt

  const royaltyLog = []
  distributeRoyalty(skillId, net, 1, royaltyLog, 100)

  // Display compatibility: the called skill's own kept share is "creatorTotal";
  // every other credited node is "upstream".
  const top = royaltyLog.find(e => e.skillId === skillId && e.depth === 1)
  const creatorTotal = top ? top.amount : 0
  const upstream = royaltyLog.filter(e => !(e.skillId === skillId && e.depth === 1))

  const tx = {
    id:        Date.now(),
    ts:        new Date().toISOString(),
    type:      'CALL',
    skillId,
    skillName: skill.name,
    caller,
    value,
    breakdown: { protocol: protocolAmt, creatorTotal, upstream },
  }
  state.txLog.unshift(tx)
  return tx
}

function withdraw(user) {
  const amount = state.balances[user] || 0
  if (amount < 1e-10) throw new Error('Nothing to withdraw')
  state.balances[user] = 0
  const tx = { id: Date.now(), ts: new Date().toISOString(), type: 'WITHDRAW', user, amount }
  state.txLog.unshift(tx)
  return tx
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed — 9 skills (matches the original plan + save-hello)
// ─────────────────────────────────────────────────────────────────────────────

function seed() {
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
seed()
agentNetwork.seedAgents()

// ─────────────────────────────────────────────────────────────────────────────
// REST API
// ─────────────────────────────────────────────────────────────────────────────

app.get('/api/state', (_req, res) => {
  res.json({
    skills:   Object.values(state.skills),
    balances: state.balances,
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

app.post('/api/mint', async (req, res) => {
  try {
    // Local ID always comes from the auto-increment counter
    const id = state.nextId++
    let hcs26_uid = null

    if (hcs26.isConfigured()) {
      // Publish to Hedera asynchronously; skill_uid is the HCS-2 sequence number
      try {
        const versionTopicId = await hcs26.createVersionRegistryTopic(req.body.name)
        hcs26_uid = await hcs26.publishSkill(req.body, versionTopicId)

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
    res.json({ success: true, id, hcs26: hcs26.isConfigured(), hcs26_uid })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/api/compose', (req, res) => {
  try {
    const { childId, parentIds, weights, caller } = req.body
    compose(childId, parentIds, weights, caller)
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

/** Build detailed fee distribution object for a call (preview — does not modify balances) */
function buildFeeDistribution(skillId, value) {
  const skill = state.skills[skillId]
  if (!skill) return {}
  const result = {}
  const protocolAmt = value * PROTOCOL_SHARE
  const net = value - protocolAmt

  const items = []
  royaltyPreview(skillId, net, 1, items, 100)
  for (const item of items) {
    const key = `${item.skillName} (${item.creator})`
    result[key] = (result[key] || 0) + item.amount
  }
  result['Protocol treasury'] = protocolAmt   // 100% to treasury (mirrors FeeRouter.sol)
  return result
}

/** Preview-only conserving royalty walk (doesn't modify balances) — mirrors distributeRoyalty */
function royaltyPreview(skillId, amount, depth, log, inWeight) {
  const skill = state.skills[skillId]
  const edges = state.deps[skillId] || []
  if (!edges.length) {
    log.push({ skillId, skillName: skill.name, creator: skill.creator, amount, depth, weight: inWeight })
    return
  }
  const passUp = amount * RHO
  let distributed = 0
  for (const edge of edges) {
    const share = passUp * (edge.weight / 100)
    royaltyPreview(edge.parentSkillId, share, depth + 1, log, edge.weight)
    distributed += share
  }
  log.push({ skillId, skillName: skill.name, creator: skill.creator, amount: amount - distributed, depth, weight: inWeight })
}

app.post('/api/call/:id', async (req, res) => {
  try {
    const skill  = state.skills[+req.params.id]
    if (!skill) return res.status(404).json({ error: 'Skill not found' })
    const value  = req.body.value ?? skill.pricePerCall ?? 0
    const caller = req.body.caller || 'user'
    const input  = req.body.input || ''
    const tx     = payForCall(+req.params.id, value, caller)

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

app.post('/api/withdraw', (req, res) => {
  try { res.json({ success: true, tx: withdraw(req.body.user) }) }
  catch (e) { res.status(400).json({ error: e.message }) }
})

app.post('/api/upgrade-tier', (req, res) => {
  try {
    upgradeTier(+req.body.skillId, req.body.newTier, req.body.caller)
    res.json({ success: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})

// ─── Validation + Approval endpoints ─────────────────────────────────────────

app.post('/api/validate/:id', async (req, res) => {
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

app.post('/api/approve/:id', (req, res) => {
  const skill = state.skills[+req.params.id]
  if (!skill) return res.status(404).json({ error: 'Skill not found' })
  skill.status = 'approved'
  if (req.body.scores) {
    skill.scores = req.body.scores
  }
  res.json({ success: true, id: +req.params.id })
})

app.post('/api/reject/:id', (req, res) => {
  const skill = state.skills[+req.params.id]
  if (!skill) return res.status(404).json({ error: 'Skill not found' })
  skill.status = 'rejected'
  res.json({ success: true, id: +req.params.id })
})

// ─── HCS-26 endpoints ─────────────────────────────────────────────────────────

/** Return all skills registered on the Hedera HCS-26 Discovery Registry */
app.get('/api/hcs26/skills', async (_req, res) => {
  if (!hcs26.isConfigured()) {
    return res.status(503).json({ error: 'HCS-26 not configured (set HEDERA_ACCOUNT_ID, HEDERA_PRIVATE_KEY, HCS26_DISCOVERY_TOPIC in .env.hedera)' })
  }
  try {
    const skills = await hcs26.fetchRegisteredSkills()
    res.json({ skills, count: skills.length, topic: process.env.HCS26_DISCOVERY_TOPIC })
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

/** Register a new agent (ERC-8004 mint) */
app.post('/api/agents/register', (req, res) => {
  try {
    const id = agentNetwork.registerAgent({ ...req.body, owner: req.body.owner || 'deployer' })
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
app.post('/api/agents/:id/invoke', async (req, res) => {
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
app.post('/api/agents/:id/pay', (req, res) => {
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
app.post('/api/agents/:id/status', (req, res) => {
  try {
    agentNetwork.setAgentStatus(+req.params.id, req.body.status, req.body.caller)
    res.json({ success: true })
  } catch (e) { res.status(400).json({ error: e.message }) }
})


// ─────────────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════╗')
  console.log('║   SkillNet Demo  +  HCS-26            ║')
  console.log('╚══════════════════════════════════════╝')
  console.log(`\n  → http://localhost:${PORT}`)
  if (hcs26.isConfigured()) {
    console.log(`  → HCS-26 Discovery Registry: ${process.env.HCS26_DISCOVERY_TOPIC}`)
    console.log(`  → Hedera Account: ${process.env.HEDERA_ACCOUNT_ID}`)
  } else {
    console.log('  → HCS-26: not configured (skills run in local-only mode)')
    console.log('    To enable: fill in demo/.env.hedera and run scripts/setup-hedera.mjs')
  }
  console.log()
})
