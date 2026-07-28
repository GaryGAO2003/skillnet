'use strict'
/**
 * SkillNet settlement gateway — closes the loop between the demo's off-chain money path and
 * the on-chain SettlementVault (Base Sepolia).
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IT DOES
 *   • Runs ONE long-lived SettlementEngine fed the same (skillId, valueWei, caller) events as
 *     the demo's money path — an on-chain shadow of post-boot API activity. It never touches
 *     the demo's own `state.balances` ledger; the two run in parallel.
 *   • On settle(): snapshots the accrual window, asks the engine to buildBatch() (cumulative
 *     per-payer vouchers + a netted credit list), has each payer's derived account sign an
 *     EIP-712 voucher, and submits settleBatch() from the gateway account. If the submit
 *     reverts/times out it RESTORES the snapshotted window so nothing is lost.
 *
 * ── DEMO-MODE CUSTODY ────────────────────────────────────────────────────────
 * In PRODUCTION each payer signs its own cumulative voucher client-side and the gateway never
 * sees a payer key. Here, for a self-contained testnet demo, the gateway DERIVES a deterministic
 * throwaway wallet per caller name from DEMO_PAYER_SEED and signs on their behalf. These wallets
 * hold only what you deposit for the demo. This is a testnet simplification, NOT a production
 * trust model.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import {
  createPublicClient, createWalletClient, http,
  keccak256, concat, toHex, getAddress, isAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { SettlementEngine } from './settlement/engine.mjs'
import { settlementVaultAbi } from './abi/settlementVault.mjs'

// Base Sepolia. The EIP-712 domain chainId is pinned here (independent of the RPC) so it
// always matches the deployed SettlementVault's domain, exactly as the contract computes it.
export const CHAIN_ID = 84532n

// EIP-712 domain/type — must byte-match SettlementVault's EIP712("SkillNetSettlement","1")
// and VOUCHER_TYPEHASH = keccak256("Voucher(address payer,uint256 cumulativeSpent)").
export const VOUCHER_TYPES = {
  Voucher: [
    { name: 'payer', type: 'address' },
    { name: 'cumulativeSpent', type: 'uint256' },
  ],
}

// Fixed dev fallback seed for deterministic demo payer wallets when DEMO_PAYER_SEED is unset.
// DEMO-ONLY — a stable, non-secret constant so derived addresses are reproducible across boots.
const DEFAULT_DEMO_PAYER_SEED =
  '0x5c1117e5544c7de1cf7e0b4a1f4f4a53b6a2f3e2b8c1d0a9f6e5d4c3b2a19080'

const DEFAULT_THRESHOLD_WEI = 20000000000000000n // 0.02 ETH
const DEFAULT_MIN_INTERVAL_MS = 60000

/** Add a 0x prefix and lowercase, tolerating keys/seeds supplied with or without it. */
function normalizeHex(v) {
  if (!v) return null
  const s = String(v).trim()
  return (s.startsWith('0x') || s.startsWith('0X')) ? '0x' + s.slice(2) : '0x' + s
}

/** Map<string,bigint> → { key: decimalString } for JSON persistence. */
function mapToStrObj(map) {
  const out = {}
  for (const [k, v] of map.entries()) out[k] = v.toString()
  return out
}

/** { key: decimalString } → Map<string,bigint>. */
function strObjToMap(obj) {
  const m = new Map()
  for (const [k, v] of Object.entries(obj || {})) m.set(k, BigInt(v))
  return m
}

