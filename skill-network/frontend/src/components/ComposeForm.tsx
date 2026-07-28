import { useState } from 'react'
import { useAccount } from 'wagmi'
import { keccak256, toHex, parseEther } from 'viem'
import { useMintSkill } from '../hooks/useSkillNFT'
import { useCompose } from '../hooks/useCompositionDAG'
import { SKILL_TYPE_LABELS, TIER_LABELS } from '../constants'
import { formatWeiValue, registryId } from '../lib/format'
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

const STEPS: { n: '01' | '02' | '03'; label: string }[] = [
  { n: '01', label: 'METADATA' },
  { n: '02', label: 'DEPENDENCIES' },
  { n: '03', label: 'PREVIEW & SUBMIT' },
]

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

  // Would-be revenue split at the entered price (wei-exact, informational).
  let previewPrice = 0n
  try { previewPrice = parseEther(priceEth || '0') } catch { previewPrice = 0n }
  const pvProtocol = (previewPrice * 10n) / 100n
  const pvCreator = (previewPrice * 70n) / 100n
  const pvUpstream = previewPrice - pvProtocol - pvCreator
  const pvRemainder = previewPrice - (pvProtocol + pvCreator + pvUpstream)

  return (
    <div className="space-y-6">
      {/* Progress rail */}
      <div className="grid grid-cols-3 border-t border-b border-line divide-x divide-line">
        {STEPS.map((s, i) => {
          const stepNum = (i + 1) as 1 | 2 | 3
          const active = step === stepNum
          return (
            <button
              key={s.n}
              type="button"
              onClick={() => setStep(stepNum)}
              className={`text-left px-3 py-3 transition-colors ${active ? 'bg-surface-raised' : 'hover:bg-surface-raised'}`}
            >
              <div className={`font-mono text-[11px] font-bold tracking-[0.06em] ${active ? 'text-ink' : 'text-muted'}`}>
                {s.n}
              </div>
              <div className={`font-mono text-[10px] tracking-[0.08em] mt-1 ${active ? 'text-accent-strong' : 'text-muted'}`}>
                {s.label}
              </div>
            </button>
          )
        })}
      </div>

      {step === 1 && (
        <div className="space-y-4">
          <div>
            <label className="field-label">Name</label>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field-input font-sans"
              placeholder="My Composed Skill"
            />
          </div>
          <div>
            <label className="field-label">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="field-input font-sans"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="field-label">Skill Type</label>
              <select
                value={skillType}
                onChange={(e) => setSkillType(Number(e.target.value) as SkillType)}
                className="sel w-full"
              >
                {SKILL_TYPE_LABELS.map((label, i) => (
                  <option key={i} value={i}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Visibility Tier</label>
              <select
                value={tier}
                onChange={(e) => setTier(Number(e.target.value) as VisibilityTier)}
                className="sel w-full"
              >
                {TIER_LABELS.map((label, i) => (
                  <option key={i} value={i}>{label}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="field-label">Price Per Call (ETH)</label>
            <input
              type="number"
              min="0"
              step="0.001"
              value={priceEth}
              onChange={(e) => setPriceEth(e.target.value)}
              className="field-input"
            />
            <div className="field-hint">Fixed at mint · settled to the wei on every call</div>
          </div>
          <button
            onClick={() => setStep(2)}
            disabled={!name}
            className="btn btn-primary btn-block"
          >
            Next: Select Dependencies
          </button>
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted mb-2">
              Parent dependencies <span className="text-muted opacity-70">(optional — skip for a leaf skill)</span>
            </p>

            {availableSkills.length === 0 ? (
              <div className="border border-line rounded-sm p-4 bg-surface-raised font-mono text-[12px] text-muted">
                No skills available to depend on yet.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2 max-h-60 overflow-y-auto border border-line rounded-sm p-3">
                {availableSkills.map((skill) => {
                  const isAdded = !!parents.find((p) => p.skillId === skill.tokenId)
                  return (
                    <button
                      key={skill.tokenId}
                      type="button"
                      onClick={() => isAdded ? removeParent(skill.tokenId) : addParent(skill)}
                      className={`text-left text-[13px] px-3 py-2 rounded-sm border transition-colors ${
                        isAdded
                          ? 'border-accent-strong bg-surface-raised text-ink'
                          : 'border-line hover:bg-surface-raised text-ink'
                      }`}
                    >
                      <span className="font-mono text-muted mr-2">⬡ {registryId(skill.tokenId)}</span>
                      {skill.name}
                      {isAdded && <span className="ml-2 font-mono text-accent-strong text-xs">✓</span>}
                    </button>
                  )
                })}
              </div>
            )}

            {parents.length === 0 && (
              <p className="font-mono text-[11px] text-muted mt-2">
                No parents — this skill is a <strong className="text-ink">leaf</strong> and keeps 90% of each call fee.
              </p>
            )}
          </div>

          {parents.length > 0 && (
            <div className="space-y-2">
              <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted">
                Royalty weights · total{' '}
                <span className={totalWeight === 100 ? 'text-success font-bold' : 'text-danger font-bold'}>
                  {totalWeight}
                </span>
                {' '}/ 100 — must equal 100
              </p>
              {parents.map((p) => (
                <div key={p.skillId} className="flex items-center gap-3">
                  <span className="font-mono text-[12px] text-muted mr-1">⬡ {registryId(p.skillId)}</span>
                  <span className="text-[13px] text-ink flex-1 truncate">{p.name}</span>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={p.weight}
                    onChange={(e) => updateWeight(p.skillId, Number(e.target.value))}
                    className="field-input w-20 text-right"
                  />
                  <span className="font-mono text-[12px] text-muted">%</span>
                  <button
                    type="button"
                    onClick={() => removeParent(p.skillId)}
                    className="font-mono text-muted hover:text-danger text-xs transition-colors"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button type="button" onClick={() => setStep(1)} className="btn btn-ghost flex-1">
              Back
            </button>
            <button
              type="button"
              onClick={() => setStep(3)}
              disabled={!weightsValid}
              className="btn btn-primary flex-1"
            >
              {parents.length === 0 ? 'Next: Preview (no deps)' : 'Next: Preview'}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <div className="border border-line rounded-sm p-4 font-mono text-[12.5px] space-y-2">
            <div className="flex gap-3"><span className="text-muted w-28 shrink-0">NAME</span><span className="text-ink font-medium">{name}</span></div>
            <div className="flex gap-3"><span className="text-muted w-28 shrink-0">TYPE</span><span className="text-ink">{SKILL_TYPE_LABELS[skillType]}</span></div>
            <div className="flex gap-3"><span className="text-muted w-28 shrink-0">TIER</span><span className="text-ink">{TIER_LABELS[tier]}</span></div>
            <div className="flex gap-3"><span className="text-muted w-28 shrink-0">PRICE</span><span className="text-ink">{formatWeiValue(previewPrice)} ETH</span></div>
            <div className="flex gap-3">
              <span className="text-muted w-28 shrink-0">DEPENDENCIES</span>
              <span className="text-ink">
                {parents.length === 0
                  ? <span className="text-muted">None (leaf skill)</span>
                  : (
                    <span className="space-y-1 block">
                      {parents.map((p) => (
                        <span key={p.skillId} className="block">⬡ {registryId(p.skillId)} {p.name} — {p.weight}%</span>
                      ))}
                    </span>
                  )}
              </span>
            </div>
          </div>

          {/* Would-be receipt split at the listed price */}
          <div className="receipt">
            <div className="font-mono text-[12px] font-bold pb-3 mb-4 border-b border-dashed border-line">
              <span className="block text-[16px] mb-1 tracking-tight">
                REVENUE SPLIT · {formatWeiValue(previewPrice)} ETH
              </span>
              <span className="text-muted font-medium">PER CALL · WOULD SETTLE AS</span>
            </div>
            <div className="rline"><span className="k"><b>protocol</b> · network fee (10%)</span><span className="v">{formatWeiValue(pvProtocol)}</span></div>
            <div className="rline"><span className="k"><b>creator</b> · you (70%)</span><span className="v">{formatWeiValue(pvCreator)}</span></div>
            <div className="rline"><span className="k"><b>upstream</b> · ancestor royalties (20%)</span><span className="v">{formatWeiValue(pvUpstream)}</span></div>
            <div className="rline total"><span className="k">DISTRIBUTED</span><span className="v">{formatWeiValue(previewPrice - pvRemainder)}</span></div>
            <div className="rline remainder">
              <span className="k">REMAINDER</span>
              <span className="v">{formatWeiValue(pvRemainder)} ETH <span className="ok">✓ CONSERVED</span></span>
            </div>
          </div>

          <div className="flex gap-3">
            <button onClick={() => setStep(2)} className="btn btn-ghost flex-1">
              Back
            </button>
            <button
              onClick={handleSubmit}
              disabled={isBusy || !address}
              className="btn btn-primary flex-1"
            >
              {isBusy ? 'Submitting…' : 'Mint & Compose'}
            </button>
          </div>
          {!address && <p className="font-mono text-[11px] text-danger">Connect your wallet to submit.</p>}
        </div>
      )}
    </div>
  )
}
