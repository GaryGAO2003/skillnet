import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchRegistrations, fetchVersions, formatConsensus } from '../lib/hedera'
import type { ParsedRegistration, Tier, VersionEntry } from '../lib/hedera'
import { verifyRegistration } from '../lib/hcs26'
import type { VerificationResult } from '../lib/hcs26'
import { DISCOVERY_TOPIC } from '../constants'
import { registryMark } from '../lib/format'

const HASHSCAN_TOPIC = (id: string) => `https://hashscan.io/testnet/topic/${id}`
const HASHSCAN_ACCOUNT = (id: string) => `https://hashscan.io/testnet/account/${id}`

const TIERS: Array<Tier | 'ALL'> = ['ALL', 'OPEN', 'SHIELDED', 'PRIVATE']
type VerFilter = 'ALL' | 'VERIFIED' | 'LEGACY'
const VER_FILTERS: VerFilter[] = ['ALL', 'VERIFIED', 'LEGACY']

// ── Verification stamp presentation ─────────────────────────────────────────
interface StampSpec {
  label: string
  cls: string
  title: string
}
function stampFor(v: VerificationResult | undefined): StampSpec {
  if (!v) return { label: 'CHECKING…', cls: 'stamp-legacy', title: 'verifying in your browser…' }
  if (v.legacy)
    return {
      label: 'LEGACY',
      cls: 'stamp-legacy',
      title: 'registered before content binding existed',
    }
  if (v.sigOk === null)
    return {
      label: 'UNAVAILABLE',
      cls: 'stamp-legacy',
      title: 'verification unavailable in this browser (no WebCrypto Ed25519)',
    }
  if (v.verified)
    return {
      label: 'VERIFIED ✓',
      cls: 'stamp-verified',
      title: 'contentHash + creator Ed25519 signature re-checked in your browser',
    }
  return { label: 'UNVERIFIED', cls: 'stamp-unverified', title: 'signature or hash mismatch' }
}

function truncMid(s: string, head = 12, tail = 8): string {
  if (s.length <= head + tail + 1) return s
  return `${s.slice(0, head)}…${s.slice(-tail)}`
}

// A mono value with a copy button (copies the full value).
function CopyValue({ value, truncate = true }: { value: string; truncate?: boolean }) {
  const [done, setDone] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setDone(true)
      setTimeout(() => setDone(false), 1200)
    } catch {
      /* clipboard blocked — no-op */
    }
  }
  return (
    <>
      <span title={value}>{truncate ? truncMid(value) : value}</span>
      <button type="button" className={`reg-copy ${done ? 'done' : ''}`} onClick={copy}>
        {done ? 'Copied' : 'Copy'}
      </button>
    </>
  )
}

// Status stamp inside version history.
function versionStampClass(status: string): string {
  const s = status.toLowerCase()
  if (s === 'active') return 'stamp-verified'
  if (s === 'deprecated') return 'stamp-shielded'
  if (s === 'yanked') return 'stamp-unverified'
  return 'stamp-legacy'
}

// Lazily fetches a per-skill version registry once its row is expanded.
function VersionHistory({ topicId }: { topicId: string }) {
  const { data, isLoading, isError } = useQuery<VersionEntry[]>({
    queryKey: ['hcs26-versions', topicId],
    queryFn: () => fetchVersions(topicId),
    staleTime: 60_000,
  })

  return (
    <div className="reg-versions">
      <div className="reg-versions-h">Version history · topic {topicId}</div>
      {isLoading && <div className="reg-time">Reading version registry…</div>}
      {isError && <div className="reg-time">Could not read version registry.</div>}
      {!isLoading && !isError && (data?.length ?? 0) === 0 && (
        <div className="reg-time">No version entries.</div>
      )}
      {data?.map((v) => (
        <div className="reg-ver" key={v.seq}>
          <span className="semver">v{v.version || '—'}</span>
          <span className={`stamp stamp-sm ${versionStampClass(v.status)}`}>{v.status}</span>
          <span className="seq">seq {v.seq}</span>
        </div>
      ))}
    </div>
  )
}

