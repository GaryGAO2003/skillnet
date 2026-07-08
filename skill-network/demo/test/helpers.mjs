'use strict'
/**
 * Shared test helpers (node:test). No tests here — imported by the *.test.mjs files.
 *   • startServer(env)  — spawn server.js on a random port, wait for /healthz.
 *   • signHeaders(...)  — build the x-skillnet-* Ed25519 headers for a signed request.
 * Reuses demo/security.js (CommonJS) via createRequire so signing matches the server exactly.
 */
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
export const security = require('../security.js')

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_DIR  = path.resolve(__dirname, '..')
const SERVER    = path.join(DEMO_DIR, 'server.js')

/** Build the canonical signed-request headers (matches demo/security.js). */
export function signHeaders(privJwk, pubKey, method, pathname, bodyStr) {
  const ts       = String(Date.now())
  const bodyHash = security.sha256hex(Buffer.from(bodyStr, 'utf8'))
  const message  = security.signingMessage(method, pathname, ts, bodyHash)
  const sig      = security.signEd25519(privJwk, message)
  return {
    'x-skillnet-pubkey':    pubKey,
    'x-skillnet-timestamp': ts,
    'x-skillnet-signature': sig,
  }
}

/** Spawn server.js on a random port with Hedera/Qwen disabled; resolve once /healthz is up. */
export async function startServer(env = {}) {
  const port = 3100 + Math.floor(Math.random() * 3000)
  const proc = spawn(process.execPath, [SERVER], {
    cwd: DEMO_DIR,
    env: { ...process.env, SKILLNET_SKIP_ENV_FILE: '1', PORT: String(port), ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let out = ''
  proc.stdout.on('data', d => { out += d })
  proc.stderr.on('data', d => { out += d })

  const base = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 15000
  while (Date.now() < deadline) {
    if (proc.exitCode != null) throw new Error(`server exited early (code ${proc.exitCode}):\n${out}`)
    try {
      const r = await fetch(base + '/healthz')
      if (r.ok) return { base, port, proc, output: () => out, stop: () => stopServer(proc) }
    } catch { /* not up yet */ }
    await new Promise(r => setTimeout(r, 150))
  }
  await stopServer(proc)
  throw new Error(`server did not start within 15s:\n${out}`)
}

export function stopServer(proc) {
  return new Promise((resolve) => {
    if (!proc || proc.exitCode != null || proc.killed) return resolve()
    proc.once('exit', () => resolve())
    proc.kill()
    setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* ignore */ } resolve() }, 2000)
  })
}
