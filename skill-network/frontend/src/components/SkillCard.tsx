import { Link } from 'react-router-dom'
import { formatEther } from 'viem'
import { TierBadge } from './TierBadge'
import { usePayForCall } from '../hooks/useFeeRouter'
import { SKILL_TYPE_LABELS } from '../constants'
import type { SkillWithId } from '../types'

interface SkillCardProps {
  skill: SkillWithId
}

export function SkillCard({ skill }: SkillCardProps) {
  const { payForCall, isPending, isConfirming } = usePayForCall()

  async function handleCall() {
    if (skill.pricePerCall === BigInt(0)) {
      await payForCall(skill.tokenId, BigInt(1))
    } else {
      await payForCall(skill.tokenId, skill.pricePerCall)
    }
  }

  const isBusy = isPending || isConfirming

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm hover:shadow-md transition-shadow p-5 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-gray-900 leading-tight">{skill.name}</h3>
        <TierBadge tier={skill.tier} size="sm" />
      </div>

      <p className="text-sm text-gray-500 line-clamp-2">{skill.description}</p>

      <div className="text-xs text-gray-400 font-mono">
        {SKILL_TYPE_LABELS[skill.skillType]}
      </div>

      <div className="grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-gray-50 rounded p-2">
          <div className="font-semibold text-gray-700">{skill.totalCalls.toString()}</div>
          <div className="text-gray-400">Calls</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="font-semibold text-gray-700">{formatEther(skill.totalRevenue).slice(0, 7)}</div>
          <div className="text-gray-400">ETH Revenue</div>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <div className="font-semibold text-gray-700">
            {skill.pricePerCall === BigInt(0) ? 'Free' : `${formatEther(skill.pricePerCall)} ETH`}
          </div>
          <div className="text-gray-400">Price</div>
        </div>
      </div>

      <div className="flex gap-2 mt-1">
        <button
          onClick={handleCall}
          disabled={isBusy}
          className="flex-1 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white text-sm font-medium rounded-lg py-2 transition-colors"
        >
          {isBusy ? 'Processing…' : 'Call Skill'}
        </button>
        <Link
          to={`/skill/${skill.tokenId}`}
          className="flex-1 text-center border border-gray-300 hover:bg-gray-50 text-gray-700 text-sm font-medium rounded-lg py-2 transition-colors"
        >
          View DAG
        </Link>
      </div>
    </div>
  )
}