function RegistryRow({
  entry,
  verification,
}: {
  entry: ParsedRegistration
  verification: VerificationResult | undefined
}) {
  const [open, setOpen] = useState(false)
  const spec = stampFor(verification)
  const detailId = `reg-detail-${entry.skill_uid}`
  const typeTag = entry.metadata.skillType || '—'

  return (
    <div className={`reg-item ${open ? 'open' : ''}`}>
      <button
        type="button"
        className="reg-row"
        aria-expanded={open}
        aria-controls={detailId}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="reg-id">{registryMark(entry.skill_uid)}</span>

        <span className="reg-main">
          <span className="flex items-center gap-2 flex-wrap">
            <span className="reg-name">{entry.metadata.name || '(unnamed)'}</span>
            {entry.metadata.author && <span className="reg-author">by {entry.metadata.author}</span>}
          </span>
          {entry.metadata.description && (
            <span className="reg-desc line-clamp-2">{entry.metadata.description}</span>
          )}
        </span>

        <span className="reg-type">{typeTag}</span>
        <span className="reg-time">{formatConsensus(entry.consensus_timestamp)}</span>
        <span className="reg-stamp-cell">
          <span className={`stamp stamp-sm ${spec.cls}`} title={spec.title}>
            {spec.label}
          </span>
        </span>
        <span className="reg-chev" aria-hidden>
          ›
        </span>
      </button>

      {open && (
        <div className="reg-detail" id={detailId}>
          <dl className="reg-kv">
            <dt>Content Hash</dt>
            <dd>
              {entry.contentHash ? (
                <CopyValue value={entry.contentHash} />
              ) : (
                <span className="reg-time">— legacy · no content binding</span>
              )}
            </dd>

            <dt>Creator Key</dt>
            <dd>
              {entry.creatorPubKey ? (
                <CopyValue value={entry.creatorPubKey} />
              ) : (
                <span className="reg-time">—</span>
              )}
            </dd>

            <dt>Payer Account</dt>
            <dd>
              <a
                href={HASHSCAN_ACCOUNT(entry.payer_account_id)}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-accent-strong transition-colors"
              >
                {entry.payer_account_id} ↗
              </a>
            </dd>

            <dt>Sequence</dt>
            <dd>{entry.skill_uid}</dd>

            {entry.t_id && (
              <>
                <dt>Version Topic</dt>
                <dd>
                  <a
                    href={HASHSCAN_TOPIC(entry.t_id)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-accent-strong transition-colors"
                  >
                    {entry.t_id} ↗
                  </a>
                </dd>
              </>
            )}

            <dt>Verification</dt>
            <dd>
              {verification
                ? verification.legacy
                  ? 'legacy — no contentHash / signature to check'
                  : verification.sigOk === null
                    ? 'unavailable — this browser has no WebCrypto Ed25519'
                    : `contentHash ${verification.contentHashOk ? 'OK' : 'MISMATCH'} · signature ${
                        verification.sigOk ? 'OK' : 'INVALID'
                      }`
                : 'checking…'}
            </dd>
          </dl>

          {entry.t_id && <VersionHistory topicId={entry.t_id} />}
        </div>
      )}
    </div>
  )
}

export function Registry() {
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<ParsedRegistration[]>({
    queryKey: ['hcs26-registrations'],
    queryFn: fetchRegistrations,
    staleTime: 60_000,
  })

  // Verify every row client-side. Verification is async, so results land per-row
  // after the initial render — keyed by skill_uid.
  const [verifications, setVerifications] = useState<Record<number, VerificationResult>>({})
  useEffect(() => {
    if (!data) return
    let cancelled = false
    data.forEach(async (entry) => {
      const v = await verifyRegistration(entry)
      if (!cancelled) setVerifications((prev) => ({ ...prev, [entry.skill_uid]: v }))
    })
    return () => {
      cancelled = true
    }
  }, [data])

  const [search, setSearch] = useState('')
  const [tier, setTier] = useState<Tier | 'ALL'>('ALL')
  const [verFilter, setVerFilter] = useState<VerFilter>('ALL')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return (data ?? []).filter((e) => {
      if (tier !== 'ALL' && e.tier !== tier) return false

      const v = verifications[e.skill_uid]
      if (verFilter === 'VERIFIED' && !(v && v.verified)) return false
      if (verFilter === 'LEGACY' && !(v && v.legacy)) return false

      if (q) {
        const hay = [
          e.metadata.name,
          e.metadata.description,
          e.metadata.author,
          (e.metadata.tags ?? []).join(' '),
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [data, search, tier, verFilter, verifications])

  const total = data?.length ?? 0

  return (
    <div className="max-w-content mx-auto px-6 py-12">
      {/* Poster header */}
      <header className="mb-8">
        <h1 className="font-display text-5xl sm:text-6xl leading-[0.95] tracking-tight text-ink">
          Skill Registry
        </h1>
        <p className="font-mono text-[12px] sm:text-[13px] tracking-[0.03em] text-muted mt-4">
          HEDERA HCS-26 · TOPIC {DISCOVERY_TOPIC} ·{' '}
          <span className="text-accent-strong font-bold">VERIFIED IN YOUR BROWSER</span>
        </p>
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-muted mt-2">
          {total} {total === 1 ? 'Entry' : 'Entries'}
        </p>

        <p className="text-[14px] sm:text-[15px] leading-[1.6] text-ink mt-5 max-w-[68ch]">
          This is the un-delistable registry — every row is read straight from Hedera&rsquo;s public
          mirror node and re-verified client-side, with no server in the middle.{' '}
          <a
            href={HASHSCAN_TOPIC(DISCOVERY_TOPIC)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink underline underline-offset-2 hover:text-accent-strong transition-colors whitespace-nowrap"
          >
            View raw topic ↗
          </a>
        </p>
      </header>

      {/* Controls */}
      <div className="flex flex-col gap-4 mb-6 pb-6 border-b border-line">
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name · description · author · tags"
          className="field-input"
          aria-label="Search registry"
        />

        <div className="flex flex-wrap items-center gap-3">
          <span className="font-mono text-[11px] tracking-[0.08em] uppercase text-muted mr-1">
            Tier
          </span>
          {TIERS.map((t) => (
            <button
              key={t}
              onClick={() => setTier(t)}
              className="chip-stamp"
              aria-pressed={tier === t}
            >
              {t}
            </button>
          ))}

          <span className="w-px h-4 bg-line mx-1 hidden sm:inline-block" />

          <span className="font-mono text-[11px] tracking-[0.08em] uppercase text-muted mr-1">
            Proof
          </span>
          {VER_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setVerFilter(f)}
              className="chip-stamp"
              aria-pressed={verFilter === f}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {/* States */}
      {isLoading && (
        <div className="py-12 text-center font-mono text-[13px] text-muted">
          READING TOPIC {DISCOVERY_TOPIC} …
        </div>
      )}

      {isError && (
        <div className="alert danger my-6">
          <span className="lbl">Error</span>
          <span className="msg">
            Could not read the mirror node
            {error instanceof Error ? ` — ${error.message}` : ''}.{' '}
            <button
              onClick={() => refetch()}
              className="underline underline-offset-2 hover:text-accent-strong"
            >
              Retry
            </button>
          </span>
        </div>
      )}

      {!isLoading && !isError && filtered.length === 0 && (
        <div className="py-12 text-center font-mono text-[13px] text-muted">
          {total === 0 ? 'No registrations on this topic yet.' : 'No entries match these filters.'}
        </div>
      )}

      {filtered.length > 0 && (
        <>
          <div className="reg-head">
            <span>ID</span>
            <span>Skill</span>
            <span>Type</span>
            <span>Consensus</span>
            <span className="text-right">Proof</span>
            <span />
          </div>
          <div>
            {filtered.map((entry) => (
              <RegistryRow
                key={entry.skill_uid}
                entry={entry}
                verification={verifications[entry.skill_uid]}
              />
            ))}
          </div>
        </>
      )}

      {/* Honest identity note */}
      <footer className="mt-10 pt-6 border-t border-line">
        <p className="font-mono text-[11px] leading-[1.6] text-muted max-w-[80ch]">
          Identity = creator Ed25519 key (authorship + content proof, not sybil resistance). Account
          binding: roadmap.
          {isFetching && !isLoading ? ' · refreshing…' : ''}
        </p>
      </footer>
    </div>
  )
}
