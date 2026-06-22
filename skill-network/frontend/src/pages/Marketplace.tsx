import { useState } from 'react'
import { useReadContracts } from 'wagmi'
import { skillNFTAbi } from '../abi/SkillNFT'
import { SKILL_NFT_ADDRESS, TIER_LABELS } from '../constants'
import { useSkillCount } from '../hooks/useSkillNFT'
import { SkillCard } from '../components/SkillCard'
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
    <div className="max-w-7xl mx-auto px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Skill Marketplace</h1>
        <p className="text-gray-500 mt-1">{count} skills minted on-chain</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => setTierFilter('all')}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              tierFilter === 'all' ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
            }`}
          >
            All
          </button>
          {([0, 1, 2] as VisibilityTier[]).map((t) => (
            <button
              key={t}
              onClick={() => setTierFilter(t)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                tierFilter === t ? 'bg-gray-800 text-white border-gray-800' : 'border-gray-300 text-gray-600 hover:bg-gray-50'
              }`}
            >
              {TIER_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 ml-auto">
          <span className="text-sm text-gray-500">Sort by:</span>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            className="border border-gray-300 rounded px-2 py-1 text-sm"
          >
            <option value="calls">Most Calls</option>
            <option value="revenue">Most Revenue</option>
            <option value="price">Highest Price</option>
          </select>
        </div>
      </div>

      {isLoading && (
        <div className="text-center py-12 text-gray-400">Loading skills…</div>
      )}

      {!isLoading && filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">No skills minted yet.</div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map((skill) => (
          <SkillCard key={skill.tokenId} skill={skill} />
        ))}
      </div>
    </div>
  )
}
