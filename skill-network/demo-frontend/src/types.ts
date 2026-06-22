export interface Scores {
  schema: number
  discover: number
  callable: number
  success: number
  percentile: number
}

export interface Skill {
  id: number
  name: string
  description: string
  skillType: string
  tier: 'OPEN' | 'SHIELDED' | 'PRIVATE'
  pricePerCall: number
  creator: string
  version: number
  previousVersion: number
  totalCalls: number
  totalRevenue: number
  createdAt: string
  status: 'pending' | 'approved' | 'rejected'
  scores: Scores | null
  hcs26_uid?: number
}

export interface ValidatorReport {
  nodeId: string
  stake: number
  scores: Scores
}

export interface Consensus {
  schema: number
  discover: number
  callable: number
  success: number
  percentile: number
  composite: number
  approved: boolean
  maxDeviation: number
}

export interface ValidationResult {
  validators: ValidatorReport[]
  consensus: Consensus
  diagnostic: {
    testScenario: string
    suggestion: string
    responseTime: string
  }
}

export interface DAGNode {
  id: number
  name: string
  tier: string
  creator: string
  depth: number
  weight?: number
  children: DAGNode[]
}

export interface SubCall {
  skillId: number
  name: string
  tier: string
  time: number
  subCalls?: SubCall[]
}

export interface TxLogEntry {
  id: number
  ts: string
  type: 'CALL' | 'WITHDRAW'
  skillId?: number
  skillName?: string
  caller?: string
  value?: number
  user?: string
  amount?: number
  breakdown?: {
    protocol: number
    creatorTotal: number
    upstream: { skillId: number; skillName: string; creator: string; amount: number; depth: number }[]
  }
}

export interface AppState {
  skills: Skill[]
  balances: Record<string, number>
  txLog: TxLogEntry[]
}

export const SKILL_TYPES = [
  'PROMPT_WORKFLOW',
  'TOOL_ADAPTER',
  'AGENT_BEHAVIOR',
  'EVAL_PIPELINE',
  'LORA_ADAPTER',
  'DATASET',
  'COMPOSITE_BUNDLE',
] as const

export const SKILL_TYPE_LABELS: Record<string, string> = {
  PROMPT_WORKFLOW: 'Prompt Workflow',
  TOOL_ADAPTER: 'Tool Adapter',
  AGENT_BEHAVIOR: 'Agent Behavior',
  EVAL_PIPELINE: 'Eval Pipeline',
  LORA_ADAPTER: 'LoRA Adapter',
  DATASET: 'Dataset',
  COMPOSITE_BUNDLE: 'Composite Bundle',
}

export const CREATORS = ['alice', 'bob', 'carol', 'dave', 'eve'] as const
