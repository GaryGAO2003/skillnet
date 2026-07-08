'use strict'
/**
 * Engine conservation — the money invariant.
 * For a bundle-of-bundles DAG, the per-call credited micro-units (BigInt wei) must sum
 * EXACTLY to the call price, for every price including awkward ones (1, primes, huge).
 * Imports the VENDORED engine (demo/settlement/engine.mjs) — the exact copy server.js
 * runs — so this proves the runtime money path conserves.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SettlementEngine } from '../settlement/engine.mjs'

// Bundle-of-bundles: TOP(8) = M1(6) + M2(7) + leaf E(5); M1 = A+B; M2 = C+D.
const skills = {
  1: { name: 'A', creator: 'alice' }, 2: { name: 'B', creator: 'bob' },
  3: { name: 'C', creator: 'carol' }, 4: { name: 'D', creator: 'dave' },
  5: { name: 'E', creator: 'erin' },
  6: { name: 'M1', creator: 'mallory' }, 7: { name: 'M2', creator: 'niaj' },
  8: { name: 'TOP', creator: 'olivia' },
}
const deps = {
  1: [], 2: [], 3: [], 4: [], 5: [],
  6: [{ parentSkillId: 1, weight: 40 }, { parentSkillId: 2, weight: 60 }],
  7: [{ parentSkillId: 3, weight: 50 }, { parentSkillId: 4, weight: 50 }],
  8: [{ parentSkillId: 6, weight: 33 }, { parentSkillId: 7, weight: 33 }, { parentSkillId: 5, weight: 34 }],
}

// Awkward prices: tiny, primes, powers, and a value bigger than 2^63.
const PRICES = [1n, 2n, 3n, 5n, 7n, 13n, 97n, 101n, 999n, 9973n, 1000n, 1000000n, 12345678901234567890n]

function sumAccrued(engine) {
  let s = 0n
  for (const v of engine.accrued.values()) s += v
  return s
}

test('per-call credited micro-units sum exactly to price (bundle-of-bundles, every awkward price)', () => {
  for (const price of PRICES) {
    const e = new SettlementEngine(skills, deps)
    e.recordCall(8, price, 'payer')
    assert.equal(sumAccrued(e), price, `accrual conservation for price=${price}`)

    // buildBatch re-asserts internally and returns netted totals that must all equal price.
    const batch = e.buildBatch()
    assert.equal(batch.totalCredited, price, `totalCredited for price=${price}`)
    assert.equal(batch.totalDebited, price, `totalDebited for price=${price}`)
    assert.equal(batch.batchValue, price, `batchValue for price=${price}`)
  }
})

test('conservation holds when calling composites at every DAG level', () => {
  for (const startId of [1, 5, 6, 7, 8]) {
    for (const price of PRICES) {
      const e = new SettlementEngine(skills, deps)
      e.recordCall(startId, price, 'payer')
      assert.equal(sumAccrued(e), price, `skill=${startId} price=${price}`)
    }
  }
})

test('multi-call, multi-caller batch conserves cumulatively', () => {
  const e = new SettlementEngine(skills, deps)
  let total = 0n
  for (const [sid, val, caller] of [[8, 15n, 'x'], [6, 3n, 'y'], [7, 7n, 'x'], [1, 1n, 'z'], [8, 9973n, 'y']]) {
    e.recordCall(sid, val, caller)
    total += val
  }
  const batch = e.buildBatch()
  assert.equal(batch.totalCredited, total)
  assert.equal(batch.totalDebited, total)
  assert.equal(batch.batchValue, total)
})

test('no recipient is ever credited a negative amount (no over-distribution)', () => {
  for (const price of PRICES) {
    const e = new SettlementEngine(skills, deps)
    e.recordCall(8, price, 'payer')
    for (const [recipient, v] of e.accrued.entries()) {
      assert.ok(v >= 0n, `recipient ${recipient} negative for price=${price}`)
    }
  }
})

test('protocol share is exactly floor(price * 10%) off the top', () => {
  for (const price of PRICES) {
    const e = new SettlementEngine(skills, deps)
    e.recordCall(8, price, 'payer')
    assert.equal(e.accrued.get('treasury') ?? 0n, (price * 1000n) / 10000n, `protocol for price=${price}`)
  }
})