export class SettlementGateway {
  /**
   * @param {Object}   opts
   * @param {Object}   opts.state    the server's live state object (owns state.skills/deps/settlements)
   * @param {Object}   [opts.env]    env source (defaults to process.env)
   * @param {Function} [opts.scheduleSave]  called after settle to persist (server's debounced saver)
   * @param {Object}   [opts.hooks]  test seams: { submitBatch, readSpent, now }
   */
  constructor({ state, env = process.env, scheduleSave = () => {}, hooks = {} } = {}) {
    this.state = state
    if (!Array.isArray(this.state.settlements)) this.state.settlements = []

    // Persistent on-chain shadow engine — references live skills/deps by reference so later
    // mints/composes are reflected. Fed the same events as the demo money path (post-boot only).
    this.engine = new SettlementEngine(state.skills, state.deps)

    // ── Config ──────────────────────────────────────────────────────────────
    this._pk = normalizeHex(env.GATEWAY_PRIVATE_KEY || env.PRIVATE_KEY)
    this._rpcUrl = env.BASE_SEPOLIA_RPC_URL || null
    const vaultRaw = env.SETTLEMENT_VAULT_ADDRESS || null
    this.vaultAddress = vaultRaw && isAddress(vaultRaw) ? getAddress(vaultRaw) : null
    const treasuryRaw = env.TREASURY_ADDRESS || null
    this.treasuryAddress = treasuryRaw && isAddress(treasuryRaw) ? getAddress(treasuryRaw) : null
    this.seed = normalizeHex(env.DEMO_PAYER_SEED) || DEFAULT_DEMO_PAYER_SEED

    this.threshold = env.SETTLE_THRESHOLD_WEI ? BigInt(env.SETTLE_THRESHOLD_WEI) : DEFAULT_THRESHOLD_WEI
    this.minInterval = env.SETTLE_MIN_INTERVAL_MS ? Number(env.SETTLE_MIN_INTERVAL_MS) : DEFAULT_MIN_INTERVAL_MS

    this._scheduleSave = scheduleSave
    this._now = hooks.now || (() => Date.now())
    this.lastSettleAt = 0
    this._busy = false
    this._accountCache = new Map()

    // Enabled iff we have the three things needed to submit a real batch.
    this.enabled = Boolean(this._pk && this._rpcUrl && this.vaultAddress)

    // Test seams override the real chain I/O; otherwise bind the on-chain implementations.
    this._submitBatch = hooks.submitBatch || this._submitBatchOnchain.bind(this)
    this._readSpent = hooks.readSpent || this._readSpentOnchain.bind(this)

    if (this.enabled) {
      this.gatewayAccount = privateKeyToAccount(this._pk)
      this.publicClient = createPublicClient({ chain: baseSepolia, transport: http(this._rpcUrl) })
      this.walletClient = createWalletClient({ account: this.gatewayAccount, chain: baseSepolia, transport: http(this._rpcUrl) })
      this.domain = {
        name: 'SkillNetSettlement',
        version: '1',
        chainId: Number(CHAIN_ID),
        verifyingContract: this.vaultAddress,
      }
    }
  }

  // ── Identity binding (deterministic demo wallets) ─────────────────────────

  /** Derive a caller's private key = keccak256(seed || utf8(name)). DEMO-MODE CUSTODY. */
  _privKeyFor(name) {
    return keccak256(concat([this.seed, toHex(name)]))
  }

  /** The local signing account for a caller name (throws for treasury / no-key recipients). */
  accountFor(name) {
    if (name === 'treasury') throw new Error(`no key for 'treasury' (it is a credit recipient, never a payer)`)
    let a = this._accountCache.get(name)
    if (!a) { a = privateKeyToAccount(this._privKeyFor(name)); this._accountCache.set(name, a) }
    return a
  }

  /** The on-chain address for a recipient/payer name. treasury → TREASURY_ADDRESS. */
  addressFor(name) {
    if (name === 'treasury') {
      if (!this.treasuryAddress) throw new Error('TREASURY_ADDRESS not configured (needed to credit treasury)')
      return this.treasuryAddress
    }
    return this.accountFor(name).address
  }

  // ── Engine feed + threshold auto-settle ───────────────────────────────────

  /** Feed one paid call into the shadow engine, then fire-and-forget a threshold settle. */
  onCall(skillId, valueWei, caller) {
    this.engine.recordCall(skillId, BigInt(valueWei), caller)
    if (!this.enabled) return
    if (this.engine.pendingTotal() >= this.threshold && (this._now() - this.lastSettleAt) >= this.minInterval) {
      // never block or fail the call response
      this.settle().catch(err => console.error('  ⚠ auto-settle failed:', err.message))
    }
  }

