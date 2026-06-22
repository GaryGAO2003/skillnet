import { useState, useEffect } from 'react'
import type { Skill } from '../types'
import { fetchState, mintSkill, composeSkill } from '../api'
import TierSelector from '../components/TierSelector'
import TierBadge from '../components/TierBadge'
import { tierDot } from '../lib/format'
import { CREATORS } from '../types'

interface Props {
  onSubmitted: (skillId: number) => void
}

export default function ComposeSkill({ onSubmitted }: Props) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [tier, setTier] = useState('OPEN')
  const [price, setPrice] = useState('0.005')
  const [creator, setCreator] = useState('alice')
  const [deps, setDeps] = useState<{ skillId: number; weight: number }[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetchState().then(s => setSkills(s.skills.filter(sk => sk.status === 'approved')))
  }, [])

  const totalWeight = deps.reduce((s, d) => s + d.weight, 0)
  const selectedIds = new Set(deps.map(d => d.skillId))
  const available = skills.filter(s => !selectedIds.has(s.id))

  function addDep(skillId: number) {
    setDeps([...deps, { skillId, weight: 0 }])
  }

  function removeDep(idx: number) {
    setDeps(deps.filter((_, i) => i !== idx))
  }

  function setWeight(idx: number, w: number) {
    setDeps(deps.map((d, i) => i === idx ? { ...d, weight: w } : d))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    if (deps.length < 1) { setError('Add at least one dependency'); return }
    if (totalWeight !== 100) { setError(`Weights must sum to 100 (currently ${totalWeight})`); return }

    setSubmitting(true)
    try {
      const res = await mintSkill({
        name: name.trim(),
        description: description.trim(),
        skillType: 'COMPOSITE_BUNDLE',
        tier,
        pricePerCall: parseFloat(price) || 0,
        creator,
      })

      await composeSkill(
        res.id,
        deps.map(d => d.skillId),
        deps.map(d => d.weight),
        creator,
      )

      onSubmitted(res.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to compose')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-6">Compose a New Skill</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Research Pipeline"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={2}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Tier</label>
            <TierSelector value={tier} onChange={setTier} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price (ETH)</label>
            <input type="number" step="0.001" min="0" value={price} onChange={e => setPrice(e.target.value)}
              className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
            <div className="mt-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Creator</label>
              <select value={creator} onChange={e => setCreator(e.target.value)}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
                {CREATORS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Dependencies</label>
          <div className="border rounded-lg p-4 space-y-3">
            {deps.map((dep, i) => {
              const skill = skills.find(s => s.id === dep.skillId)
              return (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 flex items-center gap-2">
                    {skill && <TierBadge tier={skill.tier} />}
                    <span className="text-sm font-medium">{skill?.name}</span>
                    {skill?.scores && <span className="text-xs text-gray-400">score:{Math.round((skill.scores.schema+skill.scores.discover+skill.scores.callable+skill.scores.success+skill.scores.percentile)/5)}</span>}
                  </div>
                  <input type="number" min="1" max="100" value={dep.weight} onChange={e => setWeight(i, parseInt(e.target.value) || 0)}
                    className="w-20 border rounded px-2 py-1 text-sm text-center" />
                  <span className="text-xs text-gray-400">%</span>
                  <button type="button" onClick={() => removeDep(i)} className="text-xs text-red-500 hover:underline">remove</button>
                </div>
              )
            })}

            {available.length > 0 && (
              <select onChange={e => { if (e.target.value) addDep(Number(e.target.value)); e.target.value = '' }}
                className="w-full border rounded-lg px-3 py-2 text-sm bg-white text-gray-500" defaultValue="">
                <option value="">+ Add Dependency</option>
                {available.map(s => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.tier}{s.tier === 'PRIVATE' ? ' - requires approval' : ''})
                  </option>
                ))}
              </select>
            )}

            <div className={`text-xs font-medium ${totalWeight === 100 ? 'text-green-600' : 'text-red-600'}`}>
              Total weight: {totalWeight}% {totalWeight === 100 ? '\u2713' : `(need ${100 - totalWeight} more)`}
            </div>
          </div>
        </div>

        {/* DAG Preview */}
        {deps.length > 0 && (
          <div className="border rounded-lg p-4 bg-gray-50">
            <h4 className="text-xs font-semibold text-gray-500 mb-2">Preview</h4>
            <div className="text-sm">
              <div className="font-medium">{name || 'New Skill'} (depth 1)</div>
              {deps.map((dep, i) => {
                const skill = skills.find(s => s.id === dep.skillId)
                return (
                  <div key={i} className="ml-5 flex items-center gap-2 mt-0.5">
                    <span className="text-gray-400">{i === deps.length - 1 ? '\u2514' : '\u251C'}\u2500\u2500</span>
                    <div className={`w-2 h-2 rounded-full ${tierDot(skill?.tier || 'OPEN')}`} />
                    <span>{skill?.name}</span>
                    <span className="text-xs text-gray-400">[{dep.weight}%]</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50">
          {submitting ? 'Composing...' : 'Submit for Validation \u2192'}
        </button>
        <p className="text-xs text-gray-400 text-center">Composed skills also need validator approval</p>
      </form>
    </div>
  )
}
