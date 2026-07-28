'use strict'
/**
 * Settlement gateway — unit tests (node:test, NO network).
 * The gateway's chain I/O is injected via hooks {submitBatch, readSpent, now}, so these exercise
 * the real signing / two-phase settle / persistence / reconciliation logic with a stub chain.
 *
 * Covers:
 *   1. Voucher EIP-712: sign with a derived key via viem, recover the signer, assert == payer
 *      (mirrors SettlementVault's domain + Voucher typehash).
 *   2. Two-phase settle: success records a settlement + advances lastVouchered; failure restores
 *      the window EXACTLY, merging with amounts that accrued concurrently during the submit.
 *   3. Persistence round-trip: engine cumulative state survives serializeEngine→hydrate; an old
 *      snapshot without the new keys still loads (hydrate(undefined) is a no-op).
 *   4. Boot reconciliation: chain spent() > local lastVouchered → adopt the chain value.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { recoverTypedDataAddress } from 'viem'
import { SettlementGateway, VOUCHER_TYPES, derivePayerAddress } from '../gateway.mjs'

// A valid (test-only) gateway key + config. RPC points nowhere — the chain hooks are always
// mocked, so no client is ever actually used. No real secret appears anywhere.
const TEST_ENV = {
  GATEWAY_PRIVATE_KEY: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
  BASE_SEPOLIA_RPC_URL: 'http://127.0.0.1:1',
  SETTLEMENT_VAULT_ADDRESS: '0xb6DECc3e5d3a4E8a0F64DdFC5Fe8A6128abeb8B8',
  TREASURY_ADDRESS: '0x000000000000000000000000000000000000dEaD',
  DEMO_PAYER_SEED: '0x5c1117e5544c7de1cf7e0b4a1f4f4a53b6a2f3e2b8c1d0a9f6e5d4c3b2a19080',
  SETTLE_MIN_INTERVAL_MS: '0',
  SETTLE_THRESHOLD_WEI: '1000000000000000000', // 1 ETH — high, so auto-settle never fires in tests
}

// Two leaf skills: creator 'alice' (skill 1), creator 'bob' (skill 2).
function freshState() {
  return {
    skills: { 1: { name: 'A', creator: 'alice' }, 2: { name: 'B', creator: 'bob' } },
    deps: { 1: [], 2: [] },
    settlements: [],
  }
}

function makeGateway(hooks = {}, envOverrides = {}) {
  const state = freshState()
  const saves = []
  const gw = new SettlementGateway({
    state,
    env: { ...TEST_ENV, ...envOverrides },
    scheduleSave: () => saves.push(1),
    hooks,
  })
  return { gw, state, saves }
}

// ── 1. Voucher EIP-712 digest ────────────────────────────────────────────────

test('voucher EIP-712: recovered signer == payer, over the contract domain/type', async () => {
  const { gw } = makeGateway()

  // Domain must byte-match SettlementVault: EIP712("SkillNetSettlement","1") on chain 84532.
  assert.equal(gw.domain.name, 'SkillNetSettlement')
  assert.equal(gw.domain.version, '1')
  assert.equal(gw.domain.chainId, 84532)
  assert.equal(gw.domain.verifyingContract, '0xb6DECc3e5d3a4E8a0F64DdFC5Fe8A6128abeb8B8')
  assert.deepEqual(VOUCHER_TYPES.Voucher, [
    { name: 'payer', type: 'address' },
    { name: 'cumulativeSpent', type: 'uint256' },
  ])

  const account = gw.accountFor('agent-1')
  const message = { payer: account.address, cumulativeSpent: 7_000_000_000_000_000n }
  const signature = await account.signTypedData({ domain: gw.domain, types: VOUCHER_TYPES, primaryType: 'Voucher', message })

  const recovered = await recoverTypedDataAddress({ domain: gw.domain, types: VOUCHER_TYPES, primaryType: 'Voucher', message, signature })
  assert.equal(recovered, account.address, 'recovered signer must equal the voucher payer')

  // treasury is a credit recipient, never a payer — it must have NO signing key.
  assert.throws(() => gw.accountFor('treasury'), /no key for 'treasury'/)
  assert.equal(gw.addressFor('treasury'), '0x000000000000000000000000000000000000dEaD')
  assert.equal(gw.addressFor('agent-1'), account.address)
})

// ── 2a. Two-phase settle — SUCCESS path ──────────────────────────────────────

test('settle success: records a settlement, advances lastVouchered, resets the window', async () => {
  let captured = null
  const submitBatch = async (vouchers, sigs, credits) => {
    captured = { vouchers, sigs, credits }
    return { txHash: '0xabc0000000000000000000000000000000000000000000000000000000000001', blockNumber: 42n }
  }
  const { gw, state, saves } = makeGateway({ submitBatch })

  gw.onCall(1, 1000n, 'agent-1')   // → treasury 100, alice 900 ; callerSpent agent-1 = 1000
  gw.onCall(2, 2000n, 'agent-2')   // → treasury 200, bob 1800  ; callerSpent agent-2 = 2000
  assert.equal(gw.pendingTotal(), 3000n)

  const res = await gw.settle()
  assert.equal(res.ok, true)
  assert.equal(res.txHash, '0xabc0000000000000000000000000000000000000000000000000000000000001')
  assert.equal(res.blockNumber, '42')
  assert.equal(res.batchValue, '3000')
  assert.equal(res.calls, 2)
  assert.equal(res.vouchers, 2)
  assert.equal(res.credits, 3)   // treasury, alice, bob

  // Window reset + cumulative advanced.
  assert.equal(gw.pendingTotal(), 0n)
  assert.equal(gw.engine.lastVouchered.get('agent-1'), 1000n)
  assert.equal(gw.engine.lastVouchered.get('agent-2'), 2000n)

  // Settlement recorded (newest first) and persisted.
  assert.equal(state.settlements.length, 1)
  assert.equal(state.settlements[0].txHash, res.txHash)
  assert.ok(saves.length >= 1, 'scheduleSave called on success')

  // Submitted vouchers carry ADDRESSES (not names), index-aligned with sigs, cumulative amounts.
  assert.equal(captured.vouchers.length, 2)
  assert.equal(captured.sigs.length, 2)
  const payers = captured.vouchers.map(v => v.payer).sort()
  assert.deepEqual(payers, [derivePayerAddress(TEST_ENV.DEMO_PAYER_SEED, 'agent-1'), derivePayerAddress(TEST_ENV.DEMO_PAYER_SEED, 'agent-2')].sort())
  // Conservation: credited sum == batch value.
  const credited = captured.credits.reduce((a, c) => a + c.amount, 0n)
  assert.equal(credited, 3000n)
})

test('settle is idempotent-safe: nothing new to settle → skipped', async () => {
  const { gw } = makeGateway({ submitBatch: async () => ({ txHash: '0x1', blockNumber: 1n }) })
  const res = await gw.settle()
  assert.deepEqual(res, { skipped: true, reason: 'nothing-to-settle' })
})

test('settle honors the mutex: a concurrent settle returns {busy:true}', async () => {
  let release
  const gate = new Promise(r => { release = r })
  const submitBatch = async () => { await gate; return { txHash: '0x2', blockNumber: 2n } }
  const { gw } = makeGateway({ submitBatch })
  gw.onCall(1, 1000n, 'agent-1')

  const p1 = gw.settle()               // takes the mutex, parks in submitBatch
  const r2 = await gw.settle()         // should bounce off the mutex
  assert.deepEqual(r2, { busy: true })
  release()
  const r1 = await p1
  assert.equal(r1.ok, true)
})

// ── 2b. Two-phase settle — FAILURE path (exact restore incl. concurrent accrual) ──

test('settle failure: restores the window EXACTLY, merging concurrently-accrued amounts', async () => {
  // During the (async) submit, a new call lands — simulating a real recordCall arriving between
  // buildBatch()'s reset and the failure restore. The restore must MERGE, not clobber.
  let concurrentInjected = false
  const submitBatch = async () => {
    gwRef.onCall(1, 500n, 'agent-1')   // concurrent accrual: +50 treasury, +450 alice ; callerSpent → 1500
    concurrentInjected = true
    throw new Error('execution reverted: SettlementVault: insufficient deposit')
  }
  const made = makeGateway({ submitBatch })
  const gwRef = made.gw
  const { state, saves } = made

  gwRef.onCall(1, 1000n, 'agent-1')     // pre-settle: treasury 100, alice 900 ; callerSpent 1000
  assert.equal(gwRef.pendingTotal(), 1000n)
  const savesBefore = saves.length

  const res = await gwRef.settle()
  assert.equal(concurrentInjected, true)
  assert.equal(res.ok, false)
  assert.match(res.error, /reverted|insufficient/)

  // No settlement recorded on failure.
  assert.equal(state.settlements.length, 0)

  // Window restored AND merged with the concurrent accrual: 1000 (restored) + 500 (concurrent) = 1500.
  assert.equal(gwRef.pendingTotal(), 1500n)
  assert.equal(gwRef.engine.accrued.get('treasury'), 150n)  // 100 restored + 50 concurrent
  assert.equal(gwRef.engine.accrued.get('alice'), 1350n)    // 900 restored + 450 concurrent
  assert.equal(gwRef.engine.batchValue, 1500n)

  // lastVouchered rolled back (was empty before settle) — a retry will re-voucher the full amount.
  assert.equal(gwRef.engine.lastVouchered.get('agent-1') || 0n, 0n)
  // callerSpent is monotonic and untouched by the restore (includes the concurrent call).
  assert.equal(gwRef.engine.callerSpent.get('agent-1'), 1500n)
  assert.ok(saves.length > savesBefore, 'scheduleSave called after restore')
})

test('settle failure then success: the retry settles the full restored + concurrent amount', async () => {
  let calls = 0
  const submitBatch = async (vouchers) => {
    calls++
    if (calls === 1) throw new Error('reverted')
    return { txHash: '0xretry', blockNumber: 7n, _vouchers: vouchers }
  }
  const { gw } = makeGateway({ submitBatch })
  gw.onCall(1, 1000n, 'agent-1')

  const r1 = await gw.settle()
  assert.equal(r1.ok, false)
  assert.equal(gw.pendingTotal(), 1000n) // fully restored

  const r2 = await gw.settle()
  assert.equal(r2.ok, true)
  assert.equal(gw.engine.lastVouchered.get('agent-1'), 1000n)
  assert.equal(gw.pendingTotal(), 0n)
})

// ── 3. Persistence round-trip ────────────────────────────────────────────────

test('persistence: engine cumulative state survives serializeEngine → hydrate', async () => {
  const { gw } = makeGateway({ submitBatch: async () => ({ txHash: '0xp', blockNumber: 1n }) })
  gw.onCall(1, 1000n, 'agent-1')
  gw.onCall(2, 2000n, 'agent-2')
  await gw.settle()                 // advances lastVouchered, resets accrued
  gw.onCall(1, 500n, 'agent-1')     // fresh accrual after settle (unsettled window)

  const blob = gw.serializeEngine()
  // JSON round-trip to mimic the real STATE_FILE path (BigInts must be strings).
  const roundTripped = JSON.parse(JSON.stringify(blob))

  const { gw: gw2 } = makeGateway()
  gw2.hydrate(roundTripped)

  assert.equal(gw2.engine.callerSpent.get('agent-1'), 1500n)
  assert.equal(gw2.engine.callerSpent.get('agent-2'), 2000n)
  assert.equal(gw2.engine.lastVouchered.get('agent-1'), 1000n)
  assert.equal(gw2.engine.lastVouchered.get('agent-2'), 2000n)
  assert.equal(gw2.pendingTotal(), 500n)          // the post-settle accrual survived
  assert.equal(gw2.engine.accrued.get('alice'), 450n)
  assert.equal(gw2.engine.batchValue, 500n)
})

test('persistence: an OLD snapshot without settlement keys still loads (hydrate no-op)', () => {
  const { gw } = makeGateway()
  assert.doesNotThrow(() => gw.hydrate(undefined))
  assert.doesNotThrow(() => gw.hydrate(null))
  assert.equal(gw.pendingTotal(), 0n)
  assert.equal(gw.engine.callerSpent.size, 0)
})

// ── 4. Boot reconciliation ───────────────────────────────────────────────────

test('reconcile: chain spent() > local lastVouchered → adopt the chain value', async () => {
  const chainSpent = { 'agent-1': 5000n, 'agent-2': 100n }
  const readSpent = async (address) => {
    if (address === derivePayerAddress(TEST_ENV.DEMO_PAYER_SEED, 'agent-1')) return chainSpent['agent-1']
    if (address === derivePayerAddress(TEST_ENV.DEMO_PAYER_SEED, 'agent-2')) return chainSpent['agent-2']
    return 0n
  }
  const { gw } = makeGateway({ readSpent })

  // Make both payers "known" (in callerSpent) with local lastVouchered below/above chain.
  gw.onCall(1, 1000n, 'agent-1')   // callerSpent agent-1 = 1000, lastVouchered absent (0)
  gw.onCall(2, 2000n, 'agent-2')   // callerSpent agent-2 = 2000, lastVouchered absent (0)
  gw.engine.lastVouchered.set('agent-2', 500n)   // local already ahead of chain (100) → keep local

  const r = await gw.reconcile()
  assert.equal(r.adopted, 1)                                  // only agent-1 adopted
  assert.equal(gw.engine.lastVouchered.get('agent-1'), 5000n) // chain is truth
  assert.equal(gw.engine.lastVouchered.get('agent-2'), 500n)  // unchanged (chain 100 < local 500)
})

// ── Disabled mode ────────────────────────────────────────────────────────────

test('disabled mode: no chain env → enabled=false, settle returns {enabled:false}', async () => {
  const state = freshState()
  const gw = new SettlementGateway({ state, env: { DEMO_PAYER_SEED: TEST_ENV.DEMO_PAYER_SEED } })
  assert.equal(gw.enabled, false)
  // The engine still accrues (shadow ledger), but settle is a no-op.
  gw.onCall(1, 1000n, 'agent-1')
  assert.equal(gw.pendingTotal(), 1000n)
  assert.deepEqual(await gw.settle(), { enabled: false })
  assert.deepEqual(await gw.reconcile(), { enabled: false, adopted: 0 })
  assert.equal(gw.publicStatus().enabled, false)
  assert.equal(gw.publicStatus().gatewayAddress, null)
})
