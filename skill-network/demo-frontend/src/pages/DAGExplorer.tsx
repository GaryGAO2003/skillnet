import { useState, useEffect } from 'react'
import type { Skill, DAGNode } from '../types'
import { fetchState, fetchDAG } from '../api'
import DAGTree from '../components/DAGTree'
import FeeFlowPreview from '../components/FeeFlowPreview'

interface Props {
  initialSkillId?: number | null
}

export default function DAGExplorer({ initialSkillId }: Props) {
  const [skills, setSkills] = useState<Skill[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(initialSkillId ?? null)
  const [dag, setDag] = useState<DAGNode | null>(null)
  const [callPrice, setCallPrice] = useState('0.015')

  useEffect(() => {
    fetchState().then(s => setSkills(s.skills.filter(sk => sk.status === 'approved')))
  }, [])

  useEffect(() => {
    if (initialSkillId) setSelectedId(initialSkillId)
  }, [initialSkillId])

  useEffect(() => {
    if (selectedId) {
      fetchDAG(selectedId).then(setDag)
      const skill = skills.find(s => s.id === selectedId)
      if (skill) setCallPrice(String(skill.pricePerCall || 0.015))
    }
  }, [selectedId, skills])

  // Compute fee distribution preview
  function computeFees(node: DAGNode, totalValue: number): Record<string, number> {
    const result: Record<string, number> = {}
    const creatorBase = totalValue * 0.70
    const upstreamPool = totalValue * 0.20
    const protocolAmt = totalValue * 0.10
    const DEPTH_WEIGHTS = [0.50, 0.30, 0.15, 0.05]

    function walkUpstream(n: DAGNode, origPool: number, depth: number): number {
      if (!n.children?.length) return 0
      const idx = Math.min(depth - 1, 3)
      const levelPool = origPool * DEPTH_WEIGHTS[idx]
      let distributed = 0
      for (const child of n.children) {
        const share = levelPool * ((child.weight || 0) / 100)
        const key = `${child.name} (${child.creator})`
        result[key] = (result[key] || 0) + share
        distributed += share
        distributed += walkUpstream(child, origPool, depth + 1)
      }
      return distributed
    }

    const upDist = walkUpstream(node, upstreamPool, 1)
    const skill = skills.find(s => s.id === node.id)
    result[`${node.name} creator (${node.creator})`] = creatorBase + (upstreamPool - upDist)
    result['Protocol treasury'] = protocolAmt * 0.5
    result['Validator pool'] = protocolAmt * 0.3
    result['Curation pool'] = protocolAmt * 0.2

    // Re-sort: creator first, then upstream, then protocol
    const sorted: Record<string, number> = {}
    const creatorKey = `${node.name} creator (${node.creator})`
    sorted[creatorKey] = result[creatorKey]
    delete result[creatorKey]
    const protocolKeys = ['Protocol treasury', 'Validator pool', 'Curation pool']
    const upstream = Object.entries(result).filter(([k]) => !protocolKeys.includes(k)).sort((a, b) => b[1] - a[1])
    for (const [k, v] of upstream) sorted[k] = v
    for (const k of protocolKeys) if (result[k]) sorted[k] = result[k]
    return sorted
  }

  const price = parseFloat(callPrice) || 0
  const fees = dag ? computeFees(dag, price) : {}

  return (
    <div className="max-w-4xl mx-auto">
      <h2 className="text-xl font-bold mb-6">DAG Explorer</h2>

      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">Select a skill</label>
        <select value={selectedId ?? ''} onChange={e => setSelectedId(Number(e.target.value) || null)}
          className="w-full border rounded-lg px-3 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 outline-none">
          <option value="">-- Choose a skill --</option>
          {skills.map(s => <option key={s.id} value={s.id}>{s.name} ({s.tier})</option>)}
        </select>
      </div>

      {dag && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="border rounded-lg p-4 bg-white">
            <h3 className="text-sm font-semibold mb-3">Composition Tree</h3>
            <DAGTree node={dag} isRoot />
            {(!dag.children || dag.children.length === 0) && (
              <p className="text-xs text-gray-400 mt-2">This is a leaf skill with no dependencies.</p>
            )}
          </div>

          <div>
            <div className="mb-3">
              <label className="block text-xs text-gray-500 mb-1">Hypothetical call price (ETH)</label>
              <input type="number" step="0.001" min="0" value={callPrice} onChange={e => setCallPrice(e.target.value)}
                className="border rounded-lg px-3 py-2 text-sm w-40 focus:ring-2 focus:ring-blue-500 outline-none" />
            </div>
            <FeeFlowPreview distribution={fees} total={price} />
          </div>
        </div>
      )}

      {!selectedId && (
        <div className="text-center py-12 text-gray-400">Select a skill above to explore its dependency graph.</div>
      )}
    </div>
  )
}
