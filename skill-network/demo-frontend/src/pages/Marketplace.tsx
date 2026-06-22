import { useState, useEffect } from 'react'
import type { Skill } from '../types'
import { fetchState } from '../api'
import SkillCard from '../components/SkillCard'
import ScoreDisplay from '../components/ScoreDisplay'
import TierBadge from '../components/TierBadge'
import { SKILL_TYPE_LABELS } from '../types'

interface Props {
  onCallSkill: (skill: Skill) => void
  onViewDAG: (skillId: number) => void
}

export default function Marketplace({ onCallSkill, onViewDAG }: Props) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [tierFilter, setTierFilter] = useState('All')
  const [sortBy, setSortBy] = useState<'score' | 'calls' | 'revenue' | 'id'>('id')
  const [detailId, setDetailId] = useState<number | null>(null)

  useEffect(() => {
    const load = async () => {
      const state = await fetchState()
      setSkills(state.skills.filter(s => s.status === 'approved'))
    }
    load()
    const iv = setInterval(load, 10000)
    return () => clearInterval(iv)
  }, [])

  const filtered = skills
    .filter(s => tierFilter === 'All' || s.tier === tierFilter)
    .sort((a, b) => {
      if (sortBy === 'score') {
        const sa = a.scores ? (a.scores.schema + a.scores.discover + a.scores.callable + a.scores.success + a.scores.percentile) / 5 : 0
        const sb = b.scores ? (b.scores.schema + b.scores.discover + b.scores.callable + b.scores.success + b.scores.percentile) / 5 : 0
        return sb - sa
      }
      if (sortBy === 'calls') return b.totalCalls - a.totalCalls
      if (sortBy === 'revenue') return b.totalRevenue - a.totalRevenue
      return a.id - b.id
    })

  const detail = detailId ? skills.find(s => s.id === detailId) : null

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold">Marketplace</h2>
        <span className="text-sm text-gray-400">{filtered.length} skills</span>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex gap-1">
          {['All', 'OPEN', 'SHIELDED', 'PRIVATE'].map(t => (
            <button key={t} onClick={() => setTierFilter(t)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
                tierFilter === t ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
              }`}>{t}</button>
          ))}
        </div>
        <select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="text-xs border rounded-lg px-2 py-1.5 bg-white">
          <option value="id">Sort by ID</option>
          <option value="score">Sort by Score</option>
          <option value="calls">Sort by Calls</option>
          <option value="revenue">Sort by Revenue</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {filtered.map(s => (
          <SkillCard key={s.id} skill={s}
            onCall={() => onCallSkill(s)}
            onViewDAG={() => onViewDAG(s.id)}
            onDetails={() => setDetailId(detailId === s.id ? null : s.id)} />
        ))}
      </div>

      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-400">No skills match the current filter.</div>
      )}

      {/* Detail panel */}
      {detail && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={() => setDetailId(null)}>
          <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6 animate-fade-in" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3 mb-3">
              <TierBadge tier={detail.tier} />
              <h3 className="font-bold text-lg">{detail.name}</h3>
            </div>
            <p className="text-sm text-gray-600 mb-4">{detail.description}</p>
            <div className="text-xs text-gray-500 mb-1">Type: {SKILL_TYPE_LABELS[detail.skillType]}</div>
            <div className="text-xs text-gray-500 mb-1">Creator: {detail.creator}</div>
            <div className="text-xs text-gray-500 mb-4">Created: {new Date(detail.createdAt).toLocaleDateString()}</div>
            {detail.scores && (
              <div className="mb-4">
                <div className="text-xs font-medium text-gray-700 mb-2">Quality Scores</div>
                <ScoreDisplay scores={detail.scores} />
              </div>
            )}
            <button onClick={() => setDetailId(null)} className="w-full py-2 border rounded-lg text-sm hover:bg-gray-50 transition-colors">Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
