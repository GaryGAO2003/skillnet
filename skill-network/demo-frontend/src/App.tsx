import { useState } from 'react'
import type { Skill } from './types'
import SubmitSkill from './pages/SubmitSkill'
import Validation from './pages/Validation'
import Marketplace from './pages/Marketplace'
import DAGExplorer from './pages/DAGExplorer'
import ComposeSkill from './pages/ComposeSkill'
import AgentCall from './pages/AgentCall'
import Dashboard from './pages/Dashboard'

const TABS = [
  { id: 'submit',      label: '1. Submit' },
  { id: 'validation',  label: '2. Validation' },
  { id: 'marketplace', label: '3. Marketplace' },
  { id: 'dag',         label: '4. DAG Explorer' },
  { id: 'compose',     label: '5. Compose' },
  { id: 'agent',       label: '6. Agent Call' },
  { id: 'dashboard',   label: '7. Dashboard' },
] as const

type TabId = typeof TABS[number]['id']

export default function App() {
  const [activeTab, setActiveTab] = useState<TabId>('marketplace')
  const [pendingSkillId, setPendingSkillId] = useState<number | null>(null)
  const [dagSkillId, setDagSkillId] = useState<number | null>(null)
  const [agentSkill, setAgentSkill] = useState<Skill | null>(null)

  function handleSkillSubmitted(id: number) {
    setPendingSkillId(id)
    setActiveTab('validation')
  }

  function handleLaunched() {
    setPendingSkillId(null)
    setActiveTab('marketplace')
  }

  function handleCallSkill(skill: Skill) {
    setAgentSkill(skill)
    setActiveTab('agent')
  }

  function handleViewDAG(skillId: number) {
    setDagSkillId(skillId)
    setActiveTab('dag')
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Navbar */}
      <nav className="bg-white border-b sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center h-14">
            <span className="font-bold text-lg mr-8 text-blue-700">SkillNet</span>
            <div className="flex gap-1 overflow-x-auto">
              {TABS.map(tab => (
                <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                  className={`px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
                    activeTab === tab.id
                      ? 'border-blue-600 text-blue-700 font-medium'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {activeTab === 'submit' && <SubmitSkill onSubmitted={handleSkillSubmitted} />}
        {activeTab === 'validation' && <Validation pendingSkillId={pendingSkillId} onLaunched={handleLaunched} onRevise={() => setActiveTab('submit')} />}
        {activeTab === 'marketplace' && <Marketplace onCallSkill={handleCallSkill} onViewDAG={handleViewDAG} />}
        {activeTab === 'dag' && <DAGExplorer initialSkillId={dagSkillId} />}
        {activeTab === 'compose' && <ComposeSkill onSubmitted={handleSkillSubmitted} />}
        {activeTab === 'agent' && <AgentCall preselectedSkill={agentSkill} />}
        {activeTab === 'dashboard' && <Dashboard />}
      </main>
    </div>
  )
}
