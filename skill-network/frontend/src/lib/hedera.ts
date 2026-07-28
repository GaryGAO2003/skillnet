// Hedera mirror-node client (browser, keyless).
// ─────────────────────────────────────────────────────────────────────────────
// Reads the HCS-26 discovery registry and per-skill version registries straight
// from Hedera's PUBLIC mirror node REST API — no server proxy, no keys. CORS is
// open (`access-control-allow-origin: *`). Every field surfaced here is later
// re-verified client-side in `hcs26.ts`.
//
// Byte-safe base64 decode is mandatory for `message` payloads: bare `atob` mangles
// multi-byte UTF-8. See `decodeBase64` below.

import { MIRROR_BASE, DISCOVERY_TOPIC } from '../constants'

export type Tier = 'OPEN' | 'SHIELDED' | 'PRIVATE'

/** Skill metadata as embedded in an HCS-26 `register` message. */
export interface RegistryMetadata {
  name?: string
  description?: string
  author?: string
  license?: string
  tags?: Array<string | number>
  // Present only on content-bound registrations (needed to recompute contentHash):
  skillType?: string
  tier?: string
  pricePerCall?: number
}

/** A parsed HCS-26 `register` entry from the discovery topic. */
export interface ParsedRegistration {
  skill_uid: number
  consensus_timestamp: string
  payer_account_id: string
  /** Per-skill version registry topic id. */
  t_id?: string
  account_id?: string
  contentHash: string | null
  creatorPubKey: string | null
  signature: string | null
  metadata: RegistryMetadata
  tier: Tier
  /** Raw memo string, e.g. "SkillNet [OPEN] Registry Live Check". */
  m?: string
}

/** A parsed entry from a per-skill version registry topic. */
export interface VersionEntry {
  version: string
  status: string // active | deprecated | yanked | …
  seq: number
}

interface RawMirrorMessage {
  message?: string
  sequence_number: number
  consensus_timestamp: string
  payer_account_id: string
}

// Byte-safe base64 decode: atob yields a binary string, we widen each char to its
// code point and let TextDecoder reassemble the UTF-8. Never bare `atob` for content.
function decodeBase64(b64: string): string {
  return new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)))
}

const TIER_RE = /\[(OPEN|SHIELDED|PRIVATE)\]/

function parseRegistration(m: RawMirrorMessage): ParsedRegistration | null {
  if (!m.message) return null
  try {
    const parsed = JSON.parse(decodeBase64(m.message))
    if (parsed.p !== 'hcs-26' || parsed.op !== 'register') return null

    const metadata: RegistryMetadata =
      parsed.metadata && typeof parsed.metadata === 'object' ? parsed.metadata : {}
    const tier =
      (typeof parsed.m === 'string' ? parsed.m.match(TIER_RE)?.[1] : undefined) ?? 'OPEN'

    return {
      skill_uid: Number(m.sequence_number),
      consensus_timestamp: m.consensus_timestamp,
      payer_account_id: m.payer_account_id,
      t_id: parsed.t_id,
      account_id: parsed.account_id,
      contentHash: parsed.contentHash ?? null,
      creatorPubKey: parsed.creatorPubKey ?? null,
      signature: parsed.signature ?? null,
      metadata,
      tier: tier as Tier,
      m: parsed.m,
    }
  } catch {
    return null
  }
}

/**
 * Sweep the entire discovery topic (paged, ascending) and return parsed HCS-26
 * `register` entries. Follows the relative `links.next` cursor by prefixing the
 * mirror origin. Throws on a non-OK response so react-query can surface an error.
 */
export async function fetchRegistrations(): Promise<ParsedRegistration[]> {
  let url: string | null =
    `${MIRROR_BASE}/api/v1/topics/${DISCOVERY_TOPIC}/messages?limit=100&order=asc`
  const all: RawMirrorMessage[] = []

  while (url) {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Mirror node ${res.status} reading topic ${DISCOVERY_TOPIC}`)
    const data = await res.json()
    all.push(...(data.messages ?? []))
    // `links.next` is a relative path already carrying `/api/v1/…` — prefix origin.
    url = data.links?.next ? `${MIRROR_BASE}${data.links.next}` : null
  }

  return all
    .map(parseRegistration)
    .filter((x): x is ParsedRegistration => x !== null)
}

/**
 * Read a per-skill version registry topic (newest first). Returns semver + status
 * entries. Throws on a non-OK response.
 */
export async function fetchVersions(topicId: string): Promise<VersionEntry[]> {
  if (!topicId) return []
  const res = await fetch(
    `${MIRROR_BASE}/api/v1/topics/${topicId}/messages?limit=50&order=desc`,
  )
  if (!res.ok) throw new Error(`Mirror node ${res.status} reading version topic ${topicId}`)
  const data = await res.json()

  return ((data.messages ?? []) as RawMirrorMessage[])
    .map((m): VersionEntry | null => {
      if (!m.message) return null
      try {
        const parsed = JSON.parse(decodeBase64(m.message))
        if (parsed.p !== 'hcs-26' || parsed.op !== 'register') return null
        return {
          version: String(parsed.version ?? ''),
          status: String(parsed.status ?? 'active'),
          seq: Number(m.sequence_number),
        }
      } catch {
        return null
      }
    })
    .filter((x): x is VersionEntry => x !== null)
}

/** Format a Hedera consensus timestamp ("seconds.nanos") as a short UTC string. */
export function formatConsensus(ts: string): string {
  const seconds = Number(String(ts).split('.')[0])
  if (!Number.isFinite(seconds)) return ts
  const d = new Date(seconds * 1000)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(
    d.getUTCHours(),
  )}:${p(d.getUTCMinutes())} UTC`
}