  /** Total accrued and not yet settled (wei). */
  pendingTotal() { return this.engine.pendingTotal() }

  // ── Two-phase settle (the critical correctness piece) ─────────────────────

  /**
   * Settle the current window on-chain. Mutex-guarded and min-interval-guarded.
   * Returns a plain (BigInt-free) result: {enabled:false} | {busy:true} |
   * {skipped, reason} | {ok:true, ...record} | {ok:false, error}.
   */
  async settle(opts = {}) {
    if (!this.enabled) return { enabled: false }
    if (this._busy) return { busy: true }
    if (!opts.force && (this._now() - this.lastSettleAt) < this.minInterval) {
      return { skipped: true, reason: 'min-interval' }
    }
    if (this.engine.pendingTotal() === 0n) return { skipped: true, reason: 'nothing-to-settle' }

    this._busy = true
    // Snapshot the window BEFORE buildBatch (which resets accrued/batchValue/callsThisBatch and
    // advances lastVouchered). A failed submit restores this exactly.
    const snapshot = {
      accrued: new Map(this.engine.accrued),
      lastVouchered: new Map(this.engine.lastVouchered),
      batchValue: this.engine.batchValue,
      callsThisBatch: this.engine.callsThisBatch,
    }

    // Phase 1: build. If buildBatch throws (conservation), it happens BEFORE the reset but AFTER
    // it may have advanced lastVouchered — so accrued is intact and only lastVouchered rolls back.
    let batch
    try {
      batch = this.engine.buildBatch()
    } catch (err) {
      this.engine.lastVouchered = new Map(snapshot.lastVouchered)
      this._busy = false
      return { ok: false, error: err.message || 'buildBatch failed' }
    }

    if (batch.credits.length === 0) {
      this._busy = false
      return { skipped: true, reason: 'nothing-to-settle' }
    }

    // Phase 2: sign + map + submit. buildBatch already reset the window, so ANY failure here
    // must merge-restore the snapshot (do not clobber concurrent accruals) and roll back lastVouchered.
    try {
      const onchainVouchers = []
      const sigs = []
      for (const v of batch.vouchers) {
        const account = this.accountFor(v.payer)
        const message = { payer: account.address, cumulativeSpent: v.cumulativeSpent }
        const signature = await account.signTypedData({ domain: this.domain, types: VOUCHER_TYPES, primaryType: 'Voucher', message })
        onchainVouchers.push({ payer: account.address, cumulativeSpent: v.cumulativeSpent })
        sigs.push(signature)
      }
      // Every credit recipient name must resolve to an address BEFORE we submit.
      const onchainCredits = batch.credits.map(c => ({ recipient: this.addressFor(c.recipient), amount: c.amount }))

      const { txHash, blockNumber } = await this._submitBatch(onchainVouchers, sigs, onchainCredits)

      this.lastSettleAt = this._now()
      const record = {
        txHash,
        blockNumber: blockNumber != null ? blockNumber.toString() : null,
        batchValue: batch.batchValue.toString(),
        calls: batch.calls,
        credits: onchainCredits.length,
        vouchers: onchainVouchers.length,
        timestamp: new Date().toISOString(),
      }
      this.state.settlements.unshift(record)
      if (this.state.settlements.length > 50) this.state.settlements.length = 50
      this._scheduleSave()
      return { ok: true, ...record }
    } catch (err) {
      // Restore the window: merge-ADD the snapshot's accrued into whatever accrued concurrently
      // (never clobber), re-add batchValue/callsThisBatch, and roll lastVouchered back.
      for (const [r, amt] of snapshot.accrued) {
        this.engine.accrued.set(r, (this.engine.accrued.get(r) || 0n) + amt)
      }
      this.engine.batchValue += snapshot.batchValue
      this.engine.callsThisBatch += snapshot.callsThisBatch
      this.engine.lastVouchered = new Map(snapshot.lastVouchered)
      this._scheduleSave()
      return { ok: false, error: err.shortMessage || err.message || 'settle submit failed' }
    } finally {
      this._busy = false
    }
  }

