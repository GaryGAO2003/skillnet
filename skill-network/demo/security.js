'use strict'
/**
 * SkillNet Demo — security helpers
 * ─────────────────────────────────────────────────────────────────────────────
 * Zero external dependencies (node:crypto only). Provides:
 *   – Ed25519 keypair generation / verification (creator identity)
 *   – A request-signing middleware (headers x-skillnet-*)
 *   – A per-IP token-bucket rate limiter
 *   – A CORS middleware with an origin allow-list
 *
 * Request signing scheme (see requireSignature):
 *   headers:
 *     x-skillnet-pubkey     base64url of the raw 32-byte Ed25519 public key
 *     x-skillnet-timestamp  unix epoch milliseconds
 *     x-skillnet-signature  base64url Ed25519 signature over the canonical message
 *   canonical message (utf-8, '\n'-joined):
 *     `${METHOD}\n${PATH}\n${TIMESTAMP}\n${sha256hex(rawBody)}`
 *   where PATH is the request pathname (no query) and rawBody is the exact
 *   bytes of the request body ('' → sha256 of the empty string).
 */

const crypto = require('node:crypto')

const SKEW_MS = 5 * 60 * 1000   // max allowed clock skew for a signed request

// ─── Encoding helpers ──────────────────────────────────────────────────────────
function sha256hex(buf) {
  return crypto.createHash('sha256').update(buf || Buffer.alloc(0)).digest('hex')
}

function signingMessage(method, pathname, timestamp, bodyHashHex) {
  return `${method}\n${pathname}\n${timestamp}\n${bodyHashHex}`
}

// ─── Ed25519 keypairs (creator identity) ───────────────────────────────────────

/**
 * Generate an Ed25519 keypair.
 * @returns {{ pubKey: string, privJwk: object }}
 *   pubKey  — base64url of the raw 32-byte public key (the value stored on a skill)
 *   privJwk — JWK private key { kty:'OKP', crv:'Ed25519', x, d } (dev-only; used by
 *             /api/dev/keys so the local UI can impersonate a seeded creator)
 */
function generateCreatorKeypair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const pubJwk  = publicKey.export({ format: 'jwk' })
  const privJwk = privateKey.export({ format: 'jwk' })
  return { pubKey: pubJwk.x, privJwk }
}

/**
 * Sign a message with an Ed25519 private JWK. Returns a base64url signature.
 * @param {object} privJwk   { kty:'OKP', crv:'Ed25519', x, d }
 * @param {string} message   utf-8 message
 */
function signEd25519(privJwk, message) {
  const keyObj = crypto.createPrivateKey({ key: privJwk, format: 'jwk' })
  return crypto.sign(null, Buffer.from(message, 'utf8'), keyObj).toString('base64url')
}

/**
 * Verify an Ed25519 signature.
 * @param {string} pubKeyB64url  base64url raw 32-byte public key
 * @param {string} message       canonical signing message (utf-8)
 * @param {string} sigB64url     base64url signature
 * @returns {boolean}
 */
function verifyEd25519(pubKeyB64url, message, sigB64url) {
  try {
    const keyObj = crypto.createPublicKey({
      key: { kty: 'OKP', crv: 'Ed25519', x: pubKeyB64url },
      format: 'jwk',
    })
    return crypto.verify(null, Buffer.from(message, 'utf8'), keyObj, Buffer.from(sigB64url, 'base64url'))
  } catch {
    return false
  }
}

// ─── Signature middleware ──────────────────────────────────────────────────────

/**
 * Build the request-signature middleware.
 * In 'dev' mode the middleware is a no-op (legacy, string-identity behaviour).
 * In 'signature' mode it rejects requests that are unsigned, stale, or invalid,
 * and sets req.authPubKey to the verified base64url public key.
 *
 * Requires req.rawBody (a Buffer) — set by express.json({ verify }).
 */
function makeSignatureMiddleware(getAuthMode) {
  return function requireSignature(req, res, next) {
    if (getAuthMode() === 'dev') return next()

    const pub = req.headers['x-skillnet-pubkey']
    const ts  = req.headers['x-skillnet-timestamp']
    const sig = req.headers['x-skillnet-signature']

    if (!pub || !ts || !sig) {
      return res.status(401).json({ error: 'Missing signature headers (x-skillnet-pubkey/timestamp/signature)' })
    }
    const tsNum = Number(ts)
    if (!Number.isFinite(tsNum) || Math.abs(Date.now() - tsNum) > SKEW_MS) {
      return res.status(401).json({ error: 'Timestamp missing or outside the allowed 5-minute skew' })
    }

    const bodyHash = sha256hex(req.rawBody)
    const message  = signingMessage(req.method, req.path, ts, bodyHash)
    if (!verifyEd25519(pub, message, sig)) {
      return res.status(401).json({ error: 'Invalid signature' })
    }

    req.authPubKey = pub
    next()
  }
}

// ─── Rate limiting (per-IP token bucket) ───────────────────────────────────────

const _buckets = new Map()   // key -> { tokens, last }

/**
 * Build a token-bucket rate limiter middleware.
 * @param {string} name      bucket namespace (so separate limiters don't share state)
 * @param {number} max       bucket capacity / requests allowed per window
 * @param {number} windowMs  refill window in ms
 */
function makeRateLimiter(name, max, windowMs) {
  const refillPerMs = max / windowMs
  return function rateLimit(req, res, next) {
    const ip  = req.ip || req.socket?.remoteAddress || 'unknown'
    const key = `${name}:${ip}`
    const now = Date.now()

    let b = _buckets.get(key)
    if (!b) { b = { tokens: max, last: now }; _buckets.set(key, b) }

    b.tokens = Math.min(max, b.tokens + (now - b.last) * refillPerMs)
    b.last   = now

    if (b.tokens < 1) {
      const retryS = Math.max(1, Math.ceil((1 - b.tokens) / refillPerMs / 1000))
      res.setHeader('Retry-After', String(retryS))
      return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: retryS })
    }
    b.tokens -= 1
    next()
  }
}

// ─── CORS ──────────────────────────────────────────────────────────────────────

const ALLOWED_HEADERS = 'Content-Type, X-Payment-Receipt, x-skillnet-pubkey, x-skillnet-timestamp, x-skillnet-signature'

/**
 * Build a CORS middleware backed by an origin allow-list.
 * Same-origin requests (no Origin header) pass through untouched. Cross-origin
 * requests get ACAO only when their Origin is in `allowedOrigins`.
 */
function makeCors(allowedOrigins) {
  const allow = new Set(allowedOrigins)
  return function cors(req, res, next) {
    const origin = req.headers.origin
    if (origin && allow.has(origin)) {
      res.header('Access-Control-Allow-Origin', origin)
      res.header('Vary', 'Origin')
    }
    res.header('Access-Control-Allow-Headers', ALLOWED_HEADERS)
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    if (req.method === 'OPTIONS') return res.sendStatus(204)
    next()
  }
}

module.exports = {
  SKEW_MS,
  sha256hex,
  signingMessage,
  generateCreatorKeypair,
  signEd25519,
  verifyEd25519,
  makeSignatureMiddleware,
  makeRateLimiter,
  makeCors,
}
