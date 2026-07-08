'use strict'
/**
 * Vendored-copy drift guard.
 * demo/settlement/ is a byte-for-byte vendored copy of skill-network/settlement/ (server.js
 * imports the vendored copy so it works inside the Docker build context, whose root is demo/).
 * If the canonical engine changes but the vendored copy isn't re-synced, the demo would silently
 * run stale money math. This test fails loudly with re-sync instructions when they drift.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_DIR  = path.resolve(__dirname, '..')                     // skill-network/demo
const CANONICAL = path.resolve(DEMO_DIR, '..', 'settlement')        // skill-network/settlement
const VENDORED  = path.join(DEMO_DIR, 'settlement')                 // skill-network/demo/settlement

const FILES = ['engine.mjs', 'run-demo.mjs', 'README.md']

for (const f of FILES) {
  test(`vendored settlement/${f} is byte-identical to the canonical copy`, () => {
    const canonical = readFileSync(path.join(CANONICAL, f))
    const vendored  = readFileSync(path.join(VENDORED, f))
    assert.ok(
      canonical.equals(vendored),
      `\n  DRIFT: skill-network/demo/settlement/${f} differs from skill-network/settlement/${f}.\n` +
      `  The vendored copy is the Docker/runtime import and must match the canonical source.\n` +
      `  Re-sync:  cp skill-network/settlement/${f}  skill-network/demo/settlement/${f}\n`,
    )
  })
}
