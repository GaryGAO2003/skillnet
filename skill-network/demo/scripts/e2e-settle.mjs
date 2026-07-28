'use strict'
/**
 * End-to-end settlement proof against Base Sepolia — MANUAL script (NOT run by the test suite).
 * ─────────────────────────────────────────────────────────────────────────────
 * What it does (idempotent, re-runnable):
 *   (a) print the gateway (deployer) address + balance; abort if < 0.01 ETH.
 *   (b) derive two demo payers (agent-1, agent-2); if their on-chain vault deposit is short,
 *       fund the wallet (gas) and have the PAYER sign its own deposit() tx.
 *   (c) hit the LOCAL demo server making ~6 cheap paid calls as agent-1/agent-2 (≤ 0.01 ETH).
 *   (d) POST /api/settle (signed) — the server's gateway submits settleBatch on-chain.
 *   (e) read /api/settlements + on-chain getBalance (recipients) and spent (payers);
 *       assert the on-chain debited (== credited) equals the settled batch value.
 *   (f) print a summary with Basescan links.
 *
 * PREREQUISITES
 *   • The demo server must be running locally WITH the same chain env (contracts/.env), e.g.:
 *       cd skill-network/demo
 *       GATEWAY_PRIVATE_KEY=$PRIVATE_KEY BASE_SEPOLIA_RPC_URL=... SETTLEMENT_VAULT_ADDRESS=... \
 *       TREASURY_ADDRESS=... SETTLE_MIN_INTERVAL_MS=0 node server.js
 *     (SETTLE_MIN_INTERVAL_MS=0 lets the manual /api/settle fire without the rate-limit wait.)
 *   • This script and the server MUST agree on DEMO_PAYER_SEED (unset in both → same default).
 *
 * RUN
 *   cd skill-network/demo
 *   node scripts/e2e-settle.mjs          # reads ../../contracts/.env automatically
 *   # or point at a running server on a custom port:  PORT=3000 node scripts/e2e-settle.mjs
 *
 * SECURITY: never prints private keys. Money/gas math is BigInt-only (parseEther/formatEther).
 */
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import {
  createPublicClient, createWalletClient, http, parseEther, formatEther, getAddress,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { baseSepolia } from 'viem/chains'
import { settlementVaultAbi } from '../abi/settlementVault.mjs'
import { derivePayerAccount } from '../gateway.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_DIR = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const security = require('../security.js')

// ── Load contracts/.env (already-set process.env wins) ────────────────────────
function loadEnvFile(p) {
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const l = line.trim()
    if (!l || l.startsWith('#') || !l.includes('=')) continue
    const i = l.indexOf('=')
    const k = l.slice(0, i).trim()
    const v = l.slice(i + 1).trim()
    if (v && !process.env[k]) process.env[k] = v
  }
}
loadEnvFile(path.resolve(DEMO_DIR, '..', 'contracts', '.env'))

const normHex = v => (v ? (v.startsWith('0x') ? v : '0x' + v) : v)

const PK = normHex(process.env.GATEWAY_PRIVATE_KEY || process.env.PRIVATE_KEY)
const RPC = process.env.BASE_SEPOLIA_RPC_URL
const VAULT = process.env.SETTLEMENT_VAULT_ADDRESS
const TREASURY = process.env.TREASURY_ADDRESS
const SEED = process.env.DEMO_PAYER_SEED // may be undefined → derivePayerAccount uses its default
const PORT = process.env.PORT || 3000
const BASE = `http://localhost:${PORT}`
const EXPLORER = 'https://sepolia.basescan.org'

function die(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1) }
if (!PK) die('Missing PRIVATE_KEY / GATEWAY_PRIVATE_KEY (source contracts/.env).')
if (!RPC) die('Missing BASE_SEPOLIA_RPC_URL.')
if (!VAULT) die('Missing SETTLEMENT_VAULT_ADDRESS.')
if (!TREASURY) die('Missing TREASURY_ADDRESS.')

const vault = getAddress(VAULT)
const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) })
const gatewayAccount = privateKeyToAccount(PK)
const gatewayWallet = createWalletClient({ account: gatewayAccount, chain: baseSepolia, transport: http(RPC) })

const eth = wei => `${formatEther(wei)} ETH`
const read = (fn, args) => publicClient.readContract({ address: vault, abi: settlementVaultAbi, functionName: fn, args })

// Amounts (BigInt-only).
const MIN_GATEWAY_BAL = parseEther(process.env.E2E_MIN_GATEWAY_ETH || '0.01')
const DEPOSIT_EACH = parseEther(process.env.E2E_DEPOSIT_ETH || '0.006')
const GAS_TOPUP = parseEther(process.env.E2E_GAS_TOPUP_ETH || '0.0005')

