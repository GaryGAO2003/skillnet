import { useState } from 'react'
import { useReadContracts } from 'wagmi'
import { skillNFTAbi } from '../abi/SkillNFT'
import { SKILL_NFT_ADDRESS, TIER_LABELS } from '../constants'
import { useSkillCount } from '../hooks/useSkillNFT'
import { SkillRow } from '../components/SkillCard'
import type { SkillWithId, VisibilityTier } from '../types'

type SortKey = 'calls' | 'revenue' | 'price'

export function Marketplace() {
  const { data: totalSkills } = useSkillCount()
  const count = Number(totalSkills ?? 0)

  const [tierFilter, setTierFilter] = useState<VisibilityTier | 'all'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('calls')

  // Build batch read contracts
  const contracts = count > 0
    ? Array.from({ length: count }, (_, i) => ({
        address: SKILL_NFT_ADDRESS,
        abi: skillNFTAbi,
        functionName: 'getSkill' as const,
        args: [BigInt(i + 1)] as const,
      }))
    : []

  const { data: results, isLoading } = useReadContracts({
    contracts,
    query: { enabled: count > 0, refetchInterval: 10000 },
  })

  const skills: SkillWithId[] = (results ?? [])
    .map((r, i) => r.status === 'success' ? { ...r.result as any, tokenId: i + 1 } : null)
    .filter(Boolean) as SkillWithId[]

  const filtered = skills
    .filter((s) => tierFilter === 'all' || s.tier === tierFilter)
    .sort((a, b) => {
      if (sortKey === 'calls')   return Number(b.totalCalls)   - Number(a.totalCalls)
      if (sortKey === 'revenue') return Number(b.totalRevenue) - Number(a.totalRevenue)
      if (sortKey === 'price')   return Number(b.pricePerCall) - Number(a.pricePerCall)
      return 0
    })

  return (
    <div className="max-w-content mx-auto px-6 py-12">
      {/* Poster header */}
      <header className="mb-10">
        <h1 className="font-display text-5xl sm:text-6xl leading-[0.95] tracking-tight text-ink">
          Skill Marketplace
        </h1>
        <p className="font-mono text-[12px] sm:text-[13px] tracking-[0.03em] text-muted mt-4">
          EVERY CALL PAYS EVERY CREATOR — <span className="text-accent-strong font-bold">TO THE WEI</span>
        </p>
        <p className="font-mono text-[11px] tracking-[0.1em] uppercase text-muted mt-2">
          {count} {count === 1 ? 'Skill' : 'Skills'} Registered
        </p>
      </header>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6 pb-6 border-b border-line">
        <span className="font-mono text-[11px] tracking-[0.08em] uppercase text-muted mr-1">Tier</span>
        <button
          onClick={() => setTierFilter('all')}
          className="chip-stamp"
          aria-pressed={tierFilter === 'all'}
        >
          All
        </button>
        {([0, 1, 2] as VisibilityTier[]).map((t) => (
          <button
            key={t}
            onClick={() => setTierFilter(t)}
            className="chip-stamp"
            aria-pressed={tierFilter === t}
          >
            {TIER_LABELS[t]}
          </button>
        ))}

        <span className="flex-1" />

        <select
          value={sortKey}
          onChange={(e) => setSortKey(e.target.value as SortKey)}
          className="sel"
          aria-label="Sort skills"
        >
          <option value="calls">Sort · Calls ↓</option>
          <option value="revenue">Sort · Revenue ↓</option>
          <option value="price">Sort · Price ↓</option>
        </select>
      </div>

      {isLoading && (
        <div className="py-12 text-center font-mono text-[13px] text-muted">Loading skills…</div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="py-12 text-center font-mono text-[13px] text-muted">No skills registered yet.</div>
      )}

      {filtered.length > 0 && (
        <>
          <div className="led-head">
            <span>ID</span>
            <span>Skill</span>
            <span className="r">Calls</span>
            <span className="r">Revenue</span>
            <span className="r">Price</span>
            <span className="r">Action</span>
          </div>
          <div>
            {filtered.map((skill) => (
              <SkillRow key={skill.tokenId} skill={skill} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
