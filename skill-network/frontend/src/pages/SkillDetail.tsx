import { useParams, Link } from 'react-router-dom'
import { useSkillMetadata } from '../hooks/useSkillNFT'
import { useDependents } from '../hooks/useCompositionDAG'
import { usePayForCall } from '../hooks/useFeeRouter'
import { DAGVisualizer } from '../components/DAGVisualizer'
import { FeeFlowSimulator } from '../components/FeeFlowSimulator'
import { TierBadge } from '../components/TierBadge'
import { SKILL_TYPE_LABELS } from '../constants'
import { formatWeiValue, formatEth, registryMark, registryId } from '../lib/format'
import type { VisibilityTier } from '../types'

function MetaCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-t border-line pt-3">
      <div className="font-mono text-[10px] font-bold uppercase tracking-[0.1em] text-muted mb-1">{label}</div>
      <div className="font-mono text-[13px] text-ink truncate">{value}</div>
    </div>
  )
}

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

  if (isLoading) return <div className="py-12 text-center font-mono text-[13px] text-muted">Loading…</div>
  if (!skill) return <div className="py-12 text-center font-mono text-[13px] text-danger">Skill not found.</div>

  const isBusy = isPending || isConfirming
  const isFree = skill.pricePerCall === BigInt(0)

  // Wei-exact revenue split at the listed price (informational).
  const price = skill.pricePerCall
  const protocol = (price * 10n) / 100n
  const creator = (price * 70n) / 100n
  const upstream = price - protocol - creator
  const distributed = protocol + creator + upstream
  const remainder = price - distributed

  return (
    <div className="max-w-content mx-auto px-6 py-10 space-y-10">
      <div>
        <Link to="/marketplace" className="font-mono text-[12px] text-muted hover:text-ink transition-colors">← Back to Marketplace</Link>
      </div>

      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex-1">
          <div className="font-mono text-[13px] font-bold text-accent-strong mb-2">{registryMark(skillId)}</div>
          <h1 className="font-display text-4xl sm:text-5xl leading-[0.95] tracking-tight text-ink">{skill.name}</h1>
          <p className="text-muted mt-2 max-w-[60ch]">{skill.description}</p>
        </div>
        <TierBadge tier={skill.tier as VisibilityTier} />
      </div>

      {/* Metadata ledger grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-6 gap-y-4">
        <MetaCell label="Type" value={SKILL_TYPE_LABELS[skill.skillType]} />
        <MetaCell label="Registry ID" value={`⬡ ${registryId(skillId)}`} />
        <MetaCell label="Creator" value={`${skill.creator.slice(0, 6)}…${skill.creator.slice(-4)}`} />
        <MetaCell label="Price" value={isFree ? 'FREE' : formatEth(skill.pricePerCall)} />
        <MetaCell label="Total Calls" value={skill.totalCalls.toString()} />
        <MetaCell label="Total Revenue" value={formatEth(skill.totalRevenue)} />
        <MetaCell label="Version" value={`v${skill.version.toString()}`} />
        <MetaCell label="Created" value={new Date(Number(skill.createdAt) * 1000).toLocaleDateString()} />
      </div>

      {/* Revenue split — receipt block */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <div className="receipt">
          <div className="font-mono text-[12px] font-bold pb-3 mb-4 border-b border-dashed border-line">
            <span className="block text-[16px] mb-1 tracking-tight">
              REVENUE SPLIT · {isFree ? '0.000000' : formatWeiValue(price)} ETH
            </span>
            <span className="text-muted font-medium">PER CALL · {registryMark(skillId)}</span>
          </div>
          <div className="rline"><span className="k"><b>protocol</b> · network fee (10%)</span><span className="v">{formatWeiValue(protocol)}</span></div>
          <div className="rline"><span className="k"><b>creator</b> · {skill.name} (70%)</span><span className="v">{formatWeiValue(creator)}</span></div>
          <div className="rline"><span className="k"><b>upstream</b> · ancestor royalties (20%)</span><span className="v">{formatWeiValue(upstream)}</span></div>
          <div className="rline total"><span className="k">DISTRIBUTED</span><span className="v">{formatWeiValue(distributed)}</span></div>
          <div className="rline remainder">
            <span className="k">REMAINDER</span>
            <span className="v">{formatWeiValue(remainder)} ETH <span className="ok">✓ CONSERVED</span></span>
          </div>
        </div>

        {/* Fee Flow Simulator (receipt) */}
        <FeeFlowSimulator skillId={skillId} />
      </div>

      {/* DAG Visualizer (wire panel) */}
      <DAGVisualizer skillId={skillId} />

      {/* Dependents */}
      {dependents && dependents.length > 0 && (
        <div>
          <h3 className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted mb-3">
            Used by ({dependents.length})
          </h3>
          <div className="flex flex-wrap gap-2">
            {dependents.map((depId) => (
              <Link
                key={String(depId)}
                to={`/skill/${depId}`}
                className="font-mono text-[12px] text-ink border border-line border-b-2 border-b-line-strong rounded-sm px-2.5 py-1 hover:bg-surface transition-colors"
              >
                ⬡ {registryId(Number(depId))}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Call button — full-width lime primary */}
      <button
        onClick={handleCall}
        disabled={isBusy}
        className="btn btn-primary btn-block py-3.5 text-[14px]"
      >
        {isBusy ? 'Processing…' : isSuccess ? 'Called ✓' : `Call This Skill${isFree ? '' : ` · ${formatEth(skill.pricePerCall)}`}`}
      </button>
    </div>
  )
}
