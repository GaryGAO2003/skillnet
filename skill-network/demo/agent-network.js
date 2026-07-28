'use strict'
/**
 * Agent Network — local simulation
 *
 * Simulates ERC-8004 (agent registry) without any real blockchain interaction:
 *   – registerAgent / listAgents / getAgent / setAgentStatus
 *   – Each agent stores ERC-8004 fields (agentId, owner, capabilities,
 *     feePerTask, metadataURI, status, …)
 *
 * One agent is seeded on startup: Qwen Agent (port 3001).
 * The actual skill routing and execution lives in agent-server.js.
 */

const https  = require('https')
const crypto = require('crypto')

// ─── Config ────────────────────────────────────────────────────────────────────
const QWEN_API_KEY  = process.env.QWEN_API_KEY  || ''
const QWEN_MODEL    = process.env.QWEN_MODEL    || 'qwen3-plus'
const QWEN_HOST     = process.env.QWEN_HOST     || 'dashscope-intl.aliyuncs.com'
const QWEN_PATH     = '/compatible-mode/v1/chat/completions'

const RECEIPT_TTL_MS = 5 * 60 * 1000   // receipts expire after 5 min

// ─────────────────────────────────────────────────────────────────────────────
// Simulated ERC-8004 registry state
// ─────────────────────────────────────────────────────────────────────────────
const registry = {
  nextId:          1,
  agents:          {},   // agentId → AgentMetadata
  pendingReceipts: {},   // receiptId → { agentId, payer, amount, expiresAt, used }
  invocationLog:   [],   // most-recent-first list of invocations
  balances:        {},   // agentId → simulated ETH earned
}

// ─── ERC-8004 agent registration ─────────────────────────────────────────────
function registerAgent({ name, description, capabilities, feePerTask, systemPrompt, owner, ownerPubKey }) {
  const id = registry.nextId++
  registry.agents[id] = {
    agentId:          id,
    owner:            owner || 'deployer',
    ownerPubKey:      ownerPubKey || null,   // Ed25519 identity that may change this agent's status
    name,
    description,
    // ERC-8004 fields
    endpoint:         `/api/agents/${id}/invoke`,
    metadataURI:      `/api/agents/${id}`,        // self-describing JSON (simulated)
    capabilities:     capabilities || [],
    feePerTask:       Number(feePerTask) || 0,
    model:            QWEN_MODEL,
    systemPrompt:     systemPrompt || 'You are a helpful AI agent.',
    status:           'ACTIVE',                   // ACTIVE | PAUSED | REVOKED
    registeredAt:     new Date().toISOString(),
    totalInvocations: 0,
    totalEarned:      0,
  }
  registry.balances[id] = 0
  return id
}

function getAgent(id)  { return registry.agents[id] || null }
function listAgents()  { return Object.values(registry.agents) }

function setAgentStatus(agentId, status, caller) {
  const a = registry.agents[agentId]
  if (!a)                throw new Error('Agent not found')
  if (a.owner !== caller) throw new Error('Not the agent owner')
  a.status = status
}

// ─────────────────────────────────────────────────────────────────────────────
// SIM-mode payment flow (X402_MODE=sim) — legacy UUID receipts, no chain.
// The REAL x402/USDC flow lives in x402.js; server.js selects between them by mode.
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the simulated 402 payment-required body (legacy sim shape, ETH-denominated). */
function build402Sim(agent) {
  return {
    x402Version: 1,
    error:       'Payment Required',
    // Simulated — no real on-chain transaction takes place
    accepts: [{
      scheme:             'exact',
      network:            'sim-local',
      maxAmountRequired:  String(Math.round(agent.feePerTask * 1e18)),
      resource:           agent.endpoint,
      description:        `Pay ${agent.feePerTask} ETH to invoke ${agent.name} (simulated)`,
      mimeType:           'application/json',
      payTo:              `sim:0xAgent${agent.agentId}`,
      maxTimeoutSeconds:  300,
      asset:              'sim:ETH',
      extra: { agentId: agent.agentId, model: agent.model },
    }],
  }
}

/** Client calls /pay → gets back a receipt UUID (simulates on-chain settlement) */
function issueReceipt(agentId, payer, amount) {
  const agent = getAgent(agentId)
  if (!agent)                    throw new Error('Agent not found')
  if (agent.status !== 'ACTIVE') throw new Error(`Agent is ${agent.status}`)
  if (amount < agent.feePerTask) {
    throw new Error(`Insufficient payment: need ${agent.feePerTask} ETH, got ${amount}`)
  }

  const receiptId = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + RECEIPT_TTL_MS).toISOString()
  registry.pendingReceipts[receiptId] = { agentId, payer, amount, expiresAt, used: false }
  // .unref() so this TTL-cleanup timer never keeps the process alive (matters for in-process tests).
  const t = setTimeout(() => { delete registry.pendingReceipts[receiptId] }, RECEIPT_TTL_MS)
  if (typeof t.unref === 'function') t.unref()
  return { receiptId, expiresAt, amountPaid: amount, agentId }
}

/** Validate and consume a receipt; throws if missing/expired/already used */
function consumeReceipt(receiptId) {
  const r = registry.pendingReceipts[receiptId]
  if (!r)         throw new Error('Receipt not found or expired')
  if (r.used)     throw new Error('Receipt already used')
  if (new Date(r.expiresAt) < new Date()) throw new Error('Receipt expired')
  r.used = true
  return r
}

