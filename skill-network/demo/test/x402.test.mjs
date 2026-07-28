'use strict'
/**
 * x402 agent-payment tests (node:test, NO network).
 *
 * In-process unit tests drive the REAL x402 logic with a STUBBED facilitator injected into
 * X402Gateway (mirrors the hooks-injection style of gateway.test.mjs). A second block spawns
 * the demo server in REAL x402 mode to prove the HTTP wiring for the paths that never touch the
 * facilitator (free-agent bypass, the 402 challenge, and the retired /pay endpoint).
 *
 * Covers:
 *   1. feePerTask → micro-USDC conversion (exact).
 *   2. 402 challenge shape for a priced agent: v2 requirements carry the correct
 *      network / asset / payTo / amount.
 *   3. Paid flow with stubbed verify/settle: invocation proceeds, settlement tx hash recorded,
 *      balance credited in micro-USDC.
 *   4. Facilitator failure → retryable error (never throws); invalid/ malformed payment →
 *      non-retryable.
 *   5. SIM mode preserves the legacy UUID-receipt flow shape.
 *   6. HTTP (real mode): free agent bypasses 402; priced agent → 402 challenge; /pay → 410 Gone.
 */

// Ensure the in-process Qwen call can never reach the network: agent-network captures
// QWEN_API_KEY at module load, so clear it BEFORE requiring the module.
process.env.QWEN_API_KEY = ''

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer, stopServer, signHeaders, security } from './helpers.mjs'

const require = createRequire(import.meta.url)
const x402 = require('../x402.js')
const agentNetwork = require('../agent-network.js')

const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const PAYTO = '0x7a549A1687f374715C74615748509aF976a3f32E'
const ENV = {
  X402_MODE: 'real',
  X402_NETWORK: 'eip155:84532',
  X402_USDC_ADDRESS: USDC,
  X402_RECEIVING_ADDRESS: PAYTO,
  X402_FACILITATOR_URL: 'https://x402.org/facilitator',
}

/** A stub facilitator ({ verify, settle }) — mirrors gateway.test.mjs hook injection. */
function stubFacilitator({ isValid = true, success = true, txHash = '0xSETTLE', payer = '0xBUYER' } = {}) {
  return {
    verify: async () => ({ isValid, payer, invalidReason: isValid ? undefined : 'signature-invalid' }),
    settle: async () => ({ success, transaction: txHash, network: 'eip155:84532', payer, errorReason: success ? undefined : 'insufficient-funds' }),
  }
}

const encodePayment = (requirements) =>
  Buffer.from(JSON.stringify({ x402Version: 2, accepted: requirements, payload: {} }), 'utf8').toString('base64')

// ── 1. Micro-USDC conversion ──────────────────────────────────────────────────

test('toMicroUSDC: feePerTask (USD) → 6-decimal micro units, exact (no float dust)', () => {
  assert.equal(x402.toMicroUSDC(0), '0')
  assert.equal(x402.toMicroUSDC(0.001), '1000')       // $0.001 → 1000 micro-USDC
  assert.equal(x402.toMicroUSDC(0.015), '15000')
  assert.equal(x402.toMicroUSDC(1), '1000000')        // $1 → 1e6 micro-USDC
  assert.equal(x402.toMicroUSDC(2.5), '2500000')
  assert.equal(x402.toMicroUSDC(1e-7), '0')           // below 6 decimals truncates to 0
})

// ── 2. 402 challenge shape ────────────────────────────────────────────────────

test('402 challenge: priced agent → v2 requirements with correct network/asset/payTo/amount', () => {
  const gw = new x402.X402Gateway({ env: ENV, facilitator: stubFacilitator() })
  const id = agentNetwork.registerAgent({ name: 'Priced', feePerTask: 0.001, owner: 'deployer' })
  const agent = agentNetwork.getAgent(id)

  const body = gw.challenge(agent)
  assert.equal(body.x402Version, 2)
  assert.equal(typeof body.resource.url, 'string')
  assert.ok(body.resource.url.length > 0)

  assert.equal(body.accepts.length, 1)
  const r = body.accepts[0]
  assert.equal(r.scheme, 'exact')
  assert.equal(r.network, 'eip155:84532')
  assert.equal(r.asset, USDC)
  assert.equal(r.payTo, PAYTO)
  assert.equal(r.amount, '1000')
  assert.equal(r.maxTimeoutSeconds, 300)
  assert.deepEqual(r.extra, { name: 'USDC', version: '2' })
})

