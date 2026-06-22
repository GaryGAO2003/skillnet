import type { Skill, TxLogEntry } from '../types'
import { formatETH } from '../lib/format'

interface Props {
  skills: Skill[]
  txLog: TxLogEntry[]
  creator: string
}

export default function RevenueBreakdown({ skills, txLog, creator }: Props) {
  const mySkills = skills.filter(s => s.creator === creator)

  return (
    <div className="border rounded-lg p-4 bg-white">
      <h4 className="text-sm font-semibold mb-3">Revenue Breakdown</h4>
      <div className="space-y-4">
        {mySkills.map(skill => {
          // Direct revenue = calls where this skill was the top-level skill called
          const directCalls = txLog.filter(t => t.type === 'CALL' && t.skillId === skill.id)
          const directRevenue = directCalls.reduce((s, t) => s + (t.breakdown?.creatorTotal || 0), 0)

          // Royalty revenue = calls where this skill appears in upstream
          const royaltyCalls = txLog.filter(t =>
            t.type === 'CALL' && t.skillId !== skill.id &&
            t.breakdown?.upstream?.some(u => u.creator === creator && u.skillId === skill.id)
          )
          const royaltyRevenue = royaltyCalls.reduce((s, t) => {
            const match = t.breakdown?.upstream?.filter(u => u.creator === creator && u.skillId === skill.id) || []
            return s + match.reduce((a, m) => a + m.amount, 0)
          }, 0)

          return (
            <div key={skill.id}>
              <div className="font-medium text-sm mb-1">{skill.name}: {formatETH(directRevenue + royaltyRevenue)} ETH</div>
              {directRevenue > 0 && (
                <div className="text-xs text-gray-500 ml-4">Direct calls: {formatETH(directRevenue)} ETH ({directCalls.length} calls)</div>
              )}
              {royaltyRevenue > 0 && (
                <div className="text-xs text-gray-500 ml-4">Composition royalties: {formatETH(royaltyRevenue)} ETH</div>
              )}
              {skill.pricePerCall === 0 && directRevenue === 0 && royaltyRevenue > 0 && (
                <div className="text-xs text-green-600 ml-4 font-medium">All revenue from being composed into paid skills</div>
              )}
              {directRevenue === 0 && royaltyRevenue === 0 && (
                <div className="text-xs text-gray-400 ml-4">No revenue yet</div>
              )}
            </div>
          )
        })}
        {mySkills.length === 0 && <p className="text-xs text-gray-400">No skills found for this creator</p>}
      </div>
    </div>
  )
}