// ─────────────────────────────────────────────────────────────────────────────
// Qwen API call (real HTTP — the only non-simulated part)
// ─────────────────────────────────────────────────────────────────────────────
function callQwen(systemPrompt, userMessage) {
  return new Promise((resolve, reject) => {
    if (!QWEN_API_KEY) {
      return reject(new Error('QWEN_API_KEY not configured (add it to demo/.env.hedera)'))
    }

    const body = JSON.stringify({
      model:       QWEN_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: userMessage  },
      ],
      max_tokens:  1024,
      temperature: 0.7,
    })

    const req = https.request({
      hostname: QWEN_HOST,
      port:     443,
      path:     QWEN_PATH,
      method:   'POST',
      headers: {
        'Content-Type':   'application/json',
        'Authorization':  `Bearer ${QWEN_API_KEY}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let raw = ''
      res.on('data', c => { raw += c })
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw)
          if (parsed.error) return reject(new Error(parsed.error.message || JSON.stringify(parsed.error)))
          const content = parsed.choices?.[0]?.message?.content
          if (!content) return reject(new Error('Empty response from Qwen: ' + raw.slice(0, 200)))
          resolve({ content, usage: parsed.usage || {}, model: parsed.model || QWEN_MODEL })
        } catch (e) {
          reject(new Error('JSON parse error: ' + e.message + ' | raw: ' + raw.slice(0, 200)))
        }
      })
    })
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Agent invocation — credits the agent, calls Qwen, records the call.
// Payment is settled BEFORE these run: SIM mode consumes a UUID receipt (ETH), REAL mode
// passes the settled x402/USDC payment (settlement tx hash + micro-USDC amount).
// ─────────────────────────────────────────────────────────────────────────────

/** Shared: credit the agent, run Qwen (unchanged), append the invocation-log entry. */
async function _runAndLog(agent, payer, task, input, ledger) {
  agent.totalInvocations++
  agent.totalEarned                += ledger.credit
  registry.balances[agent.agentId] += ledger.credit

  let result = ''
  try {
    const qwen = await callQwen(agent.systemPrompt, buildUserMessage(task, input))
    result = qwen.content
  } catch (e) {
    result = `[Qwen error: ${e.message}]`
  }

  const entry = {
    id:         crypto.randomUUID(),
    agentId:    agent.agentId,
    agentName:  agent.name,
    payer,
    task,
    input:      String(input || '').slice(0, 400),
    result:     String(result).slice(0, 3000),
    paidAmount: ledger.credit,
    currency:   ledger.currency,
    txHash:     ledger.txHash   || null,   // x402 settlement tx (REAL mode)
    receiptId:  ledger.receiptId || null,  // UUID receipt (SIM mode)
    ts:         new Date().toISOString(),
  }
  registry.invocationLog.unshift(entry)
  return entry
}

/** SIM mode: validate + consume a UUID receipt (ETH-denominated), then invoke. */
async function invokeAgent(agentId, payer, task, input, receiptId) {
  const agent = getAgent(agentId)
  if (!agent)                    throw new Error('Agent not found')
  if (agent.status !== 'ACTIVE') throw new Error(`Agent is ${agent.status}`)

  const receipt = consumeReceipt(receiptId)
  return _runAndLog(agent, payer, task, input, {
    credit: receipt.amount, currency: 'ETH', receiptId,
  })
}

/**
 * REAL mode: invoke after an x402/USDC payment has been verified + settled by the facilitator.
 * @param {Object} payment  { amountMicro:<string>, txHash:<string|null> } — settlement result.
 */
async function invokeAgentPaid(agentId, payer, task, input, payment = {}) {
  const agent = getAgent(agentId)
  if (!agent)                    throw new Error('Agent not found')
  if (agent.status !== 'ACTIVE') throw new Error(`Agent is ${agent.status}`)

  return _runAndLog(agent, payer, task, input, {
    credit:   Number(payment.amountMicro) || 0,   // micro-USDC (integer)
    currency: 'USDC',
    txHash:   payment.txHash || null,
  })
}

function buildUserMessage(task, input) {
  return input
    ? `Task: ${task}\n\nInput:\n${input}`
    : `Task: ${task}`
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed (called once on startup)
// ─────────────────────────────────────────────────────────────────────────────
function seedAgents(deployerPubKey) {
  registerAgent({
    name:         'Qwen Agent',
    description:  'LLM-powered agent running on port 3001. Uses an LLM router to match user messages to registered SkillNet skills and records every skill call in the Call Log.',
    capabilities: ['skill-routing', 'llm-chat', 'skill-execution', 'call-recording'],
    feePerTask:   0,
    owner:        'deployer',
    ownerPubKey:  deployerPubKey || null,
    systemPrompt: 'You are a SkillNet agent powered by Qwen. You have access to registered skills from the SkillNet marketplace. A separate router decides whether to invoke a skill before each reply.',
  })

  console.log(`  ✓ Seeded 1 ERC-8004 agent (Qwen Agent)`)
}

// ─────────────────────────────────────────────────────────────────────────────
// Exports
// ─────────────────────────────────────────────────────────────────────────────
module.exports = {
  seedAgents,
  registerAgent,
  getAgent,
  listAgents,
  setAgentStatus,
  issueReceipt,      // SIM mode only
  consumeReceipt,    // SIM mode only
  invokeAgent,       // SIM mode (UUID receipt)
  invokeAgentPaid,   // REAL mode (settled x402/USDC payment)
  build402Sim,       // SIM mode 402 body; REAL mode uses x402.js buildPaymentRequired
  __callQwen: callQwen,
  getLog:      (n = 50) => registry.invocationLog.slice(0, n),
  getBalances: ()       => Object.entries(registry.balances).map(([id, earned]) => {
    const a = registry.agents[id]
    return { agentId: +id, name: a?.name, owner: a?.owner, earned }
  }),
}