  /** Real on-chain submit: writeContract → waitForTransactionReceipt. Throws on revert/timeout. */
  async _submitBatchOnchain(vouchers, sigs, credits) {
    const hash = await this.walletClient.writeContract({
      address: this.vaultAddress,
      abi: settlementVaultAbi,
      functionName: 'settleBatch',
      args: [vouchers, sigs, credits],
    })
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })
    if (receipt.status !== 'success') throw new Error('settleBatch reverted on-chain')
    return { txHash: hash, blockNumber: receipt.blockNumber }
  }

  /** Real on-chain read of spent[address]. */
  async _readSpentOnchain(address) {
    return this.publicClient.readContract({
      address: this.vaultAddress, abi: settlementVaultAbi, functionName: 'spent', args: [address],
    })
  }

  // ── Boot reconciliation ───────────────────────────────────────────────────

  /**
   * On startup, for each known payer read on-chain spent(payer); if chain > local lastVouchered,
   * adopt the chain value (chain is truth — prevents "stale voucher" reverts after state loss).
   */
  async reconcile() {
    if (!this.enabled) return { enabled: false, adopted: 0 }
    let adopted = 0
    for (const payer of this.engine.callerSpent.keys()) {
      if (payer === 'treasury') continue
      try {
        const chainSpent = await this._readSpent(this.addressFor(payer))
        const local = this.engine.lastVouchered.get(payer) || 0n
        if (chainSpent > local) { this.engine.lastVouchered.set(payer, chainSpent); adopted++ }
      } catch (err) {
        console.error(`  ⚠ reconcile(${payer}) failed:`, err.message)
      }
    }
    return { enabled: true, adopted }
  }

  // ── Persistence (additive; consumed by server serializeState/loadState) ────

  /** Engine cumulative + current window as a JSON-safe object. */
  serializeEngine() {
    return {
      callerSpent: mapToStrObj(this.engine.callerSpent),
      lastVouchered: mapToStrObj(this.engine.lastVouchered),
      accrued: mapToStrObj(this.engine.accrued),
      batchValue: this.engine.batchValue.toString(),
      callsThisBatch: this.engine.callsThisBatch,
    }
  }

  /** Restore engine cumulative + window from a persisted blob. No-op for old snapshots (raw null). */
  hydrate(raw) {
    if (!raw) return
    this.engine.callerSpent = strObjToMap(raw.callerSpent)
    this.engine.lastVouchered = strObjToMap(raw.lastVouchered)
    this.engine.accrued = strObjToMap(raw.accrued)
    this.engine.batchValue = BigInt(raw.batchValue || '0')
    this.engine.callsThisBatch = Number(raw.callsThisBatch || 0)
  }

  // ── Public status (GET /api/settlements) ──────────────────────────────────

  publicStatus() {
    return {
      enabled: this.enabled,
      gatewayAddress: this.enabled ? this.gatewayAccount.address : null,
      vaultAddress: this.vaultAddress || null,
      pendingWei: this.engine.pendingTotal().toString(),
      threshold: this.threshold.toString(),
      settlements: this.state.settlements,
    }
  }
}

/**
 * Standalone payer-wallet derivation — the single source of truth for name→wallet mapping,
 * reused by the E2E script so its deposits land on the exact addresses the gateway settles.
 * DEMO-MODE CUSTODY (see file header).
 */
export function derivePayerAccount(seedHex, name) {
  return privateKeyToAccount(keccak256(concat([normalizeHex(seedHex) || DEFAULT_DEMO_PAYER_SEED, toHex(name)])))
}
export function derivePayerAddress(seedHex, name) {
  return derivePayerAccount(seedHex, name).address
}
export { DEFAULT_DEMO_PAYER_SEED }
