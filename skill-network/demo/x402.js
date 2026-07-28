'use strict'
/**
 * x402 payment integration — REAL USDC on Base Sepolia (x402 protocol v2).
 * ─────────────────────────────────────────────────────────────────────────────
 * Gates the agent-invoke path with a genuine HTTP-402 → sign → settle flow:
 *
 *   1. No `X-PAYMENT` header → 402 with a v2 `PaymentRequired` body whose `accepts[0]`
 *      carries { scheme:'exact', network:'eip155:84532', asset:USDC, amount:<micro-USDC>,
 *      payTo:<receiving addr>, maxTimeoutSeconds, extra:{name,version} }.
 *   2. The buyer signs an EIP-3009 `transferWithAuthorization` and base64-encodes a
 *      v2 `PaymentPayload` into the `X-PAYMENT` header.
 *   3. We `verify` then `settle` that payload against the facilitator
 *      (https://x402.org/facilitator — free, keyless, sponsors gas, base-sepolia only).
 *      The facilitator submits the USDC transfer on-chain and returns the settlement tx.
 *
 * The facilitator client (`@x402/core`'s HTTPFacilitatorClient) is required/constructed
 * LAZILY on first settlement so the server always boots offline. If the module import or
 * facilitator construction ever fails, `collect()` returns a retryable error (the invoke
 * handler surfaces it as a 402) — it never throws the request down.
 *
 * X402_MODE=sim escapes this entirely and preserves the demo's legacy UUID-receipt flow
 * (see agent-network.js issueReceipt/consumeReceipt) for offline development.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ─── Defaults (all overridable by env; the demo boots REAL with zero env set) ──
const DEFAULTS = {
  facilitatorUrl:  'https://x402.org/facilitator',   // free, keyless, gas-sponsoring, base-sepolia
  network:         'eip155:84532',                    // CAIP-2 for Base Sepolia
  usdc:            '0x036CbD53842c5426634e7929541eC2318f3dCF7e', // official Circle USDC (6 dec, EIP-3009)
  receivingAddr:   '0x7a549A1687f374715C74615748509aF976a3f32E',
  maxTimeoutSecs:  300,
}

// USDC EIP-712 domain fields for Base Sepolia (used by the buyer to build the 3009 signature).
const USDC_DOMAIN = { name: 'USDC', version: '2' }

/** Read x402 config from env, applying working defaults. */
function readConfig(env = process.env) {
  const mode = String(env.X402_MODE || 'real').toLowerCase() === 'sim' ? 'sim' : 'real'
  return {
    mode,
    facilitatorUrl: env.X402_FACILITATOR_URL   || DEFAULTS.facilitatorUrl,
    network:        env.X402_NETWORK           || DEFAULTS.network,
    usdc:           env.X402_USDC_ADDRESS      || DEFAULTS.usdc,
    receivingAddr:  env.X402_RECEIVING_ADDRESS || DEFAULTS.receivingAddr,
    maxTimeoutSecs: DEFAULTS.maxTimeoutSecs,
  }
}

/** Expand a JS number to a plain (non-exponential) decimal string. 0.001 → "0.001". */
function numToDecimalString(n) {
  let s = String(n)
  if (!/e/i.test(s)) return s
  let sign = ''
  if (s.startsWith('-')) { sign = '-'; s = s.slice(1) }
  const [mant, expStr] = s.split(/e/i)
  const exp = parseInt(expStr, 10)
  const [i, f = ''] = mant.split('.')
  const digits = i + f
  const pointPos = i.length + exp
  if (pointPos <= 0)             return sign + '0.' + '0'.repeat(-pointPos) + digits
  if (pointPos >= digits.length) return sign + digits + '0'.repeat(pointPos - digits.length)
  return sign + digits.slice(0, pointPos) + '.' + digits.slice(pointPos)
}

/**
 * feePerTask → USDC atomic (micro) units, as a decimal string, EXACT (no float dust).
 * Pricing convention (documented): the agent's existing numeric `feePerTask` is treated as
 * a USD-dollar amount. USDC has 6 decimals, so 1 dollar = 1_000_000 micro-USDC:
 *   feePerTask 0.001 → $0.001 → "1000"     feePerTask 1 → $1 → "1000000"
 */
function toMicroUSDC(fee) {
  const raw = numToDecimalString(Number(fee) || 0)
  const neg = raw.startsWith('-')
  const [intPart, fracPart = ''] = raw.replace(/^-/, '').split('.')
  const frac = (fracPart + '000000').slice(0, 6)              // pad/truncate to 6 decimals
  const micro = BigInt(intPart || '0') * 1000000n + BigInt(frac || '0')
  return (neg ? -micro : micro).toString()
}

/** The single v2 PaymentRequirements row (scheme `exact`) for an agent's price. */
function buildRequirements(agent, cfg = readConfig()) {
  return {
    scheme:            'exact',
    network:           cfg.network,
    amount:            toMicroUSDC(agent.feePerTask),
    asset:             cfg.usdc,
    payTo:             cfg.receivingAddr,
    maxTimeoutSeconds: cfg.maxTimeoutSecs,
    extra:             { ...USDC_DOMAIN },   // { name:'USDC', version:'2' } — EIP-712 domain for the buyer
  }
}

