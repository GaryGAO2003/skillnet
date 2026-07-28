import { useAccount } from 'wagmi'
import { useReadContracts } from 'wagmi'
import { Link } from 'react-router-dom'
import { skillNFTAbi } from '../abi/SkillNFT'
import { SKILL_NFT_ADDRESS } from '../constants'
import { useSkillCount } from '../hooks/useSkillNFT'
import { useClaimableBalance, useWithdraw } from '../hooks/useFeeRouter'
import { TierBadge } from '../components/TierBadge'
import { VisitorEmptyState } from '../components/VisitorEmptyState'
import { formatWeiValue, formatEth, registryMark } from '../lib/format'
import type { SkillWithId, VisibilityTier } from '../types'

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="border-t-2 border-line-strong pt-3">
      <div className="font-mono text-[28px] font-bold tracking-tight text-ink leading-none">{value}</div>
      <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted mt-2">{label}</div>
    </div>
  )
}

export function Dashboard() {
  const { address, isConnected } = useAccount()
  const { data: totalSkills } = useSkillCount()
  const count = Number(totalSkills ?? 0)

  const { data: claimable, refetch: refetchBalance } = useClaimableBalance(address)
  const { withdraw, isPending, isConfirming, isSuccess } = useWithdraw()

  const contracts = count > 0
    ? Array.from({ length: count }, (_, i) => ({
        address: SKILL_NFT_ADDRESS,
        abi: skillNFTAbi,
        functionName: 'getSkill' as const,
        args: [BigInt(i + 1)] as const,
      }))
    : []

  const { data: results } = useReadContracts({
    contracts,
    query: { enabled: count > 0 && isConnected },
  })

  const allSkills: SkillWithId[] = (results ?? [])
    .map((r, i) => r.status === 'success' ? { ...r.result as any, tokenId: i + 1 } : null)
    .filter(Boolean) as SkillWithId[]

  const mySkills = allSkills.filter(
    (s) => address && s.creator.toLowerCase() === address.toLowerCase()
  )

  const totalRevenue = mySkills.reduce((sum, s) => sum + s.totalRevenue, BigInt(0))
  const totalCalls = mySkills.reduce((sum, s) => sum + s.totalCalls, BigInt(0))

  async function handleWithdraw() {
    await withdraw()
    setTimeout(() => refetchBalance(), 3000)
  }

  if (!isConnected) {
    return (
      <VisitorEmptyState
        title="Creator Dashboard"
        pitch="Mint skills, compose them from upstream dependencies, and watch royalties settle to the wei on every call."
        columnLabels={['Calls', 'Revenue']}
        rows={[
          { id: '⬡ 0006', name: 'Full Audit Suite', cols: ['2', '0.030000'] },
          { id: '⬡ 0005', name: 'Solidity Auditor', cols: ['7', '0.035000'] },
          { id: '⬡ 0001', name: 'JSON Parser', cols: ['41', '0.000000'] },
        ]}
      />
    )
  }

  const isBusy = isPending || isConfirming

  return (
    <div className="max-w-content mx-auto px-6 py-12 space-y-10">
      <h1 className="font-display text-5xl leading-[0.95] tracking-tight text-ink">Creator Dashboard</h1>

      {/* Summary stats */}
      <div className="grid grid-cols-3 gap-6">
        <Stat value={mySkills.length.toString()} label="Skills Owned" />
        <Stat value={totalCalls.toString()} label="Total Calls" />
        <Stat value={formatWeiValue(totalRevenue)} label="ETH Revenue" />
      </div>

      {/* Claimable balance — receipt */}
      <div className="receipt flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted">Claimable Balance</div>
          <div className="font-mono text-[26px] font-bold text-ink mt-1">
            {claimable !== undefined ? formatEth(claimable) : '…'}
          </div>
        </div>
        <button
          onClick={handleWithdraw}
          disabled={isBusy || !claimable || claimable === BigInt(0)}
          className="btn btn-primary"
        >
          {isBusy ? 'Withdrawing…' : isSuccess ? 'Withdrawn ✓' : 'Withdraw'}
        </button>
      </div>

      {/* Skills table */}
      <div>
        <h2 className="font-mono text-[11px] font-bold uppercase tracking-[0.1em] text-muted mb-3">Your Skills</h2>
        {mySkills.length === 0 ? (
          <div className="font-mono text-[12px] text-muted border-t border-line pt-4">
            You haven't minted any skills yet.{' '}
            <Link to="/compose" className="text-accent-strong hover:underline">Compose one →</Link>
          </div>
        ) : (
          <table className="ledger-table">
            <thead>
              <tr>
                <th>Skill</th>
                <th>Tier</th>
                <th className="r">Calls</th>
                <th className="r">Revenue</th>
              </tr>
            </thead>
            <tbody>
              {mySkills.map((skill) => (
                <tr key={skill.tokenId}>
                  <td>
                    <Link to={`/skill/${skill.tokenId}`} className="hover:text-accent-strong transition-colors">
                      <span className="font-mono text-muted mr-2">{registryMark(skill.tokenId)}</span>
                      <span className="font-semibold">{skill.name}</span>
                    </Link>
                  </td>
                  <td><TierBadge tier={skill.tier as VisibilityTier} size="sm" /></td>
                  <td className="r">{skill.totalCalls.toString()}</td>
                  <td className="r">{formatWeiValue(skill.totalRevenue)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
