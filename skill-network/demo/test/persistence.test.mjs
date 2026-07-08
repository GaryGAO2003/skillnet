'use strict'
/**
 * Persistence — BigInt balances round-trip through the JSON snapshot, and legacy float
 * snapshots migrate to micro-units on load instead of crashing.
 * Runs the real server (dev mode so writes are unsigned) so it exercises the actual
 * serializeState/loadState path, not a re-implementation.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startServer, stopServer } from './helpers.mjs'

const wait = ms => new Promise(r => setTimeout(r, ms))

test('BigInt balances survive snapshot → reload intact', async () => {
  const dir       = mkdtempSync(path.join(os.tmpdir(), 'skillnet-persist-'))
  const stateFile = path.join(dir, 'state.json')

  // First boot: fresh seed (dev mode so we can call unsigned).
  const s1 = await startServer({ AUTH_MODE: 'dev', STATE_FILE: stateFile })
  try {
    // Mutate: pay for a call (credits carol, the leaf creator of skill 3).
    const callBody = JSON.stringify({ caller: 'zoe', value: 0.001, input: '' })
    const cr = await fetch(s1.base + '/api/call/3', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: callBody,
    })
    assert.equal(cr.status, 200)

    const before = await (await fetch(s1.base + '/api/state')).json()
    assert.ok(BigInt(before.balancesMicro.carol) > 0n, 'carol should have a positive balance')

    await wait(1400)   // let the debounced (~1s) atomic snapshot flush
  } finally {
    await stopServer(s1.proc)
  }

  // Snapshot on disk must encode balances as decimal strings (BigInt-safe), not numbers.
  const snap = JSON.parse(readFileSync(stateFile, 'utf8'))
  assert.equal(typeof snap.balances.carol, 'string', 'balances persisted as strings')
  const persistedCarol = snap.balances.carol

  // Second boot: reload the same snapshot; balances (BigInt) must be identical.
  const s2 = await startServer({ AUTH_MODE: 'dev', STATE_FILE: stateFile })
  try {
    const after = await (await fetch(s2.base + '/api/state')).json()
    assert.equal(after.balancesMicro.carol, persistedCarol, 'carol balance intact across reload')
    assert.ok(BigInt(after.balancesMicro.treasury) >= 0n)
  } finally {
    await stopServer(s2.proc)
  }
})

test('legacy float snapshot migrates to micro-units on load (no crash)', async () => {
  const dir       = mkdtempSync(path.join(os.tmpdir(), 'skillnet-migrate-'))
  const stateFile = path.join(dir, 'state.json')

  // Old-format snapshot: balances are floating-point display numbers.
  writeFileSync(stateFile, JSON.stringify({
    nextId: 50,
    skills: {}, deps: {}, depOf: {}, depth: {},
    balances: { alice: 0.0015, bob: 0.0009, treasury: 0.003 },
    txLog: [],
    creators: {},
  }))

  const srv = await startServer({ AUTH_MODE: 'dev', STATE_FILE: stateFile })
  try {
    const state = await (await fetch(srv.base + '/api/state')).json()
    // 0.0015 * 1e18 = 1.5e15 wei, etc. — migrated exactly, display value preserved.
    assert.equal(state.balancesMicro.alice, '1500000000000000')
    assert.equal(state.balancesMicro.bob, '900000000000000')
    assert.equal(state.balancesMicro.treasury, '3000000000000000')
    assert.equal(state.balances.alice, 0.0015)
    assert.equal(state.balances.bob, 0.0009)
  } finally {
    await stopServer(srv.proc)
  }
})
