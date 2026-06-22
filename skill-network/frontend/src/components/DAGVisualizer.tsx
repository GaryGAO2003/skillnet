import { useReadContract } from 'wagmi'
import { compositionDAGAbi } from '../abi/CompositionDAG'
import { skillNFTAbi } from '../abi/SkillNFT'
import { DAG_ADDRESS, SKILL_NFT_ADDRESS } from '../constants'
import { TierBadge } from './TierBadge'
import type { VisibilityTier } from '../types'
import { Link } from 'react-router-dom'

interface DAGNodeProps {
  skillId: number
  weight?: number
  depth?: number
}

function DAGNode({ skillId, weight, depth = 0 }: DAGNodeProps) {
  const { data: skill } = useReadContract({
    address: SKILL_NFT_ADDRESS,
    abi: skillNFTAbi,
    functionName: 'getSkill',
    args: [BigInt(skillId)],
  })

  const { data: deps } = useReadContract({
    address: DAG_ADDRESS,
    abi: compositionDAGAbi,
    functionName: 'getDependencies',
    args: [BigInt(skillId)],
  })

  if (!skill) return <div className="text-gray-400 text-sm">Loading #{skillId}…</div>

  const indentClass = depth === 0 ? '' : 'border-l-2 border-gray-200 pl-4 ml-2'

  return (
    <div className={`${indentClass} my-2`}>
      <div className="flex items-center gap-2 flex-wrap">
        {weight !== undefined && (
          <span className="text-xs font-mono text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">
            {weight}%
          </span>
        )}
        <Link
          to={`/skill/${skillId}`}
          className="font-medium text-indigo-600 hover:text-indigo-800 text-sm"
        >
          {skill.name}
        </Link>
        <TierBadge tier={skill.tier as VisibilityTier} size="sm" />
        <span className="text-xs text-gray-400">#{skillId}</span>
      </div>

      {deps && deps.length > 0 && (
        <div className="mt-1">
          {deps.map((edge) => (
            <DAGNode
              key={Number(edge.parentSkillId)}
              skillId={Number(edge.parentSkillId)}
              weight={Number(edge.weight)}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  )
}

interface DAGVisualizerProps {
  skillId: number
}

export function DAGVisualizer({ skillId }: DAGVisualizerProps) {
  const { data: isComposed } = useReadContract({
    address: DAG_ADDRESS,
    abi: compositionDAGAbi,
    functionName: 'isComposed',
    args: [BigInt(skillId)],
    query: { enabled: skillId > 0 },
  })

  if (!isComposed) {
    return (
      <div className="text-gray-500 text-sm italic">This skill has no dependencies.</div>
    )
  }

  return (
    <div className="bg-gray-50 rounded-xl border border-gray-200 p-4">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Composition Tree</h3>
      <DAGNode skillId={skillId} />
    </div>
  )
}