// ── Signed local-server call helper (matches demo/security.js signing) ────────
const signer = security.generateCreatorKeypair() // throwaway identity; calling needs a valid sig, not ownership
function signHeaders(method, pathname, bodyStr) {
  const ts = String(Date.now())
  const bodyHash = security.sha256hex(Buffer.from(bodyStr, 'utf8'))
  const msg = security.signingMessage(method, pathname, ts, bodyHash)
  return {
    'content-type': 'application/json',
    'x-skillnet-pubkey': signer.pubKey,
    'x-skillnet-timestamp': ts,
    'x-skillnet-signature': security.signEd25519(signer.privJwk, msg),
  }
}
async function api(method, pathname, body) {
  const bodyStr = body ? JSON.stringify(body) : ''
  const res = await fetch(BASE + pathname, { method, headers: signHeaders(method, pathname, bodyStr), body: body ? bodyStr : undefined })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json }
}

async function waitReceipt(hash, label) {
  const r = await publicClient.waitForTransactionReceipt({ hash })
  if (r.status !== 'success') die(`${label} tx reverted: ${EXPLORER}/tx/${hash}`)
  return r
}

async function main() {
  console.log('\n════════════════════════════════════════════════════════════')
  console.log(' SkillNet settlement — E2E proof on Base Sepolia')
  console.log('════════════════════════════════════════════════════════════')

  // (a) gateway address + balance
  const gwBal = await publicClient.getBalance({ address: gatewayAccount.address })
  console.log(`\n[a] Gateway (deployer): ${gatewayAccount.address}`)
  console.log(`    Balance: ${eth(gwBal)}   Vault: ${vault}`)
  if (gwBal < MIN_GATEWAY_BAL) {
    die(`Gateway balance ${eth(gwBal)} < 0.01 ETH. Fund it from a Base Sepolia faucet before running.`)
  }

  // Confirm the local server is up and enabled.
  const st0 = await api('GET', '/api/settlements')
  if (st0.status !== 200) die(`Local demo server not reachable at ${BASE} (start it first).`)
  if (!st0.json.enabled) die(`Local demo server's gateway is DISABLED — start it with the chain env (see header).`)
  console.log(`\n    Local server: ${BASE}  (gateway ${st0.json.gatewayAddress})`)
  if (getAddress(st0.json.gatewayAddress) !== gatewayAccount.address) {
    die(`Server gateway ${st0.json.gatewayAddress} != this script's ${gatewayAccount.address}. Use the same PRIVATE_KEY.`)
  }
  if (getAddress(st0.json.vaultAddress) !== vault) {
    die(`Server vault ${st0.json.vaultAddress} != ${vault}. Use the same SETTLEMENT_VAULT_ADDRESS.`)
  }

  // (b) derive payers, top up deposits if short
  const payerNames = ['agent-1', 'agent-2']
  const payers = payerNames.map(name => ({ name, account: derivePayerAccount(SEED, name) }))
  console.log('\n[b] Demo payers (DEMO-MODE CUSTODY — derived from DEMO_PAYER_SEED):')
  for (const p of payers) {
    const dep = await read('getDeposit', [p.account.address])
    console.log(`    ${p.name}: ${p.account.address}  vault deposit ${eth(dep)}`)
    if (dep >= DEPOSIT_EACH) { console.log(`      ↳ sufficient, skipping top-up`); continue }

    // Ensure the payer wallet can cover deposit + gas; gateway tops up the shortfall.
    const need = DEPOSIT_EACH + GAS_TOPUP
    const walletBal = await publicClient.getBalance({ address: p.account.address })
    if (walletBal < need) {
      const short = need - walletBal
      console.log(`      ↳ funding wallet with ${eth(short)} for deposit + gas`)
      const fundHash = await gatewayWallet.sendTransaction({ to: p.account.address, value: short })
      await waitReceipt(fundHash, `fund ${p.name}`)
    }
    // Payer signs its OWN deposit tx (production-faithful: only the payer can deposit for itself).
    const payerWallet = createWalletClient({ account: p.account, chain: baseSepolia, transport: http(RPC) })
    console.log(`      ↳ ${p.name} depositing ${eth(DEPOSIT_EACH)}`)
    const depHash = await payerWallet.writeContract({ address: vault, abi: settlementVaultAbi, functionName: 'deposit', value: DEPOSIT_EACH })
    await waitReceipt(depHash, `${p.name} deposit`)
    console.log(`      ↳ deposit tx ${EXPLORER}/tx/${depHash}`)
  }

  // Snapshot on-chain spent BEFORE the batch (to measure this settle's debit).
  const spentBefore = {}
  for (const p of payers) spentBefore[p.name] = await read('spent', [p.account.address])

  // (c) 6 cheap paid calls (3 per payer) — skill 3 (Sentiment 0.001) + skill 6 (Data Pipeline 0.001, composite)
  console.log('\n[c] Making 6 paid calls on the local demo server (≤ 0.01 ETH total):')
  const plan = [
    ['agent-1', 3, 0.001], ['agent-1', 6, 0.001], ['agent-1', 3, 0.001],
    ['agent-2', 3, 0.001], ['agent-2', 6, 0.001], ['agent-2', 3, 0.001],
  ]
  let localTotal = 0
  for (const [caller, skillId, value] of plan) {
    const r = await api('POST', `/api/call/${skillId}`, { caller, value })
    if (r.status !== 200) die(`call skill ${skillId} as ${caller} failed: ${JSON.stringify(r.json)}`)
    localTotal += value
    console.log(`    ${caller} → skill #${skillId}  ${value} ETH`)
  }
  console.log(`    local calls total: ${localTotal.toFixed(4)} ETH`)

  // (d) settle
  console.log('\n[d] POST /api/settle …')
  let settleRes
  for (let attempt = 0; attempt < 10; attempt++) {
    const r = await api('POST', '/api/settle')
    settleRes = r.json
    if (settleRes.busy) { await new Promise(s => setTimeout(s, 1500)); continue }
    // Transient revert (e.g. a lagging public-RPC replica not yet seeing a fresh
    // deposit) is safe to retry: the gateway restores the window on failure.
    if (settleRes.ok === false && attempt < 2) { await new Promise(s => setTimeout(s, 5000)); continue }
    break
  }
  if (settleRes.skipped) {
    die(`settle skipped (reason: ${settleRes.reason}). If 'min-interval', restart the server with SETTLE_MIN_INTERVAL_MS=0.`)
  }
  if (settleRes.enabled === false) die('server gateway disabled')
  if (!settleRes.ok) die(`settle failed: ${settleRes.error}`)
  console.log(`    ✓ settled  tx ${settleRes.txHash}  block ${settleRes.blockNumber}`)
  console.log(`    batchValue ${eth(BigInt(settleRes.batchValue))}  calls ${settleRes.calls}  vouchers ${settleRes.vouchers}  credits ${settleRes.credits}`)

  // (e) read back on-chain + assert conservation
  console.log('\n[e] On-chain read-back:')
  let debited = 0n
  for (const p of payers) {
    const after = await read('spent', [p.account.address])
    const delta = after - spentBefore[p.name]
    debited += delta
    console.log(`    spent[${p.name}] ${eth(spentBefore[p.name])} → ${eth(after)}  (Δ ${eth(delta)})`)
  }
  const recipients = { treasury: getAddress(TREASURY), carol: derivePayerAccount(SEED, 'carol').address, alice: derivePayerAccount(SEED, 'alice').address }
  for (const [name, addr] of Object.entries(recipients)) {
    const bal = await read('getBalance', [addr])
    console.log(`    vault balance[${name}] ${addr} = ${eth(bal)}`)
  }
  const batchValue = BigInt(settleRes.batchValue)
  console.log(`\n    on-chain debited (== credited, contract-enforced): ${eth(debited)}`)
  console.log(`    settled batch value:                                ${eth(batchValue)}`)
  if (debited !== batchValue) die(`CONSERVATION MISMATCH: debited ${debited} != batchValue ${batchValue}`)
  console.log('    ✓ on-chain debited == credited == batch value')

  // (f) summary
  const st1 = await api('GET', '/api/settlements')
  console.log('\n════════════════════════════════════════════════════════════')
  console.log(' SUMMARY')
  console.log('════════════════════════════════════════════════════════════')
  console.log(` settle tx     : ${EXPLORER}/tx/${settleRes.txHash}`)
  console.log(` vault         : ${EXPLORER}/address/${vault}`)
  console.log(` gateway       : ${EXPLORER}/address/${gatewayAccount.address}`)
  for (const p of payers) console.log(` payer ${p.name}: ${EXPLORER}/address/${p.account.address}`)
  console.log(` pending after : ${eth(BigInt(st1.json.pendingWei || '0'))}`)
  console.log(` settlements   : ${st1.json.settlements.length} recorded (newest first)`)
  console.log('\n✓ E2E settlement proof complete.\n')
}

main().catch(err => die(err.shortMessage || err.message || String(err)))