/** The full v2 `PaymentRequired` body returned as the 402 response for a priced agent. */
function buildPaymentRequired(agent, cfg = readConfig()) {
  return {
    x402Version: 2,
    error:       'Payment Required',
    resource: {
      url:         agent.endpoint || `/api/agents/${agent.agentId}/invoke`,
      description: `Pay ${agent.feePerTask} USDC to invoke ${agent.name}`,
      mimeType:    'application/json',
    },
    accepts: [buildRequirements(agent, cfg)],
  }
}

/**
 * x402 gateway — orchestrates the verify + settle round-trip for a single invoke.
 * The facilitator client is injectable (tests pass a stub via `facilitator`); in production it
 * is lazily required from `@x402/core/server` so the server never touches the network at boot.
 */
class X402Gateway {
  /**
   * @param {Object}   [opts]
   * @param {Object}   [opts.env]          env source (defaults to process.env)
   * @param {Object}   [opts.facilitator]  injected `{ verify, settle }` (test seam)
   * @param {Function} [opts.requireFn]    module loader (test seam; defaults to require)
   */
  constructor({ env = process.env, facilitator = null, requireFn } = {}) {
    this.cfg = readConfig(env)
    this._facilitator = facilitator
    this._requireFn = requireFn || require
    this._initTried = Boolean(facilitator)   // an injected client needs no lazy init
  }

  get mode()          { return this.cfg.mode }
  toMicroUSDC(fee)    { return toMicroUSDC(fee) }
  requirements(agent) { return buildRequirements(agent, this.cfg) }
  challenge(agent)    { return buildPaymentRequired(agent, this.cfg) }

  /** Lazily build (once) the HTTP facilitator client. Returns null on failure. */
  _facilitatorClient() {
    if (this._facilitator) return this._facilitator
    if (this._initTried)   return this._facilitator
    this._initTried = true
    try {
      const { HTTPFacilitatorClient } = this._requireFn('@x402/core/server')
      this._facilitator = new HTTPFacilitatorClient({ url: this.cfg.facilitatorUrl })
    } catch (e) {
      console.error('  ⚠ x402 facilitator init failed (invoke will 402 until it recovers):', e.message)
      this._facilitator = null
    }
    return this._facilitator
  }

  /** Decode a base64 `X-PAYMENT` header into a v2 PaymentPayload (throws on malformed input). */
  decodePayment(header) {
    return JSON.parse(Buffer.from(String(header || ''), 'base64').toString('utf8'))
  }

  /**
   * Verify + settle a buyer's X-PAYMENT header against this agent's requirements.
   * Never throws. Returns one of:
   *   { ok:true,  txHash, amountMicro, payer, network, paymentResponseB64, settleResponse }
   *   { ok:false, retryable:false, error }   — malformed / invalid payment (client must re-pay)
   *   { ok:false, retryable:true,  error }   — facilitator/network failure (safe to retry)
   */
  async collect(agent, xPaymentHeader) {
    const requirements = buildRequirements(agent, this.cfg)

    let payload
    try {
      payload = this.decodePayment(xPaymentHeader)
    } catch {
      return { ok: false, retryable: false, error: 'Malformed X-PAYMENT header (expected base64-encoded JSON)' }
    }

    const fac = this._facilitatorClient()
    if (!fac) return { ok: false, retryable: true, error: 'x402 facilitator unavailable' }

    let verify
    try {
      verify = await fac.verify(payload, requirements)
    } catch (e) {
      return { ok: false, retryable: true, error: `Facilitator verify failed: ${e.message}` }
    }
    if (!verify || !verify.isValid) {
      return {
        ok: false, retryable: false,
        error: (verify && (verify.invalidReason || verify.invalidMessage)) || 'Payment verification failed',
      }
    }

    let settle
    try {
      settle = await fac.settle(payload, requirements)
    } catch (e) {
      return { ok: false, retryable: true, error: `Facilitator settle failed: ${e.message}` }
    }
    if (!settle || !settle.success) {
      return {
        ok: false, retryable: true,
        error: (settle && (settle.errorReason || settle.errorMessage)) || 'Settlement failed',
      }
    }

    return {
      ok:                true,
      txHash:            settle.transaction,
      amountMicro:       settle.amount || requirements.amount,
      payer:             settle.payer || verify.payer || null,
      network:           settle.network || requirements.network,
      paymentResponseB64: Buffer.from(JSON.stringify(settle)).toString('base64'),
      settleResponse:    settle,
    }
  }
}

module.exports = {
  DEFAULTS,
  USDC_DOMAIN,
  readConfig,
  toMicroUSDC,
  numToDecimalString,
  buildRequirements,
  buildPaymentRequired,
  X402Gateway,
}