// ── 3. Paid flow (stubbed verify/settle) ──────────────────────────────────────

test('paid flow: settle → invoke; tx hash recorded, balance credited in micro-USDC', async () => {
  const gw = new x402.X402Gateway({ env: ENV, facilitator: stubFacilitator({ txHash: '0xDEADBEEF', payer: '0xBUY' }) })
  const id = agentNetwork.registerAgent({ name: 'PaidAgent', feePerTask: 0.002, owner: 'deployer' })
  const agent = agentNetwork.getAgent(id)

  const collected = await gw.collect(agent, encodePayment(gw.requirements(agent)))
  assert.equal(collected.ok, true)
  assert.equal(collected.txHash, '0xDEADBEEF')
  assert.equal(collected.amountMicro, '2000')
  assert.equal(collected.payer, '0xBUY')
  assert.ok(collected.paymentResponseB64, 'X-PAYMENT-RESPONSE payload produced')

  const inv = await agentNetwork.invokeAgentPaid(id, collected.payer, 'summarize', 'hello world', {
    amountMicro: collected.amountMicro, txHash: collected.txHash,
  })
  assert.equal(inv.txHash, '0xDEADBEEF')
  assert.equal(inv.paidAmount, 2000)          // micro-USDC
  assert.equal(inv.currency, 'USDC')
  assert.equal(inv.receiptId, null)           // no legacy receipt on the real path
  assert.match(inv.result, /Qwen error/)      // Qwen unreachable offline → graceful, still logged

  const bal = agentNetwork.getBalances().find(b => b.agentId === id)
  assert.equal(bal.earned, 2000)              // credited in micro-USDC
})

// ── 4. Failure modes (never crash) ────────────────────────────────────────────

test('facilitator verify throws → { ok:false, retryable:true }, never throws', async () => {
  const throwing = { verify: async () => { throw new Error('ECONNREFUSED') }, settle: async () => ({}) }
  const gw = new x402.X402Gateway({ env: ENV, facilitator: throwing })
  const id = agentNetwork.registerAgent({ name: 'FacFail', feePerTask: 0.001, owner: 'deployer' })
  const agent = agentNetwork.getAgent(id)

  const res = await gw.collect(agent, encodePayment(gw.requirements(agent)))
  assert.equal(res.ok, false)
  assert.equal(res.retryable, true)
  assert.match(res.error, /verify failed/i)
})

test('settle failure → { ok:false, retryable:true }', async () => {
  const gw = new x402.X402Gateway({ env: ENV, facilitator: stubFacilitator({ success: false }) })
  const id = agentNetwork.registerAgent({ name: 'SettleFail', feePerTask: 0.001, owner: 'deployer' })
  const agent = agentNetwork.getAgent(id)

  const res = await gw.collect(agent, encodePayment(gw.requirements(agent)))
  assert.equal(res.ok, false)
  assert.equal(res.retryable, true)
})

test('invalid payment (verify isValid=false) → { ok:false, retryable:false }', async () => {
  const gw = new x402.X402Gateway({ env: ENV, facilitator: stubFacilitator({ isValid: false }) })
  const id = agentNetwork.registerAgent({ name: 'BadSig', feePerTask: 0.001, owner: 'deployer' })
  const agent = agentNetwork.getAgent(id)

  const res = await gw.collect(agent, encodePayment(gw.requirements(agent)))
  assert.equal(res.ok, false)
  assert.equal(res.retryable, false)
})

