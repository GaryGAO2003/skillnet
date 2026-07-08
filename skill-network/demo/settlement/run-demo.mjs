'use strict'
/**
 * Demo: drive the off-chain settlement engine with the SkillNet seed DAG and show that
 * many sub-cent calls collapse into a few batched on-chain settlements, conserving every wei.
 *
 * Run:  node skill-network/settlement/run-demo.mjs
 */
import { SettlementEngine } from './engine.mjs'

// ── Seed DAG (mirrors demo/server.js) ────────────────────────────────────────
const skills = {
  1: { name: 'JSON Parser',        creator: 'alice' },
  2: { name: 'Web Scraper',        creator: 'bob'   },
  3: { name: 'Sentiment Analyzer', creator: 'carol' },
  4: { name: 'Solidity Auditor',   creator: 'alice' },
  5: { name: 'Medical Diagnosis',  creator: 'bob'   },
  6: { name: 'Data Pipeline',      creator: 'carol' },
  7: { name: 'DeFi Research Agent',creator: 'alice' },
  8: { name: 'Full Audit Suite',   creator: 'bob'   },
}
const deps = {
  6: [{ parentSkillId: 1, weight: 40 }, { parentSkillId: 2, weight: 60 }],
  7: [{ parentSkillId: 3, weight: 50 }, { parentSkillId: 4, weight: 50 }],
  8: [{ parentSkillId: 6, weight: 33 }, { parentSkillId: 7, weight: 33 }, { parentSkillId: 5, weight: 34 }],
}
// prices in wei (BigInt)
const PRICE = {
  3: 1_000_000_000_000_000n,   // 0.001
  4: 5_000_000_000_000_000n,   // 0.005
  5: 10_000_000_000_000_000n,  // 0.01
  6: 1_000_000_000_000_000n,   // 0.001
  7: 8_000_000_000_000_000n,   // 0.008
  8: 15_000_000_000_000_000n,  // 0.015
}

// ── Helpers ──────────────────────────────────────────────────────────────────
const E = 1_000_000_000_000_000_000n
function eth(wei) {
  const neg = wei < 0n
  wei = neg ? -wei : wei
  const whole = wei / E
  const frac = (wei % E).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '')
  return `${neg ? '-' : ''}${whole}${frac ? '.' + frac : ''}`
}

// ── Drive a deterministic workload ───────────────────────────────────────────
const engine = new SettlementEngine(skills, deps)
// A real gateway settles on a threshold (accrued >= ~$0.05-$1) OR a timer OR on-demand. For a clear
// demo headline we settle once per 100-call window; lower this to trade latency for fewer on-chain txs.
const SETTLE_EVERY = 100
const callerCycle = ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5']
const skillCycle  = [8, 3, 7, 8, 6, 8, 5, 4] // mostly the "bundle of bundles" #8

const N_CALLS = 200
let totalValue = 0n
let totalCallsSettled = 0
const batches = []

for (let i = 0; i < N_CALLS; i++) {
  const skillId = skillCycle[i % skillCycle.length]
  const caller  = callerCycle[i % callerCycle.length]
  const value   = PRICE[skillId]
  engine.recordCall(skillId, value, caller)
  totalValue += value

  if (engine.callsThisBatch >= SETTLE_EVERY) {
    const batch = engine.buildBatch()
    batches.push(batch)
    totalCallsSettled += batch.calls
  }
}
// flush remainder
if (engine.pendingTotal() > 0n) {
  const batch = engine.buildBatch()
  batches.push(batch)
  totalCallsSettled += batch.calls
}

// ── Report ───────────────────────────────────────────────────────────────────
const totalCredited = batches.reduce((a, b) => a + b.totalCredited, 0n)
console.log('\n=== SkillNet off-chain settlement demo ===\n')
console.log(`Calls executed (off-chain, instant, free): ${N_CALLS}`)
console.log(`Total value paid by callers:               ${eth(totalValue)} ETH`)
console.log(`On-chain settlement transactions (batches): ${batches.length}`)
console.log(`Compression:                                ${N_CALLS} calls -> ${batches.length} txs (${(N_CALLS / batches.length).toFixed(0)}x)`)
console.log(`Total credited across all batches:          ${eth(totalCredited)} ETH`)
console.log(`Conserved (credited == paid):               ${totalCredited === totalValue}`)
console.log(`Calls accounted for in batches:             ${totalCallsSettled} / ${N_CALLS}`)

// Show one sample batch exactly as it would hit SettlementVault.settleBatch(...)
const sample = batches[0]
console.log(`\n--- Sample batch #1: ${sample.calls} calls -> 1 tx ---`)
console.log(`vouchers (payer signs cumulativeSpent via EIP-712; contract debits only the delta):`)
for (const v of sample.vouchers) {
  console.log(`   ${v.payer.padEnd(9)} cumulativeSpent=${eth(v.cumulativeSpent)} ETH  (delta this batch ${eth(v.deltaThisBatch)})`)
}
console.log(`credits (internal-ledger, one tx, no per-recipient account/rent):`)
for (const c of sample.credits) {
  console.log(`   ${String(c.recipient).padEnd(9)} += ${eth(c.amount)} ETH`)
}
console.log(`   batch totalDebited = ${eth(sample.totalDebited)}  totalCredited = ${eth(sample.totalCredited)}  (equal -> on-chain require passes)`)

// Hard asserts
if (totalCredited !== totalValue) { console.error('\nFAIL: not conserved'); process.exit(1) }
for (const b of batches) {
  if (b.totalCredited !== b.totalDebited) { console.error('\nFAIL: batch not conserved'); process.exit(1) }
}
console.log('\nOK: every batch conserves exactly; ' + N_CALLS + ' sub-cent calls settled in ' + batches.length + ' transactions.\n')
