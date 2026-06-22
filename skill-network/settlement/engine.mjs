'use strict'
/**
 * SkillNet off-chain settlement engine.
 * ─────────────────────────────────────────────────────────────────────────────
 * Per call: accrue per-recipient balances via the SAME conserving rho-flow used on-chain
 * (FeeRouter._royalty / demo distributeRoyalty), and track each caller's cumulative spend.
 * On settle: emit a netted credit list + one cumulative-spend voucher per caller, which the
 * SettlementVault contract verifies (EIP-712) and settles in a single batched transaction.
 *
 * All amounts are BigInt wei, so the engine's arithmetic matches the contract's integer math
 * exactly (the same "node keeps amount - distributed" rule → exact conservation, no float dust).
 *
 * The voucher signing itself (EIP-712) is done by the payer's wallet and verified on-chain;
 * see contracts/test/SettlementVault.t.sol for the cryptographic proof. This engine produces the
 * voucher CONTENTS ({payer, cumulativeSpent}) and the netted credits; it does not hold keys.
 */

export const PROTOCOL_BPS = 1000n // 10% protocol fee, off the top
export const RHO_BPS       = 2000n // 20% upstream pass-through per composition hop

export class SettlementEngine {
  /**
   * @param {Object} skills  id -> { name, creator }   (creator is the payable address/label)
   * @param {Object} deps    id -> [{ parentSkillId, weight }]   (weights sum to 100)
   */
  constructor(skills, deps) {
    this.skills = skills
    this.deps = deps
    this.accrued = new Map()       // recipient -> bigint owed since last batch
    this.callerSpent = new Map()   // caller -> bigint cumulative spend (ever)
    this.lastVouchered = new Map()  // caller -> bigint cumulative already put on a voucher
    this.batchValue = 0n           // total call value accrued since last batch
    this.callsThisBatch = 0
  }

  _credit(recipient, amount) {
    this.accrued.set(recipient, (this.accrued.get(recipient) || 0n) + amount)
  }

  /** Conserving rho-flow — identical semantics to FeeRouter._royalty / demo distributeRoyalty. */
  _royalty(skillId, amount) {
    const creator = this.skills[skillId].creator
    const edges = this.deps[skillId] || []
    if (edges.length === 0) {
      this._credit(creator, amount) // leaf keeps everything
      return
    }
    const passUp = (amount * RHO_BPS) / 10000n
    let distributed = 0n
    for (const e of edges) {
      const share = (passUp * BigInt(e.weight)) / 100n
      this._royalty(e.parentSkillId, share)
      distributed += share
    }
    this._credit(creator, amount - distributed) // keeps (1-RHO)*amount + dust
  }

  /** Record one skill call (off-chain, instant, free). */
  recordCall(skillId, valueWei, caller) {
    valueWei = BigInt(valueWei)
    const protocol = (valueWei * PROTOCOL_BPS) / 10000n
    this._credit('treasury', protocol)
    const net = valueWei - protocol
    this._royalty(skillId, net)
    this.callerSpent.set(caller, (this.callerSpent.get(caller) || 0n) + valueWei)
    this.batchValue += valueWei
    this.callsThisBatch += 1
  }

  /** Total currently accrued (across all recipients) and not yet settled. */
  pendingTotal() {
    let s = 0n
    for (const v of this.accrued.values()) s += v
    return s
  }

  /**
   * Produce a settlement batch and reset the accrual window.
   * @returns {{vouchers, credits, totalCredited, totalDebited, batchValue, calls}}
   *   vouchers: [{ payer, cumulativeSpent, deltaThisBatch }]  (cumulativeSpent is what the payer signs)
   *   credits:  [{ recipient, amount }]                       (netted; ready for settleBatch)
   * Invariant (asserted): totalCredited === totalDebited === batchValue.
   */
  buildBatch() {
    const credits = [...this.accrued.entries()]
      .map(([recipient, amount]) => ({ recipient, amount }))
      .filter(c => c.amount > 0n)

    const vouchers = []
    for (const [payer, cumulative] of this.callerSpent.entries()) {
      const last = this.lastVouchered.get(payer) || 0n
      if (cumulative > last) {
        vouchers.push({ payer, cumulativeSpent: cumulative, deltaThisBatch: cumulative - last })
        this.lastVouchered.set(payer, cumulative)
      }
    }

    const totalCredited = credits.reduce((a, c) => a + c.amount, 0n)
    const totalDebited  = vouchers.reduce((a, v) => a + v.deltaThisBatch, 0n)
    const batchValue = this.batchValue
    const calls = this.callsThisBatch

    // Conservation: what we debit from payers exactly equals what we credit to recipients,
    // and both equal the total call value in this window. Mirrors the on-chain require().
    if (!(totalCredited === totalDebited && totalDebited === batchValue)) {
      throw new Error(`engine conservation broken: credited=${totalCredited} debited=${totalDebited} value=${batchValue}`)
    }

    // reset window
    this.accrued = new Map()
    this.batchValue = 0n
    this.callsThisBatch = 0

    return { vouchers, credits, totalCredited, totalDebited, batchValue, calls }
  }
}