test('malformed X-PAYMENT header → { ok:false, retryable:false }, never throws', async () => {
  const gw = new x402.X402Gateway({ env: ENV, facilitator: stubFacilitator() })
  const id = agentNetwork.registerAgent({ name: 'Malformed', feePerTask: 0.001, owner: 'deployer' })
  const agent = agentNetwork.getAgent(id)

  const res = await gw.collect(agent, Buffer.from('not-json', 'utf8').toString('base64'))
  assert.equal(res.ok, false)
  assert.equal(res.retryable, false)
  assert.match(res.error, /Malformed/i)
})

// ── 5. SIM mode preserves the legacy UUID flow ────────────────────────────────

test('sim mode: config + legacy build402Sim shape + UUID receipt round-trip', async () => {
  const gw = new x402.X402Gateway({ env: { X402_MODE: 'sim' } })
  assert.equal(gw.mode, 'sim')

  const id = agentNetwork.registerAgent({ name: 'SimAgent', feePerTask: 0.005, owner: 'deployer' })
  const agent = agentNetwork.getAgent(id)

  const body = agentNetwork.build402Sim(agent)
  assert.equal(body.x402Version, 1)
  assert.equal(body.accepts[0].network, 'sim-local')
  assert.equal(body.accepts[0].asset, 'sim:ETH')

  const r = agentNetwork.issueReceipt(id, 'user', 0.005)
  assert.ok(r.receiptId)
  const inv = await agentNetwork.invokeAgent(id, 'user', 'task', '', r.receiptId)
  assert.equal(inv.currency, 'ETH')
  assert.equal(inv.receiptId, r.receiptId)
  assert.equal(inv.paidAmount, 0.005)
  assert.throws(() => agentNetwork.consumeReceipt(r.receiptId), /already used/)
})

// ── 6. HTTP wiring (real mode, no facilitator calls) ──────────────────────────

let srv, caller

before(async () => {
  caller = security.generateCreatorKeypair()
  const dir = mkdtempSync(path.join(os.tmpdir(), 'skillnet-x402-'))
  srv = await startServer({ AUTH_MODE: 'signature', STATE_FILE: path.join(dir, 'state.json'), X402_MODE: 'real' })
})
after(async () => { if (srv) await stopServer(srv.proc) })

function signedPost(pathname, body, extraHeaders = {}) {
  const bodyStr = JSON.stringify(body)
  const h = signHeaders(caller.privJwk, caller.pubKey, 'POST', pathname, bodyStr)
  return fetch(srv.base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...h, ...extraHeaders },
    body: bodyStr,
  })
}

test('HTTP real mode: free seeded agent (#1) invokes without payment — no 402', async () => {
  const r = await signedPost('/api/agents/1/invoke', { caller: 'tester', task: 'ping' })
  assert.equal(r.status, 200)
  const j = await r.json()
  assert.equal(j.success, true)
  assert.ok(j.invocation)
  assert.equal(j.invocation.currency, 'USDC')
  assert.equal(j.payment.free, true)
  assert.equal(j.payment.amountMicro, '0')
})

test('HTTP real mode: priced agent → 402 with v2 USDC requirements', async () => {
  const reg = await signedPost('/api/agents/register', {
    name: 'PricedHTTP', description: 'x', capabilities: [], feePerTask: 0.001, systemPrompt: 'hi',
  })
  assert.equal(reg.status, 200)
  const { agentId } = await reg.json()

  const inv = await signedPost(`/api/agents/${agentId}/invoke`, { caller: 'tester', task: 'ping' })
  assert.equal(inv.status, 402)
  const body = await inv.json()
  assert.equal(body.x402Version, 2)
  const rq = body.accepts[0]
  assert.equal(rq.network, 'eip155:84532')
  assert.equal(rq.asset, USDC)
  assert.equal(rq.payTo, PAYTO)
  assert.equal(rq.amount, '1000')
})

test('HTTP real mode: retired /pay endpoint → 410 Gone with x402 pointer', async () => {
  const r = await signedPost('/api/agents/1/pay', { payer: 'tester', amount: 0 })
  assert.equal(r.status, 410)
  const j = await r.json()
  assert.match(j.message, /x402/i)
})
