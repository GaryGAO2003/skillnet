'use strict'
/**
 * API auth — the withdraw money endpoint is signature-gated and owner-bound.
 * Boots server.js in AUTH_MODE=signature against a temp STATE_FILE that pre-seeds creator
 * "alice" with a known Ed25519 key and a 1.0-unit balance, then checks:
 *   unsigned withdraw            → 401
 *   signed by the wrong identity → 403
 *   signed by the owner          → 200 and the balance is zeroed (exact BigInt).
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer, stopServer, signHeaders, security } from './helpers.mjs'

const ONE_UNIT_WEI = (10n ** 18n).toString()   // 1.0 display unit == 1e18 wei

let srv, owner, other

before(async () => {
  owner = security.generateCreatorKeypair()
  other = security.generateCreatorKeypair()

  const dir       = mkdtempSync(path.join(os.tmpdir(), 'skillnet-auth-'))
  const stateFile = path.join(dir, 'state.json')
  writeFileSync(stateFile, JSON.stringify({
    nextId:   100,
    skills:   {}, deps: {}, depOf: {}, depth: {},
    balances: { alice: ONE_UNIT_WEI, treasury: '0' },   // new format: wei as decimal strings
    txLog:    [],
    creators: { alice: { pubKey: owner.pubKey } },       // balance ownership binding
  }))

  srv = await startServer({ AUTH_MODE: 'signature', STATE_FILE: stateFile })
})

after(async () => { if (srv) await stopServer(srv.proc) })

function rawPost(pathname, bodyStr, headers = {}) {
  return fetch(srv.base + pathname, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: bodyStr,
  })
}

test('unsigned withdraw → 401', async () => {
  const r = await rawPost('/api/withdraw', JSON.stringify({ user: 'alice' }))
  assert.equal(r.status, 401)
})

test('signed withdraw by WRONG identity → 403', async () => {
  const bodyStr = JSON.stringify({ user: 'alice' })
  const h = signHeaders(other.privJwk, other.pubKey, 'POST', '/api/withdraw', bodyStr)
  const r = await rawPost('/api/withdraw', bodyStr, h)
  assert.equal(r.status, 403)
})

test('signed withdraw by OWNER → 200 and balance zeroed (exact)', async () => {
  const bodyStr = JSON.stringify({ user: 'alice' })
  const h = signHeaders(owner.privJwk, owner.pubKey, 'POST', '/api/withdraw', bodyStr)
  const r = await rawPost('/api/withdraw', bodyStr, h)
  assert.equal(r.status, 200)

  const j = await r.json()
  assert.equal(j.success, true)
  assert.equal(j.tx.amountMicro, ONE_UNIT_WEI)   // exact integer returned to precision consumers
  assert.equal(j.tx.amount, 1)                    // backward-compatible display number

  const state = await (await fetch(srv.base + '/api/state')).json()
  assert.equal(state.balancesMicro.alice, '0')
  assert.equal(state.balances.alice, 0)
})

test('a second owner-signed withdraw with nothing left → 400', async () => {
  const bodyStr = JSON.stringify({ user: 'alice' })
  const h = signHeaders(owner.privJwk, owner.pubKey, 'POST', '/api/withdraw', bodyStr)
  const r = await rawPost('/api/withdraw', bodyStr, h)
  assert.equal(r.status, 400)   // "Nothing to withdraw"
})
