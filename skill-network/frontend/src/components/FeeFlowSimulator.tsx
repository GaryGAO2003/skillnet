import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { compositionDAGAbi } from '../abi/CompositionDAG'
import { skillNFTAbi } from '../abi/SkillNFT'
import { DAG_ADDRESS, SKILL_NFT_ADDRESS } from '../constants'
import { formatEthFloat, registryId } from '../lib/format'

// Depth weights matching FeeRouter.sol
const DEPTH_WEIGHTS = [0.5, 0.3, 0.15, 0.05]

interface FeeFlowRow {
  label: string
  skillId: number
  amount: number
  type: 'protocol' | 'creator' | 'upstream'
  sub?: boolean
}

interface FeeFlowSimulatorProps {
  skillId: number
}

export function FeeFlowSimulator({ skillId }: FeeFlowSimulatorProps) {
  const [ethAmount, setEthAmount] = useState('0.01')
  const payment = parseFloat(ethAmount) || 0

  const { data: skill } = useReadContract({
    address: SKILL_NFT_ADDRESS,
    abi: skillNFTAbi,
    functionName: 'getSkill',
    args: [BigInt(skillId)],
    query: { enabled: skillId > 0 },
  })

  const { data: deps } = useReadContract({
    address: DAG_ADDRESS,
    abi: compositionDAGAbi,
    functionName: 'getDependencies',
    args: [BigInt(skillId)],
    query: { enabled: skillId > 0 },
  })

  const creatorAmount  = payment * 0.70
  const upstreamTotal  = payment * 0.20
  const protocolAmount = payment * 0.10

  const rows: FeeFlowRow[] = [
    { label: 'protocol · network fee', skillId: 0, amount: protocolAmount, type: 'protocol' },
    { label: `creator · ${skill?.name ?? '…'}`, skillId, amount: creatorAmount, type: 'creator' },
  ]

  // Depth-1 distribution
  if (deps && deps.length > 0) {
    const levelAmount = upstreamTotal * DEPTH_WEIGHTS[0]
    deps.forEach((edge) => {
      const share = levelAmount * (Number(edge.weight) / 100)
      rows.push({
        label: `⬡ ${registryId(Number(edge.parentSkillId))} · depth 1 · ${edge.weight}%`,
        skillId: Number(edge.parentSkillId),
        amount: share,
        type: 'upstream',
        sub: true,
      })
    })
    const remainder = upstreamTotal - levelAmount
    if (remainder > 0) {
      rows.push({
        label: 'upstream remainder → creator',
        skillId,
        amount: remainder,
        type: 'upstream',
        sub: true,
      })
    }
  } else {
    rows.push({
      label: 'upstream remainder → creator (no deps)',
      skillId,
      amount: upstreamTotal,
      type: 'upstream',
      sub: true,
    })
  }

  const distributed = rows.reduce((sum, r) => sum + r.amount, 0)
  const remainder = payment - distributed
  const conserved = Math.abs(remainder) < 1e-12

  return (
    <div className="receipt">
      <div className="font-mono text-[12px] font-bold pb-3 mb-4 border-b border-dashed border-line">
        <span className="block text-[16px] mb-1 tracking-tight">
          FEE FLOW · {formatEthFloat(payment)} ETH
        </span>
        <span className="text-muted font-medium">SIMULATED SPLIT · 70 / 20 / 10</span>
      </div>

      <div className="flex items-center gap-3 mb-4">
        <label htmlFor="sim-amt" className="field-label mb-0">Payment (ETH)</label>
        <input
          id="sim-amt"
          type="number"
          min="0"
          step="0.001"
          value={ethAmount}
          onChange={(e) => setEthAmount(e.target.value)}
          className="field-input w-36"
        />
      </div>

      {rows.map((row, i) => (
        <div key={i} className={`rline ${row.sub ? 'sub' : ''}`}>
          <span className="k"><b>{row.label}</b></span>
          <span className="v">{formatEthFloat(row.amount)}</span>
        </div>
      ))}

      <div className="rline total">
        <span className="k">DISTRIBUTED</span>
        <span className="v">{formatEthFloat(distributed)}</span>
      </div>

      <div className="rline remainder">
        <span className="k">REMAINDER</span>
        <span className="v">
          {formatEthFloat(Math.abs(remainder))} ETH{' '}
          {conserved && <span className="ok">✓ CONSERVED</span>}
        </span>
      </div>
    </div>
  )
}
