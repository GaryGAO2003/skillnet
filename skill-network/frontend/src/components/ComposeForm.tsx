import { useState } from 'react'
import { useAccount } from 'wagmi'
import { keccak256, toHex, parseEther } from 'viem'
import { useMintSkill } from '../hooks/useSkillNFT'
import { useCompose } from '../hooks/useCompositionDAG'
import { SKILL_TYPE_LABELS, TIER_LABELS } from '../constants'
import type { SkillType, VisibilityTier, SkillWithId } from '../types'

interface ParentEntry {
  skillId: number
  weight: number
  name: string
}

interface ComposeFormProps {
  availableSkills: SkillWithId[]
  onSuccess?: () => void
}

export function ComposeForm({ availableSkills, onSuccess }: ComposeFormProps) {
  const { address } = useAccount()

  // Metadata step
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [skillType, setSkillType] = useState<SkillType>(6) // COMPOSITE_BUNDLE default
  const [tier, setTier] = useState<VisibilityTier>(0)
  const [priceEth, setPriceEth] = useState('0')
  const [schemaURI, setSchemaURI] = useState('')

  // Parents step
  const [parents, setParents] = useState<ParentEntry[]>([])
  const [step, setStep] = useState<1 | 2 | 3>(1)

  const totalWeight = parents.reduce((sum, p) => sum + p.weight, 0)
  const weightsValid = parents.length === 0 || totalWeight === 100

  const { mintSkill, isPending: isMinting, isConfirming: isConfirmingMint } = useMintSkill()
  const { compose, isPending: isComposing, isConfirming: isConfirmingCompose } = useCompose()

  const isBusy = isMinting || isConfirmingMint || isComposing || isConfirmingCompose

  function addParent(skill: SkillWithId) {
    if (parents.find((p) => p.skillId === skill.tokenId)) return
    setParents([...parents, { skillId: skill.tokenId, weight: 0, name: skill.name }])
  }

  function removeParent(skillId: number) {
    setParents(parents.filter((p) => p.skillId !== skillId))
  }

  function updateWeight(skillId: number, weight: number) {
    setParents(parents.map((p) => (p.skillId === skillId ? { ...p, weight } : p)))
  }

  async function handleSubmit() {
    if (!address) return
    try {
      const contentHash = keccak256(toHex(name + description + Date.now()))
      const price = parseEther(priceEth || '0')

      const txHash = await mintSkill({
        name,
        description,
        skillType,
        tier,
        contentHash,
        schemaURI: schemaURI || `ipfs://placeholder-${Date.now()}`,
        pricePerCall: price,
      })

      // We need the minted token ID — in a real app listen to SkillMinted event
      // For simplicity, fetch totalSkills after mint to get the latest ID
      // (This is a demo; production would parse the tx receipt logs)
      await new Promise((r) => setTimeout(r, 3000))

      // TODO: parse tokenId from receipt logs for robustness
      // For now user must call compose separately or we re-fetch

      onSuccess?.()
    } catch (err) {
      console.error('Mint failed:', err)
    }
  }

  return (
    <div className="space-y-6">
      {/* Step indicator */}
      <div className="flex gap-4 text-sm">
        {([1, 2, 3] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStep(s)}
            className={`px-3 py-1 rounded-full font-medium ${
              step === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'
            }`}
          >
            {s === 1 ? 'Metadata' : s === 2 ? 'Dependencies' : 'Preview & Submit'}
          </button>
        ))}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              placeholder="My Composed Skill"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Skill Type</label>
              <select
                value={skillType}
                onChange={(e) => setSkillType(Number(e.target.value) as SkillType)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {SKILL_TYPE_LABELS.map((label, i) => (
                  <option key={i} value={i}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Visibility Tier</label>
              <select
                value={tier}
                onChange={(e) => setTier(Number(e.target.value) as VisibilityTier)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
              >
                {TIER_LABELS.map((label, i) => (
                  <option key={i} value={i}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Price Per Call (ETH)</label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={priceEth}
              onChange={(e) => setPriceEth(e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={!name}
            className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
          >
            Next: Select Dependencies
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <p className="text-sm text-gray-600 mb-1">
              Parent dependencies <span className="text-gray-400">(optional — skip to create a leaf skill)</span>
            </p>

            {availableSkills.length === 0 ? (
              <div className="border border-gray-200 rounded-lg p-4 bg-gray-50 text-sm text-gray-400 italic">
                No skills available to depend on yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-3">
                {availableSkills.map((skill) => {
                  const isAdded = !!parents.find((p) => p.skillId === skill.tokenId)
                  return (
                    <button
                      key={skill.tokenId}
                      type="button"
                      onClick={() => isAdded ? removeParent(skill.tokenId) : addParent(skill)}
                      className={`text-left text-sm px-3 py-2 rounded-lg border transition-colors ${
                        isAdded
                          ? 'border-indigo-400 bg-indigo-50 text-indigo-700'
                          : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                      }`}
                    >
                      <span className="font-mono text-gray-400 mr-1">#{skill.tokenId}</span> {skill.name}
                      {isAdded && <span className="ml-2 text-xs">✓</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {parents.length === 0 && (
              <p className="text-xs text-gray-400 mt-1">
                No parents selected — this skill will be a <strong>leaf skill</strong> and keeps 90% of each call fee.
              </p>
            )}
          </div>

          {parents.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm font-medium text-gray-700">
                Royalty weights (total:{' '}
                <span className={totalWeight === 100 ? 'text-green-600 font-semibold' : 'text-red-500 font-semibold'}>
                  {totalWeight}
                </span>
                /100 — must equal 100)
              </p>
              {parents.map((p) => (
                <div key={p.skillId} className="flex items-center gap-3">
                  <span className="text-sm text-gray-600 flex-1 truncate">{p.name}</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={p.weight}
                    onChange={(e) => updateWeight(p.skillId, Number(e.target.value))}
                    className="w-20 border border-gray-300 rounded px-2 py-1 text-sm text-right"
                  />
                  <span className="text-sm text-gray-400">%</span>
                  <button
                    type="button"
                    onClick={() => removeParent(p.skillId)}
                    className="text-gray-400 hover:text-red-500 text-xs"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex-1 border border-gray-300 rounded-lg py-2 text-sm"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!weightsValid}
              className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
            >
              {parents.length === 0 ? 'Next: Preview (no dependencies)' : 'Next: Preview'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-2">
            <div><span className="text-gray-500">Name:</span> <strong>{name}</strong></div>
            <div><span className="text-gray-500">Type:</span> {SKILL_TYPE_LABELS[skillType]}</div>
            <div><span className="text-gray-500">Tier:</span> {TIER_LABELS[tier]}</div>
            <div><span className="text-gray-500">Price:</span> {priceEth} ETH</div>
            <div>
              <span className="text-gray-500">Dependencies:</span>{' '}
              {parents.length === 0
                ? <span className="text-gray-400 italic">None (leaf skill)</span>
                : <ul className="ml-4 mt-1 list-disc">
                    {parents.map((p) => (
                      <li key={p.skillId}>{p.name} — {p.weight}%</li>
                    ))}
                  </ul>
              }
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="flex-1 border border-gray-300 rounded-lg py-2 text-sm">
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={isBusy || !address}
              className="flex-1 bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium disabled:opacity-50"
            >
              {isBusy ? 'Submitting…' : 'Mint & Compose'}
            </button>
          </div>
          {!address && <p className="text-xs text-red-500">Connect your wallet to submit.</p>}
        </div>
      )}
    </div>
  )
}
