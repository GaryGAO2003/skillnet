'use strict'
/**
 * End-to-end x402 buyer — MANUAL script (NOT run by the test suite, never commit output).
 * ─────────────────────────────────────────────────────────────────────────────
 * Pays a priced agent with REAL USDC on Base Sepolia via the x402 protocol:
 *
 *   (a) Derive the demo buyer wallet — keccak256(DEMO_PAYER_SEED ‖ "x402-buyer"), the same
 *       custody pattern as gateway.mjs. Print its address (never its key).
 *   (b) Read its Base Sepolia USDC balance. If 0, print the Circle faucet URL + address and
 *       exit 0 with instructions (the buyer needs USDC; gas is sponsored by the facilitator).
 *   (c) Register a priced agent on the LOCAL demo server, then POST /invoke → receive 402.
 *   (d) Sign an EIP-3009 transferWithAuthorization over the 402's requirements (USDC domain
 *       name "USDC" / version "2" / chainId 84532), base64 it into an X-PAYMENT header, retry.
 *   (e) The server verifies + settles via the facilitator (which submits the USDC transfer
 *       on-chain and sponsors gas). Print the settlement tx hash + Basescan link + the result.
 *
 * PREREQUISITES
 *   • The demo server must be running locally in REAL mode (the default), e.g.:
 *       cd skill-network/demo && node server.js
 *   • The buyer wallet must hold Base Sepolia USDC (faucet: https://faucet.circle.com).
 *   • This script and the server MUST agree on DEMO_PAYER_SEED (unset in both → same default).
 *
 * RUN
 *   cd skill-network/demo
 *   node scripts/e2e-x402.mjs                 # server on PORT (default 3000)
 *   PORT=3000 node scripts/e2e-x402.mjs       # custom port
 *
 * SECURITY: never prints private keys. Amounts are integer micro-USDC / BigInt only.
 */
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { randomBytes } from 'node:crypto'
import path from 'node:path'
import {
  createPublicClient, http, getAddress, formatUnits, toHex,
} from 'viem'
import { baseSepolia } from 'viem/chains'
import { authorizationTypes } from '@x402/evm'
import { derivePayerAccount } from '../gateway.mjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEMO_DIR = path.resolve(__dirname, '..')
const require = createRequire(import.meta.url)
const security = require('../security.js')

// ── Config (mirrors x402.js defaults; env-overridable) ────────────────────────
const RPC        = process.env.BASE_SEPOLIA_RPC_URL   || 'https://sepolia.base.org'
const USDC       = getAddress(process.env.X402_USDC_ADDRESS || '0x036CbD53842c5426634e7929541eC2318f3dCF7e')
const NETWORK    = process.env.X402_NETWORK           || 'eip155:84532'
const SEED       = process.env.DEMO_PAYER_SEED        // undefined → derivePayerAccount default
const FEE        = process.env.X402_DEMO_FEE          || '0.001'   // USD dollars → micro-USDC
const PORT       = process.env.PORT || 3000
const BASE       = `http://localhost:${PORT}`
const EXPLORER   = 'https://sepolia.basescan.org'
const FAUCET     = 'https://faucet.circle.com'

function die(msg) { console.error(`\n✖ ${msg}\n`); process.exit(1) }

// ── Signed local-server call helper (matches demo/security.js signing) ────────
const signer = security.generateCreatorKeypair()   // throwaway identity; calling needs a valid sig
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
async function api(method, pathname, body, extraHeaders = {}) {
  const bodyStr = body ? JSON.stringify(body) : ''
  const res = await fetch(BASE + pathname, {
    method,
    headers: { ...signHeaders(method, pathname, bodyStr), ...extraHeaders },
    body: body ? bodyStr : undefined,
  })
  const text = await res.text()
  let json; try { json = JSON.parse(text) } catch { json = { raw: text } }
  return { status: res.status, json, headers: res.headers }
}

const ERC20_BALANCE_ABI = [{
  name: 'balanceOf', type: 'function', stateMutability: 'view',
  inputs: [{ name: 'account', type: 'address' }], outputs: [{ type: 'uint256' }],
}]

