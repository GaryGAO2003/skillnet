'use strict'
/**
 * API payment floor — the /api/call/:id money endpoint must mirror FeeRouter.sol's
 * `require(msg.value >= skill.pricePerCall, "insufficient payment")`, compared in exact
 * BigInt wei (never floats):
 *   1. a price-0 skill is callable with value 0 → no credit occurs
 *   2. underpaying a priced skill → 400 and no state change (totalCalls unchanged)
 *   3. omitting `value` defaults to the exact price and the breakdown conserves exactly
 *   4. overpaying is allowed and conserves at the paid amount
 *
 * Boots server.js in AUTH_MODE=signature against a FRESH (non-existent) temp STATE_FILE so
 * the standard 8-skill seed runs: id 1 = "JSON Parser" (price 0, creator alice),
 * id 8 = "Full Audit Suite" (price 0.015, creator bob, composed 6+7+5). Calls are signed by
 * a throwaway key — calling requires a valid signature, not resource ownership.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer, stopServer, signHeaders, security } from './helpers.mjs'

const wei = (int, exp) => (BigInt(int) * 10n ** BigInt(exp)).toString()   // 0.015 → wei('15',15)

let srv, caller

before(async () => {
  caller = security.generateCreatorKeypair()
  // Point STATE_FILE at a path that does NOT exist so the server seeds the 8 demo skills.
  const dir       = mkdtempSync(path.join(os.tmpdir(), 'skillnet-pay-'))
  const stateFile = path.join(dir, 'state.json')
  srv = await startServer({ AUTH_MODE: 'signature', STATE_FILE: stateFile })
})

after(async () => { if (srv) await stopServer(srv.proc) })

/** POST /api/call/:id with a fresh Ed25519 signature over the exact body bytes. */
function signedCall(id, body) {
  const pathname = `/api/call/${id}`
  const bodyStr  = JSON.stringify(body)
  const h = signHeaders(caller.privJwk, caller.pubKey, 'POST', pathname, bodyStr)
  return fetch(srv.base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...h },
    body: bodyStr,
  })
}

const getState  = async () => (await fetch(srv.base + '/api/state')).json()
const skillById = (state, id) => state.skills.find(s => s.id === id)

/** protocol + creatorTotal + Σ upstream, all in exact wei — must equal value. */
function conservedSum(tx) {
  return (BigInt(tx.breakdown.protocolMicro)
        + BigInt(tx.breakdown.creatorTotalMicro)
        + tx.breakdown.upstream.reduce((a, u) => a + BigInt(u.amountMicro), 0n)).toString()
}

test('price-0 skill (JSON Parser #1) called with value 0 → 200, no credit', async () => {
  const before = await getState()

  const r = await signedCall(1, { value: 0, caller: 'tester' })
  assert.equal(r.status, 200)
  const { tx } = await r.json()
  assert.equal(tx.value, 0)
  assert.equal(tx.valueMicro, '0')

  const after = await getState()
  // No money moved: the free skill's creator (alice) and the treasury are untouched.
  assert.equal(after.balancesMicro.alice,    before.balancesMicro.alice)
  assert.equal(after.balancesMicro.treasury, before.balancesMicro.treasury)
})

test('priced skill (#8, 0.015) underpaid with value 0.001 → 400, totalCalls unchanged', async () => {
  const callsBefore = skillById(await getState(), 8).totalCalls

  const r = await signedCall(8, { value: 0.001, caller: 'tester' })
  assert.equal(r.status, 400)
  assert.match((await r.json()).error, /Insufficient payment/)

  // The wei-floor guard runs BEFORE payForCall, so nothing accrued and no call was counted.
  assert.equal(skillById(await getState(), 8).totalCalls, callsBefore)
})

test('priced skill (#8) with NO value → 200, defaults to exact price, breakdown conserves', async () => {
  const r = await signedCall(8, { caller: 'tester' })   // no value field → defaults to price
  assert.equal(r.status, 200)
  const { tx } = await r.json()

  assert.equal(tx.value, 0.015)
  assert.equal(tx.valueMicro, wei('15', 15))            // 0.015 * 1e18
  assert.equal(conservedSum(tx), tx.valueMicro)         // exact BigInt conservation
})

test('priced skill (#8) overpaid with value 0.02 → 200 and conserves at 0.02', async () => {
  const r = await signedCall(8, { value: 0.02, caller: 'tester' })
  assert.equal(r.status, 200)
  const { tx } = await r.json()

  assert.equal(tx.valueMicro, wei('2', 16))             // 0.02 * 1e18
  assert.equal(conservedSum(tx), tx.valueMicro)
})
