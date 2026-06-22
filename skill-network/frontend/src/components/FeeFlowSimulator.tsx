import { useState } from 'react'
import { useReadContract } from 'wagmi'
import { compositionDAGAbi } from '../abi/CompositionDAG'
import { skillNFTAbi } from '../abi/SkillNFT'
import { DAG_ADDRESS, SKILL_NFT_ADDRESS } from '../constants'
import { formatEther, parseEther } from 'viem'

// Depth weights matching FeeRouter.sol
const DEPTH_WEIGHTS = [0.5, 0.3, 0.15, 0.05]

interface FeeFlowRow {
  label: string
  skillId: number
  amount: number
  type: 'protocol' | 'creator' | 'upstream'
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
    { label: 'Protocol Treasury', skillId: 0, amount: protocolAmount, type: 'protocol' },
    { label: `Creator (${skill?.name ?? '…'})`, skillId, amount: creatorAmount, type: 'creator' },
  ]

  // Depth-1 distribution
  if (deps && deps.length > 0) {
    const levelAmount = upstreamTotal * DEPTH_WEIGHTS[0]
    deps.forEach((edge) => {
      const share = levelAmount * (Number(edge.weight) / 100)
      rows.push({
        label: `Upstream (depth 1, ${edge.weight}%)`,
        skillId: Number(edge.parentSkillId),
        amount: share,
        type: 'upstream',
      })
    })
    const remainder = upstreamTotal - levelAmount
    if (remainder > 0) {
      rows.push({
        label: 'Upstream remainder → Creator',
        skillId,
        amount: remainder,
        type: 'upstream',
      })
    }
  } else {
    rows.push({
      label: 'Upstream remainder → Creator (no deps)',
      skillId,
      amount: upstreamTotal,
      type: 'upstream',
    })
  }

  const TYPE_COLORS: Record<FeeFlowRow['type'], string> = {
    protocol: 'bg-gray-100 text-gray-700',
    creator: 'bg-indigo-50 text-indigo-700',
    upstream: 'bg-green-50 text-green-700',
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-5">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">Fee Flow Simulator</h3>

      <div className="flex items-center gap-3 mb-4">
        <label className="text-sm text-gray-600 shrink-0">Payment (ETH)</label>
        <input
          type="number"
          min="0"
          step="0.001"
          value={ethAmount}
          onChange={(e) => setEthAmount(e.target.value)}
          className="w-32 border border-gray-300 rounded px-2 py-1 text-sm"
        />
      </div>

      <div className="space-y-2">
        {rows.map((row, i) => (
          <div key={i} className={`flex justify-between items-center rounded px-3 py-2 text-sm ${TYPE_COLORS[row.type]}`}>
            <span>{row.label}</span>
            <span className="font-mono font-medium">{row.amount.toFixed(6)} ETH</span>
          </div>
        ))}
      </div>

      <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between text-sm font-semibold">
        <span>Total</span>
        <span className="font-mono">{payment.toFixed(6)} ETH</span>
      </div>
    </div>
  )
}
