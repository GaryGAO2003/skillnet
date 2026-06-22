import { useState, useEffect } from 'react'
import type { Skill, TxLogEntry } from '../types'
import { fetchState, withdrawBalance } from '../api'
import { formatETH } from '../lib/format'
import TierBadge from '../components/TierBadge'
import RevenueBreakdown from '../components/RevenueBreakdown'
import CallLogTable from '../components/CallLogTable'
import { CREATORS } from '../types'

export default function Dashboard() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [balances, setBalances] = useState<Record<string, number>>({})
  const [txLog, setTxLog] = useState<TxLogEntry[]>([])
  const [creator, setCreator] = useState('alice')
  const [withdrawing, setWithdrawing] = useState(false)

  useEffect(() => {
    const load = async () => {
      const state = await fetchState()
      setSkills(state.skills)
      setBalances(state.balances)
      setTxLog(state.txLog)
    }
    load()
    const iv = setInterval(load, 5000)
    return () => clearInterval(iv)
  }, [])

  const mySkills = skills.filter(s => s.creator === creator && s.status === 'approved')
  const claimable = balances[creator] || 0
  const totalRevenue = mySkills.reduce((s, sk) => s + sk.totalRevenue, 0)

  // Estimate direct vs royalty revenue
  const directRevenue = mySkills.reduce((sum, sk) => {
    const calls = txLog.filter(t => t.type === 'CALL' && t.skillId === sk.id)
    return sum + calls.reduce((s, t) => s + (t.breakdown?.creatorTotal || 0), 0)
  }, 0)

  const royaltyRevenue = txLog
    .filter(t => t.type === 'CALL')
    .reduce((sum, t) => {
      const upstreamForMe = (t.breakdown?.upstream || []).filter(u => u.creator === creator)
      return sum + upstreamForMe.reduce((s, u) => s + u.amount, 0)
    }, 0)

  const totalCalls = mySkills.reduce((s, sk) => s + sk.totalCalls, 0)

  async function handleWithdraw() {
    setWithdrawing(true)
    try {
      await withdrawBalance(creator)
      const state = await fetchState()
      setBalances(state.balances)
    } finally {
      setWithdrawing(false)
    }
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Creator Dashboard</h2>
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500">Viewing as:</span>
          <select value={creator} onChange={e => setCreator(e.target.value)}
            className="border rounded-lg px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
            {CREATORS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="border rounded-lg p-4 bg-white text-center">
          <div className="text-2xl font-bold">{formatETH(claimable)}</div>
          <div className="text-xs text-gray-500">Claimable (ETH)</div>
        </div>
        <div className="border rounded-lg p-4 bg-white text-center">
          <div className="text-2xl font-bold">{formatETH(directRevenue)}</div>
          <div className="text-xs text-gray-500">Direct Calls</div>
          <div className="text-xs text-gray-400">{totalCalls} calls</div>
        </div>
        <div className="border rounded-lg p-4 bg-white text-center">
          <div className="text-2xl font-bold">{formatETH(royaltyRevenue)}</div>
          <div className="text-xs text-gray-500">Royalties</div>
          <div className="text-xs text-gray-400">from upstream compositions</div>
        </div>
      </div>

      {/* My Skills table */}
      <div className="border rounded-lg bg-white mb-6 overflow-hidden">
        <div className="px-4 py-3 bg-gray-50 border-b flex items-center justify-between">
          <h3 className="text-sm font-semibold">My Skills</h3>
          <button onClick={handleWithdraw} disabled={claimable < 1e-10 || withdrawing}
            className="px-4 py-1.5 bg-green-600 text-white text-xs rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-50">
            {withdrawing ? 'Withdrawing...' : `Withdraw ${formatETH(claimable)} ETH`}
          </button>
        </div>
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Skill</th>
              <th className="text-left px-4 py-2 text-gray-500 font-medium text-xs">Tier</th>
              <th className="text-right px-4 py-2 text-gray-500 font-medium text-xs">Score</th>
              <th className="text-right px-4 py-2 text-gray-500 font-medium text-xs">Calls</th>
              <th className="text-right px-4 py-2 text-gray-500 font-medium text-xs">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {mySkills.map(s => (
              <tr key={s.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-2 font-medium">{s.name}</td>
                <td className="px-4 py-2"><TierBadge tier={s.tier} /></td>
                <td className="px-4 py-2 text-right font-mono text-xs">
                  {s.scores ? Math.round((s.scores.schema + s.scores.discover + s.scores.callable + s.scores.success + s.scores.percentile) / 5) : '-'}
                </td>
                <td className="px-4 py-2 text-right font-mono text-xs">{s.totalCalls.toLocaleString()}</td>
                <td className="px-4 py-2 text-right font-mono text-xs">{formatETH(s.totalRevenue)}</td>
              </tr>
            ))}
            {mySkills.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400 text-xs">No approved skills for {creator}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Revenue Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <RevenueBreakdown skills={skills} txLog={txLog} creator={creator} />
        <CallLogTable log={txLog} creator={creator} />
      </div>
    </div>
  )
}
