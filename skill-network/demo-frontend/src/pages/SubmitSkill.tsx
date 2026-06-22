import { useState } from 'react'
import TierSelector from '../components/TierSelector'
import { mintSkill } from '../api'
import { SKILL_TYPES, SKILL_TYPE_LABELS, CREATORS } from '../types'

interface Props {
  onSubmitted: (skillId: number) => void
}

export default function SubmitSkill({ onSubmitted }: Props) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [skillType, setSkillType] = useState('PROMPT_WORKFLOW')
  const [tier, setTier] = useState('OPEN')
  const [price, setPrice] = useState('0.001')
  const [creator, setCreator] = useState('alice')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    if (!name.trim()) { setError('Name is required'); return }
    if (!description.trim()) { setError('Description is required'); return }

    setSubmitting(true)
    try {
      const res = await mintSkill({
        name: name.trim(),
        description: description.trim(),
        skillType,
        tier,
        pricePerCall: parseFloat(price) || 0,
        creator,
      })
      onSubmitted(res.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <h2 className="text-xl font-bold mb-6">Submit a New Skill</h2>
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
          <input type="text" value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. Token Analysis Agent"
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
            placeholder="Describe what this skill does, its inputs and outputs..."
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Skill Type</label>
          <select value={skillType} onChange={e => setSkillType(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
            {SKILL_TYPES.map(t => <option key={t} value={t}>{SKILL_TYPE_LABELS[t]}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">Visibility Tier</label>
          <TierSelector value={tier} onChange={setTier} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Price per call (ETH)</label>
          <input type="number" step="0.001" min="0" value={price} onChange={e => setPrice(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none" />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Creator wallet (simulated)</label>
          <select value={creator} onChange={e => setCreator(e.target.value)}
            className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white">
            {CREATORS.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="submit" disabled={submitting}
          className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
          {submitting ? 'Submitting...' : 'Submit for Validation \u2192'}
        </button>
      </form>
    </div>
  )
}
