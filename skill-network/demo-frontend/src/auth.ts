// Ed25519 request signing for SkillNet write endpoints (WebCrypto, no deps).
//
// A per-browser Ed25519 keypair is generated on first use and persisted as a JWK
// in localStorage. Every write request is signed with the header scheme the demo
// server enforces in AUTH_MODE=signature:
//   x-skillnet-pubkey     base64url raw 32-byte public key
//   x-skillnet-timestamp  unix epoch ms
//   x-skillnet-signature  base64url Ed25519 signature over
//                         `${METHOD}\n${PATHNAME}\n${TIMESTAMP}\n${sha256hex(body)}`

const PRIV_KEY = 'skillnet_priv_jwk'
const PUB_KEY = 'skillnet_pub'

function b64url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function sha256hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

let cached: { pub: string; key: CryptoKey } | null = null

async function loadIdentity(): Promise<{ pub: string; key: CryptoKey }> {
  if (cached) return cached

  let privJwk: JsonWebKey
  let pub = localStorage.getItem(PUB_KEY) || ''
  const stored = localStorage.getItem(PRIV_KEY)

  if (stored && pub) {
    privJwk = JSON.parse(stored) as JsonWebKey
  } else {
    const kp = (await crypto.subtle.generateKey(
      { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
      true,
      ['sign', 'verify'],
    )) as CryptoKeyPair
    privJwk = await crypto.subtle.exportKey('jwk', kp.privateKey)
    pub = privJwk.x as string // base64url raw public key
    localStorage.setItem(PRIV_KEY, JSON.stringify(privJwk))
    localStorage.setItem(PUB_KEY, pub)
  }

  const key = await crypto.subtle.importKey(
    'jwk',
    privJwk,
    { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
    false,
    ['sign'],
  )
  cached = { pub, key }
  return cached
}

/** This browser's public key (base64url raw). Sent as `creatorPubKey` on mint. */
export async function myPubKey(): Promise<string> {
  return (await loadIdentity()).pub
}

// ── HCS-26 content + identity binding ───────────────────────────────────────
// Must byte-for-byte match demo/hcs26.js: canonical manifest = compact JSON with
// lexicographically-sorted keys over {description, license, name, pricePerCall,
// skillType, tier}; contentHash = sha256hex(manifest); signing message =
// `hcs26-register\n${contentHash}\n${name}`.
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']'
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return '{' + Object.keys(o).sort().map(k => JSON.stringify(k) + ':' + stableStringify(o[k])).join(',') + '}'
  }
  return JSON.stringify(v)
}

export interface ManifestFields {
  name: string
  description: string
  license?: string
  skillType: string
  tier: string
  pricePerCall: number
}

/** Compute the HCS-26 contentHash + creator signature for a skill about to be minted. */
export async function registrySignature(m: ManifestFields): Promise<{ contentHash: string; registrySignature: string }> {
  const manifest = stableStringify({
    description: String(m.description ?? ''),
    license: String(m.license ?? 'MIT'),
    name: String(m.name ?? ''),
    pricePerCall: Number(m.pricePerCall ?? 0),
    skillType: String(m.skillType ?? ''),
    tier: String(m.tier ?? ''),
  })
  const contentHash = await sha256hex(manifest)
  const message = `hcs26-register\n${contentHash}\n${String(m.name ?? '')}`
  const { key } = await loadIdentity()
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
    key,
    new TextEncoder().encode(message),
  )
  return { contentHash, registrySignature: b64url(sig) }
}

/** Build signed headers for a write request. `bodyStr` must be the exact bytes sent. */
export async function signHeaders(
  method: string,
  url: string,
  bodyStr: string,
): Promise<Record<string, string>> {
  const { pub, key } = await loadIdentity()
  const pathname = new URL(url, location.origin).pathname
  const ts = Date.now().toString()
  const bodyHash = await sha256hex(bodyStr)
  const message = `${method}\n${pathname}\n${ts}\n${bodyHash}`
  const sig = await crypto.subtle.sign(
    { name: 'Ed25519' } as unknown as AlgorithmIdentifier,
    key,
    new TextEncoder().encode(message),
  )
  return {
    'x-skillnet-pubkey': pub,
    'x-skillnet-timestamp': ts,
    'x-skillnet-signature': b64url(sig),
  }
}
