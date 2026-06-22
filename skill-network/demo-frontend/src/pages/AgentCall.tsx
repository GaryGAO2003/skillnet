import { useState, useEffect } from 'react'
import type { Skill, SubCall } from '../types'
import { fetchState, callSkill } from '../api'
import AgentProfileCard from '../components/AgentProfileCard'
import ExecutionLog from '../components/ExecutionLog'
import ExecutionTrace from '../components/ExecutionTrace'
import FeeFlowPreview from '../components/FeeFlowPreview'
import { formatETH } from '../lib/format'

interface Props {
  preselectedSkill?: Skill | null
}

export default function AgentCall({ preselectedSkill }: Props) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(preselectedSkill?.id ?? null)
  const [input, setInput] = useState('')
  const [executing, setExecuting] = useState(false)
  const [steps, setSteps] = useState<{ label: string; detail?: string; time?: string; status: 'done' | 'loading' | 'pending' }[]>([])
  const [result, setResult] = useState<Record<string, unknown> | null>(null)
  const [trace, setTrace] = useState<SubCall | null>(null)
  const [fees, setFees] = useState<Record<string, number>>({})

  useEffect(() => {
    fetchState().then(s => setSkills(s.skills.filter(sk => sk.status === 'approved')))
  }, [])

  useEffect(() => {
    if (preselectedSkill) setSelectedId(preselectedSkill.id)
  }, [preselectedSkill])

  const skill = skills.find(s => s.id === selectedId)

  async function execute() {
    if (!skill || !input.trim()) return
    setExecuting(true)
    setResult(null)
    setTrace(null)
    setFees({})

    // Step 1-3: quick local steps
    const mkSteps = (overrides: Partial<typeof steps[0]>[]) =>
      overrides.map((o, i) => ({ label: '', status: 'pending' as const, ...o }))

    setSteps([
      { label: '1. Discovered skill from registry', time: '12ms', status: 'done' },
      { label: `2. Verified quality score: ${skill.scores ? Math.round((skill.scores.schema + skill.scores.discover + skill.scores.callable + skill.scores.success + skill.scores.percentile) / 5) : '?'}/100`, time: '1ms', status: 'done' },
      { label: `3. Payment: ${formatETH(skill.pricePerCall)} ETH deducted`, time: '1ms', status: 'done' },
      { label: '4. Executing via LLM...', status: 'loading' },
      { label: '5. Result received', status: 'pending' },
      { label: '6. Fee distributed', status: 'pending' },
    ])

    await new Promise(r => setTimeout(r, 300))

    try {
      const res = await callSkill(skill.id, 'agent-bot', skill.pricePerCall, input.trim())

      // Step 4 done
      setSteps(prev => prev.map((s, i) =>
        i === 3 ? { ...s, status: 'done' as const, time: res.execution ? `${(res.execution.time / 1000).toFixed(1)}s` : '2.1s' }
        : i === 4 ? { ...s, status: 'done' as const, time: `${((res.execution?.time || 2000) / 1000 + 0.1).toFixed(1)}s` }
        : i === 5 ? { ...s, status: 'done' as const, label: `6. Fee distributed to ${Object.keys(res.feeDistribution).length} recipients`, time: '1ms' }
        : s
      ))

      setResult(res.result)
      setTrace(res.execution)
      setFees(res.feeDistribution)
    } catch (err) {
      setSteps(prev => prev.map((s, i) =>
        i === 3 ? { ...s, status: 'done' as const, label: '4. Error: ' + (err instanceof Error ? err.message : 'Unknown error') } : s
      ))
    } finally {
      setExecuting(false)
    }
  }

  return (
    <div className="max-w-5xl mx-auto">
      <h2 className="text-xl font-bold mb-6">Agent Execution</h2>

      <AgentProfileCard />

      <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="md:col-span-2">
          <label className="block text-sm font-medium text-gray-700 mb-1">Select skill</label>
          <select value={selectedId ?? ''} onChange={e => setSelectedId(Number(e.target.value) || null)}
            className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
            <option value="">-- Choose a skill --</option>
            {skills.map(s => <option key={s.id} value={s.id}>{s.name} ({s.tier}, {formatETH(s.pricePerCall)} ETH)</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">&nbsp;</label>
          <button onClick={execute} disabled={!skill || !input.trim() || executing}
            className="w-full py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors disabled:opacity-50">
            {executing ? 'Executing...' : 'Execute Skill \u2192'}
          </button>
        </div>
      </div>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">Input</label>
        <textarea value={input} onChange={e => setInput(e.target.value)} rows={2}
          placeholder="e.g. Analyze Uniswap V3 for security issues"
          className="w-full border rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 outline-none" />
      </div>

      {steps.length > 0 && (
        <div className="mb-6">
          <ExecutionLog steps={steps} />
          {trace && trace.subCalls && trace.subCalls.length > 0 && (
            <div className="mt-2 border rounded-lg p-4 bg-gray-900">
              <div className="text-xs text-gray-400 mb-2 font-mono">Sub-call trace:</div>
              <ExecutionTrace trace={trace} />
            </div>
          )}
        </div>
      )}

      {(result || Object.keys(fees).length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {result && (
            <div className="border rounded-lg p-4 bg-white">
              <h4 className="text-sm font-semibold mb-2">Result</h4>
              <pre className="text-xs bg-gray-50 rounded p-3 overflow-auto max-h-80 whitespace-pre-wrap font-mono">
                {JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
          {Object.keys(fees).length > 0 && skill && (
            <FeeFlowPreview distribution={fees} total={skill.pricePerCall} />
          )}
        </div>
      )}
    </div>
  )
}