async function main() {
  console.log('\n════════════════════════════════════════════════════════════')
  console.log(' SkillNet x402 — E2E USDC buyer on Base Sepolia')
  console.log('════════════════════════════════════════════════════════════')

  const publicClient = createPublicClient({ chain: baseSepolia, transport: http(RPC) })

  // (a) derive the buyer wallet (DEMO-MODE CUSTODY — keccak256(seed ‖ "x402-buyer"))
  const buyer = derivePayerAccount(SEED, 'x402-buyer')
  console.log(`\n[a] Buyer wallet (DEMO-MODE CUSTODY): ${buyer.address}`)

  // (b) USDC balance
  let usdcBal = 0n
  try {
    usdcBal = await publicClient.readContract({ address: USDC, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [buyer.address] })
  } catch (e) {
    die(`Failed to read USDC balance from ${RPC}: ${e.shortMessage || e.message}`)
  }
  console.log(`    USDC (${USDC}) balance: ${formatUnits(usdcBal, 6)} USDC`)
  if (usdcBal === 0n) {
    console.log('\n──────────────────────────────────────────────────────────────')
    console.log(' Buyer has no testnet USDC. Fund it, then re-run this script:')
    console.log(`   1. Open the Circle faucet:  ${FAUCET}`)
    console.log(`   2. Select network "Base Sepolia" and paste this address:`)
    console.log(`        ${buyer.address}`)
    console.log('   3. Wait for the drip, then run this script again.')
    console.log(' (Gas is sponsored by the x402 facilitator — the buyer only needs USDC.)')
    console.log('──────────────────────────────────────────────────────────────\n')
    process.exit(0)
  }

  // Confirm the local server is up and in REAL x402 mode.
  const bal = await api('GET', '/api/agents/balances')
  if (bal.status !== 200) die(`Local demo server not reachable at ${BASE} (start it first: node server.js).`)
  if (bal.json.mode === 'sim') die('Local server is in X402_MODE=sim. Restart it in real mode (unset X402_MODE) for the USDC flow.')
  console.log(`\n    Local server: ${BASE}  (x402 mode: ${bal.json.mode})`)

  // (c) register a priced agent, then invoke it (expect 402)
  const reg = await api('POST', '/api/agents/register', {
    name: 'x402 Demo Agent', description: 'Priced agent for the x402 USDC E2E buyer',
    capabilities: ['llm-chat'], feePerTask: Number(FEE), systemPrompt: 'You are a concise demo agent.',
  })
  if (reg.status !== 200) die(`register agent failed: ${JSON.stringify(reg.json)}`)
  const agentId = reg.json.agentId
  console.log(`\n[c] Registered priced agent #${agentId}  (fee ${FEE} USDC/task)`)

  const invokeBody = { caller: 'x402-buyer', task: 'Say hello in one sentence.' }
  const challenge = await api('POST', `/api/agents/${agentId}/invoke`, invokeBody)
  if (challenge.status !== 402) die(`expected 402, got ${challenge.status}: ${JSON.stringify(challenge.json)}`)
  const requirements = challenge.json.accepts?.[0]
  if (!requirements) die(`402 body missing accepts[0]: ${JSON.stringify(challenge.json)}`)
  console.log(`    402 challenge → pay ${formatUnits(BigInt(requirements.amount), 6)} USDC to ${requirements.payTo} on ${requirements.network}`)

  // (d) sign the EIP-3009 transferWithAuthorization
  const chainId = Number(String(requirements.network).split(':')[1])
  const nowSec = Math.floor(Date.now() / 1000)
  const authorization = {
    from:        buyer.address,
    to:          getAddress(requirements.payTo),
    value:       requirements.amount,
    validAfter:  '0',
    validBefore: String(nowSec + Number(requirements.maxTimeoutSeconds || 300)),
    nonce:       toHex(randomBytes(32)),
  }
  const domain = {
    name:              requirements.extra?.name    || 'USDC',
    version:           requirements.extra?.version || '2',
    chainId,
    verifyingContract: getAddress(requirements.asset),
  }
  const signature = await buyer.signTypedData({
    domain,
    types: authorizationTypes,
    primaryType: 'TransferWithAuthorization',
    message: {
      from:        authorization.from,
      to:          authorization.to,
      value:       BigInt(authorization.value),
      validAfter:  BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
      nonce:       authorization.nonce,
    },
  })

  const paymentPayload = {
    x402Version: 2,
    accepted:    requirements,
    payload:     { signature, authorization },
  }
  const xPayment = Buffer.from(JSON.stringify(paymentPayload), 'utf8').toString('base64')
  console.log('\n[d] Signed EIP-3009 authorization; retrying invoke with X-PAYMENT …')

  // (e) retry with X-PAYMENT → verify + settle on-chain via the facilitator
  const paid = await api('POST', `/api/agents/${agentId}/invoke`, invokeBody, { 'x-payment': xPayment })
  if (paid.status !== 200) die(`paid invoke failed (${paid.status}): ${JSON.stringify(paid.json)}`)

  const txHash = paid.json.payment?.txHash
  console.log('\n════════════════════════════════════════════════════════════')
  console.log(' SUCCESS')
  console.log('════════════════════════════════════════════════════════════')
  console.log(` settlement tx : ${txHash ? `${EXPLORER}/tx/${txHash}` : '(none reported)'}`)
  console.log(` amount        : ${formatUnits(BigInt(paid.json.payment?.amountMicro || '0'), 6)} USDC`)
  console.log(` payer         : ${paid.json.payment?.payer || buyer.address}`)
  console.log(` X-PAYMENT-RESPONSE header present: ${paid.headers.get('x-payment-response') ? 'yes' : 'no'}`)
  console.log(`\n agent result  :\n   ${String(paid.json.invocation?.result || '').replace(/\n/g, '\n   ')}`)
  console.log('\n✓ x402 USDC E2E complete.\n')
}

main().catch(err => die(err.shortMessage || err.message || String(err)))
