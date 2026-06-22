import { useParams, Link } from 'react-router-dom'
import { formatEther } from 'viem'
import { useSkillMetadata } from '../hooks/useSkillNFT'
import { useDependents } from '../hooks/useCompositionDAG'
import { usePayForCall } from '../hooks/useFeeRouter'
import { DAGVisualizer } from '../components/DAGVisualizer'
import { FeeFlowSimulator } from '../components/FeeFlowSimulator'
import { TierBadge } from '../components/TierBadge'
import { SKILL_TYPE_LABELS } from '../constants'
import type { VisibilityTier } from '../types'

export function SkillDetail() {
  const { id } = useParams<{ id: string }>()
  const skillId = Number(id)

  const { data: skill, isLoading } = useSkillMetadata(skillId)
  const { data: dependents } = useDependents(skillId)
  const { payForCall, isPending, isConfirming, isSuccess } = usePayForCall()

  async function handleCall() {
    if (!skill) return
    const value = skill.pricePerCall > BigInt(0) ? skill.pricePerCall : BigInt(1)
    await payForCall(skillId, value)
  }

  if (isLoading) return <div className="text-center py-12 text-gray-400">Loading…</div>
  if (!skill) return <div className="text-center py-12 text-red-400">Skill not found.</div>

  const isBusy = isPending || isConfirming

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <div>
        <Link to="/" className="text-sm text-indigo-600 hover:text-indigo-800">← Back to Marketplace</Link>
      </div>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">{skill.name}</h1>
          <p className="text-gray-500 mt-1">{skill.description}</p>
        </div>
        <TierBadge tier={skill.tier as VisibilityTier} />
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        {[
          ['Type', SKILL_TYPE_LABELS[skill.skillType]],
          ['Token ID', `#${skillId}`],
          ['Creator', skill.creator.slice(0, 6) + '…' + skill.creator.slice(-4)],
          ['Price', skill.pricePerCall > BigInt(0) ? `${formatEther(skill.pricePerCall)} ETH` : 'Free'],
          ['Total Calls', skill.totalCalls.toString()],
          ['Total Revenue', `${formatEther(skill.totalRevenue)} ETH`],
          ['Version', skill.version.toString()],
          ['Created', new Date(Number(skill.createdAt) * 1000).toLocaleDateString()],
        ].map(([label, value]) => (
          <div key={label} className="bg-gray-50 rounded-lg px-4 py-3">
            <div className="text-gray-400 text-xs mb-0.5">{label}</div>
            <div className="font-medium text-gray-800 truncate">{value}</div>
          </div>
        ))}
      </div>

      {/* Revenue breakdown */}
      <div className="bg-indigo-50 rounded-xl p-4 text-sm">
        <h3 className="font-semibold text-indigo-800 mb-2">Revenue Split (per call)</h3>
        <div className="flex gap-6 text-indigo-700">
          <span>70% → Creator</span>
          <span>20% → Upstream royalties</span>
          <span>10% → Protocol</span>
        </div>
      </div>

      {/* DAG Visualizer */}
      <DAGVisualizer skillId={skillId} />

      {/* Dependents */}
      {dependents && dependents.length > 0 && (
        <div>
          <h3 className="text-sm font-semibold text-gray-700 mb-2">Used by ({dependents.length})</h3>
          <div className="flex flex-wrap gap-2">
            {dependents.map((depId) => (
              <Link
                key={String(depId)}
                to={`/skill/${depId}`}
                className="text-sm text-indigo-600 hover:text-indigo-800 bg-indigo-50 rounded px-2 py-1"
              >
                #{String(depId)}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Fee Flow Simulator */}
      <FeeFlowSimulator skillId={skillId} />

      {/* Call button */}
      <button
        onClick={handleCall}
        disabled={isBusy}
        className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-xl py-3 text-sm transition-colors"
      >
        {isBusy ? 'Processing…' : isSuccess ? 'Called!' : `Call This Skill${skill.pricePerCall > BigInt(0) ? ` (${formatEther(skill.pricePerCall)} ETH)` : ''}`}
      </button>
    </div>
  )
}
