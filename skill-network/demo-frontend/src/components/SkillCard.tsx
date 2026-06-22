import type { Skill } from '../types'
import { SKILL_TYPE_LABELS, } from '../types'
import TierBadge from './TierBadge'
import ScoreDisplay from './ScoreDisplay'
import { formatETH } from '../lib/format'

interface Props {
  skill: Skill
  onCall?: () => void
  onViewDAG?: () => void
  onDetails?: () => void
}

export default function SkillCard({ skill, onCall, onViewDAG, onDetails }: Props) {
  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-center justify-between mb-2">
        <TierBadge tier={skill.tier} />
        <span className="text-xs text-gray-400">v{skill.version}</span>
      </div>
      <h3 className="font-semibold text-base mb-0.5">{skill.name}</h3>
      <p className="text-xs text-gray-500 mb-3">{SKILL_TYPE_LABELS[skill.skillType] || skill.skillType}</p>

      {skill.scores && <div className="mb-3"><ScoreDisplay scores={skill.scores} compact /></div>}

      <div className="flex gap-4 text-xs text-gray-500 mb-3">
        <span>Calls: {skill.totalCalls.toLocaleString()}</span>
        <span>Revenue: {formatETH(skill.totalRevenue)} ETH</span>
      </div>
      <div className="text-xs text-gray-500 mb-3">
        Price: {skill.pricePerCall > 0 ? `${formatETH(skill.pricePerCall)} ETH` : 'Free'}
      </div>

      <div className="flex gap-2">
        {onCall && <button onClick={onCall} className="flex-1 text-xs py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors">Call</button>}
        {onViewDAG && <button onClick={onViewDAG} className="flex-1 text-xs py-1.5 border border-gray-300 rounded hover:bg-gray-50 transition-colors">View DAG</button>}
        {onDetails && <button onClick={onDetails} className="flex-1 text-xs py-1.5 border border-gray-300 rounded hover:bg-gray-50 transition-colors">Details</button>}
      </div>
    </div>
  )
}
