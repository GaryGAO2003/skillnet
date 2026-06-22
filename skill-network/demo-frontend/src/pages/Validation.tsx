import { useState, useEffect, useCallback } from 'react'
import type { Skill, ValidationResult } from '../types'
import { fetchState, validateSkill, approveSkill } from '../api'
import TierBadge from '../components/TierBadge'
import ValidatorCard from '../components/ValidatorCard'
import ConsensusPanel from '../components/ConsensusPanel'
import { SKILL_TYPE_LABELS } from '../types'

interface Props {
  pendingSkillId: number | null
  onLaunched: () => void
  onRevise: () => void
}

export default function Validation({ pendingSkillId, onLaunched, onRevise }: Props) {
  const [skill, setSkill] = useState<Skill | null>(null)
  const [pendingSkills, setPendingSkills] = useState<Skill[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(pendingSkillId)
  const [result, setResult] = useState<ValidationResult | null>(null)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState([0, 0, 0])
  const [revealed, setRevealed] = useState([false, false, false])
  const [showConsensus, setShowConsensus] = useState(false)
  const [showDiagnostic, setShowDiagnostic] = useState(false)

  const loadPending = useCallback(async () => {
    const state = await fetchState()
    const pending = state.skills.filter(s => s.status === 'pending')
    setPendingSkills(pending)
    const id = selectedId ?? pendingSkillId
    if (id) {
      const s = state.skills.find(sk => sk.id === id) || null
      setSkill(s)
    }
  }, [selectedId, pendingSkillId])

  useEffect(() => { loadPending() }, [loadPending])

  useEffect(() => {
    if (pendingSkillId) setSelectedId(pendingSkillId)
  }, [pendingSkillId])

  function selectSkill(id: number) {
    setSelectedId(id)
    setResult(null)
    setProgress([0, 0, 0])
    setRevealed([false, false, false])
    setShowConsensus(false)
    const s = pendingSkills.find(sk => sk.id === id) || null
    setSkill(s)
  }

  async function startValidation() {
    if (!selectedId) return
    setRunning(true)
    setResult(null)
    setProgress([0, 0, 0])
    setRevealed([false, false, false])
    setShowConsensus(false)

    const res = await validateSkill(selectedId)
    setResult(res)

    // Staggered animation: validator 2 finishes first, then 0, then 1
    const order = [2, 0, 1]
    for (let step = 0; step < 3; step++) {
      const idx = order[step]
      const duration = 1500 + step * 1800
      // Animate progress
      const start = Date.now()
      const animate = () => {
        const elapsed = Date.now() - start
        const pct = Math.min(100, (elapsed / duration) * 100)
        setProgress(prev => { const next = [...prev]; next[idx] = pct; return next })
        if (pct < 100) requestAnimationFrame(animate)
        else setRevealed(prev => { const next = [...prev]; next[idx] = true; return next })
      }
      animate()
      await new Promise(r => setTimeout(r, duration + 300))
    }

    // Show consensus after all validators complete
    await new Promise(r => setTimeout(r, 500))
    setShowConsensus(true)
    setRunning(false)
  }

  async function handleLaunch() {
    if (!selectedId || !result) return
    const { schema, discover, callable, success, percentile } = result.consensus
    await approveSkill(selectedId, { schema, discover, callable, success, percentile })
    onLaunched()
  }

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl font-bold mb-6">Skill Validation</h2>

      {/* Pending skill selector */}
      {pendingSkills.length > 0 && !skill && (
        <div className="mb-6">
          <p className="text-sm text-gray-500 mb-3">Select a pending skill to validate:</p>
          <div className="space-y-2">
            {pendingSkills.map(s => (
              <button key={s.id} onClick={() => selectSkill(s.id)}
                className="w-full text-left border rounded-lg p-3 hover:bg-blue-50 transition-colors">
                <span className="font-medium">{s.name}</span>
                <span className="ml-2 text-xs text-gray-400">{SKILL_TYPE_LABELS[s.skillType]}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {pendingSkills.length === 0 && !skill && (
        <div className="text-center py-12 text-gray-400">
          <p>No skills pending validation.</p>
          <p className="text-sm mt-1">Submit a new skill from the Submit tab to get started.</p>
        </div>
      )}

      {/* Selected skill card */}
      {skill && (
        <>
          <div className="border rounded-lg p-4 bg-white mb-6">
            <div className="flex items-center gap-3">
              <TierBadge tier={skill.tier} />
              <span className="font-semibold">{skill.name}</span>
              <span className="text-xs text-gray-400">{SKILL_TYPE_LABELS[skill.skillType]}</span>
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Price: {skill.pricePerCall} ETH &middot; Creator: {skill.creator}
            </div>
          </div>

          {!result && !running && (
            <button onClick={startValidation}
              className="w-full py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
              Start Validation
            </button>
          )}

          {(running || result) && (
            <>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
                {(result?.validators || [{nodeId:'node-alpha',stake:0.1,scores:{schema:0,discover:0,callable:0,success:0,percentile:0}},{nodeId:'node-beta',stake:0.1,scores:{schema:0,discover:0,callable:0,success:0,percentile:0}},{nodeId:'node-gamma',stake:0.1,scores:{schema:0,discover:0,callable:0,success:0,percentile:0}}]).map((v, i) => (
                  <ValidatorCard key={i} validator={v} progress={progress[i]} revealed={revealed[i]} delay={i * 200} />
                ))}
              </div>

              {showConsensus && result && (
                <div className="mb-6">
                  <ConsensusPanel consensus={result.consensus} onLaunch={handleLaunch} onRevise={onRevise} />
                </div>
              )}

              {showConsensus && result && (
                <div className="mb-6">
                  <button onClick={() => setShowDiagnostic(!showDiagnostic)}
                    className="text-sm text-blue-600 hover:underline">
                    {showDiagnostic ? 'Hide' : 'Show'} Diagnostic Details
                  </button>
                  {showDiagnostic && (
                    <div className="mt-2 border rounded-lg p-4 bg-gray-50 text-sm space-y-1 animate-fade-in">
                      <p><span className="text-gray-500">Test scenario:</span> {result.diagnostic.testScenario}</p>
                      <p><span className="text-gray-500">Response time:</span> {result.diagnostic.responseTime}</p>
                      <p><span className="text-gray-500">Suggestion:</span> {result.diagnostic.suggestion}</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
