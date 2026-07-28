import { useReadContract } from 'wagmi'
import { useNavigate } from 'react-router-dom'
import { compositionDAGAbi } from '../abi/CompositionDAG'
import { skillNFTAbi } from '../abi/SkillNFT'
import { DAG_ADDRESS, SKILL_NFT_ADDRESS } from '../constants'
import { registryId } from '../lib/format'

interface DAGNodeProps {
  skillId: number
  weight?: number
  depth?: number
}

function DAGNode({ skillId, weight, depth = 0 }: DAGNodeProps) {
  const navigate = useNavigate()

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

  const hasDeps = !!deps && deps.length > 0
  const isRoot = depth === 0

  if (!skill) {
    return <div className="wire-node"><span className="wire-hex">⬡ {registryId(skillId)}</span></div>
  }

  return (
    <div>
      <div className="wire-node">
        {weight !== undefined && <span className="wire-weight">{weight}%</span>}
        <span className={`wire-hex ${!isRoot && !hasDeps ? 'leaf' : ''}`}>⬡ {registryId(skillId)}</span>
        <button
          type="button"
          onClick={() => navigate(`/skill/${skillId}`)}
          className="wire-name hover:underline"
          style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}
        >
          {skill.name}
        </button>
      </div>

      {hasDeps && (
        <div className="wire-branch active">
          {deps!.map((edge) => (
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
      <div className="wire-panel">
        <div className="wire-head">
          <span>The Wire · Composition</span>
        </div>
        <div className="px-4 py-6 text-[12px] text-wire-dim font-mono">
          Leaf skill — no upstream dependencies.
        </div>
      </div>
    )
  }

  return (
    <div className="wire-panel">
      <div className="wire-head">
        <span>The Wire · Composition</span>
        <span className="live"><i /> Flowing</span>
      </div>
      <div className="px-4 py-4">
        <DAGNode skillId={skillId} />
      </div>
      <div className="wire-legend">
        <span className="a"><i />active ancestor path</span>
        <span className="d"><i />registry mark</span>
      </div>
      <div className="wire-cap">
        THE WIRE — value flows through the <b>ancestor DAG</b>
      </div>
    </div>
  )
}
