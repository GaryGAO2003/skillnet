// HCS-26 client-side verification (WebCrypto, no deps).
// ─────────────────────────────────────────────────────────────────────────────
// Re-checks a registration's content binding + creator identity entirely in the
// visitor's browser. Must byte-for-byte match demo/hcs26.js and demo-frontend's
// auth.ts SIGN side:
//   canonical manifest = compact JSON, lexicographically-sorted keys, over exactly
//     { description, license, name, pricePerCall, skillType, tier }
//   contentHash = sha256hex(manifest)
//   signing message = `hcs26-register\n${contentHash}\n${name}`
//   signature = base64url( Ed25519_sign(creatorPrivKey, signingMessage) )
//   creatorPubKey = base64url raw 32-byte Ed25519 public key (JWK `x`)

import type { ParsedRegistration, RegistryMetadata } from './hedera'

export interface VerificationResult {
  /** contentHash recomputed AND signature checks out. */
  verified: boolean
  /** Registered before content binding existed (no contentHash/pubKey/signature). */
  legacy: boolean
  contentHashOk: boolean
  /** true / false, or null when this browser lacks WebCrypto Ed25519. */
  sigOk: boolean | null
}

/** Deterministic JSON: keys sorted recursively, arrays kept in order, compact. */
export function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return (
      '{' +
      Object.keys(o)
        .sort()
        .map((k) => JSON.stringify(k) + ':' + stableStringify(o[k]))
        .join(',') +
      '}'
    )
  }
  return JSON.stringify(v)
}

function canonicalManifest(m: RegistryMetadata): string {
  return stableStringify({
    description: String(m.description ?? ''),
    license: String(m.license ?? 'MIT'),
    name: String(m.name ?? ''),
    pricePerCall: Number(m.pricePerCall ?? 0),
    skillType: String(m.skillType ?? ''),
    tier: String(m.tier ?? ''),
  })
}

/** sha256hex of the canonical manifest — the contentHash bound into a registration. */
export async function contentHashOf(m: RegistryMetadata): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalManifest(m)))
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

// base64url → bytes (restore padding + standard alphabet). Backed by a fresh
// ArrayBuffer so it satisfies WebCrypto's BufferSource (not SharedArrayBuffer).
function b64urlToBytes(s: string) {
  const std = s.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(std + '='.repeat((4 - (std.length % 4)) % 4))
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return bytes
}

// Returns true/false, or null if the browser has no WebCrypto Ed25519.
async function verifyEd25519(
  contentHash: string,
  name: string,
  creatorPubKey: string,
  signature: string,
): Promise<boolean | null> {
  try {
    const key = await crypto.subtle.importKey(
      'jwk',
      { kty: 'OKP', crv: 'Ed25519', x: creatorPubKey },
      { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
      false,
      ['verify'],
    )
    const message = `hcs26-register\n${contentHash}\n${name}`
    return await crypto.subtle.verify(
      { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
      key,
      b64urlToBytes(signature),
      new TextEncoder().encode(message),
    )
  } catch {
    // Browser lacks Ed25519 in WebCrypto (rare on modern browsers) — degrade,
    // don't crash. The UI surfaces "verification unavailable in this browser".
    return null
  }
}

/**
 * Verify a parsed HCS-26 registration in the browser.
 *   legacy   → no crypto fields (kept, verified:false)
 *   verified → contentHash recomputes (when manifest fields present) AND signature ok
 *   sigOk:null → Ed25519 unavailable in this browser (verification unavailable)
 */
export async function verifyRegistration(parsed: ParsedRegistration): Promise<VerificationResult> {
  const meta = parsed.metadata ?? {}
  const hasCrypto = !!(parsed.contentHash && parsed.creatorPubKey && parsed.signature)
  if (!hasCrypto) return { verified: false, legacy: true, contentHashOk: false, sigOk: null }

  // Recompute contentHash only when the manifest fields are present.
  const canRecompute = meta.skillType !== undefined && meta.tier !== undefined
  const contentHashOk = canRecompute ? (await contentHashOf(meta)) === parsed.contentHash : true

  const sigOk = await verifyEd25519(
    parsed.contentHash as string,
    String(meta.name ?? ''),
    parsed.creatorPubKey as string,
    parsed.signature as string,
  )
  const verified = sigOk === null ? false : contentHashOk && sigOk
  return { verified, legacy: false, contentHashOk, sigOk }
}
