import type { AppState, DAGNode, ValidationResult, SubCall } from './types'

const BASE = ''

async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, opts)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

export async function fetchState(): Promise<AppState> {
  return json('/api/state')
}

export async function fetchDAG(id: number): Promise<DAGNode> {
  return json(`/api/dag/${id}`)
}

export async function mintSkill(body: {
  name: string
  description: string
  skillType: string
  tier: string
  pricePerCall: number
  creator: string
}): Promise<{ success: boolean; id: number }> {
  return json('/api/mint', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, status: 'pending' }),
  })
}

export async function validateSkill(id: number): Promise<ValidationResult> {
  return json(`/api/validate/${id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
}

export async function approveSkill(id: number, scores: Record<string, number>): Promise<{ success: boolean }> {
  return json(`/api/approve/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scores }),
  })
}

export async function composeSkill(childId: number, parentIds: number[], weights: number[], caller: string): Promise<{ success: boolean }> {
  return json('/api/compose', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ childId, parentIds, weights, caller }),
  })
}

export async function callSkill(id: number, caller: string, value: number, input: string): Promise<{
  success: boolean
  tx: Record<string, unknown>
  result: Record<string, unknown> | null
  execution: SubCall | null
  feeDistribution: Record<string, number>
}> {
  return json(`/api/call/${id}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caller, value, input }),
  })
}

export async function withdrawBalance(user: string): Promise<{ success: boolean }> {
  return json('/api/withdraw', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ user }),
  })
}
