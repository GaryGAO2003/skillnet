import { useAccount } from 'wagmi'
import { useReadContracts } from 'wagmi'
import { formatEther } from 'viem'
import { Link } from 'react-router-dom'
import { skillNFTAbi } from '../abi/SkillNFT'
import { SKILL_NFT_ADDRESS } from '../constants'
import { useSkillCount } from '../hooks/useSkillNFT'
import { useClaimableBalance, useWithdraw } from '../hooks/useFeeRouter'
import { TierBadge } from '../components/TierBadge'
import type { SkillWithId, VisibilityTier } from '../types'

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
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <p className="text-gray-500">Connect your wallet to view your dashboard.</p>
      </div>
    )
  }

  const isBusy = isPending || isConfirming

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Creator Dashboard</h1>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 text-center">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-2xl font-bold text-gray-900">{mySkills.length}</div>
          <div className="text-sm text-gray-500">Skills Owned</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-2xl font-bold text-gray-900">{totalCalls.toString()}</div>
          <div className="text-sm text-gray-500">Total Calls</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-2xl font-bold text-gray-900">{formatEther(totalRevenue).slice(0, 8)}</div>
          <div className="text-sm text-gray-500">ETH Revenue</div>
        </div>
      </div>

      {/* Claimable balance */}
      <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-5 flex items-center justify-between">
        <div>
          <div className="text-sm text-indigo-600 font-medium">Claimable Balance</div>
          <div className="text-2xl font-bold text-indigo-900 mt-1">
            {claimable !== undefined ? formatEther(claimable) : '…'} ETH
          </div>
        </div>
        <button
          onClick={handleWithdraw}
          disabled={isBusy || !claimable || claimable === BigInt(0)}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-medium rounded-lg px-5 py-2.5 text-sm transition-colors"
        >
          {isBusy ? 'Withdrawing…' : isSuccess ? 'Withdrawn!' : 'Withdraw'}
        </button>
      </div>

      {/* Skills table */}
      <div>
        <h2 className="text-lg font-semibold text-gray-800 mb-3">Your Skills</h2>
        {mySkills.length === 0 ? (
          <div className="text-gray-400 text-sm">
            You haven't minted any skills yet.{' '}
            <Link to="/compose" className="text-indigo-600 hover:underline">Compose one.</Link>
          </div>
        ) : (
          <div className="space-y-3">
            {mySkills.map((skill) => (
              <div
                key={skill.tokenId}
                className="bg-white border border-gray-200 rounded-xl px-4 py-3 flex items-center gap-4"
              >
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/skill/${skill.tokenId}`}
                    className="font-medium text-gray-900 hover:text-indigo-600 truncate block"
                  >
                    {skill.name}
                  </Link>
                  <div className="text-xs text-gray-400 mt-0.5">#{skill.tokenId}</div>
                </div>
                <TierBadge tier={skill.tier as VisibilityTier} size="sm" />
                <div className="text-right text-sm">
                  <div className="text-gray-700 font-medium">{skill.totalCalls.toString()} calls</div>
                  <div className="text-gray-400">{formatEther(skill.totalRevenue).slice(0, 8)} ETH</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
