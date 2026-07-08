import type { AppState, DAGNode, ValidationResult, SubCall } from './types'
import { signHeaders, myPubKey, registrySignature } from './auth'

const BASE = ''

async function json<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(BASE + url, opts)
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`)
  return data as T
}

/** POST a JSON body with an Ed25519 signature over the exact bytes sent. */
async function signedPost<T>(url: string, body: unknown): Promise<T> {
  const bodyStr = JSON.stringify(body ?? {})
  const authHeaders = await signHeaders('POST', url, bodyStr)
  return json<T>(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: bodyStr,
  })
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
  const creatorPubKey = await myPubKey()
  // Bind the HCS-26 registration to content + creator identity (verified server-side before publish).
  const { registrySignature: regSig } = await registrySignature({
    name: body.name, description: body.description, license: 'MIT',
    skillType: body.skillType, tier: body.tier, pricePerCall: body.pricePerCall,
  })
  return signedPost('/api/mint', { ...body, creatorPubKey, registrySignature: regSig, status: 'pending' })
}

export async function validateSkill(id: number): Promise<ValidationResult> {
  return signedPost(`/api/validate/${id}`, {})
}

export async function approveSkill(id: number, scores: Record<string, number>): Promise<{ success: boolean }> {
  return signedPost(`/api/approve/${id}`, { scores })
}

export async function composeSkill(childId: number, parentIds: number[], weights: number[], caller: string): Promise<{ success: boolean }> {
  return signedPost('/api/compose', { childId, parentIds, weights, caller })
}

export async function callSkill(id: number, caller: string, value: number, input: string): Promise<{
  success: boolean
  tx: Record<string, unknown>
  result: Record<string, unknown> | null
  execution: SubCall | null
  feeDistribution: Record<string, number>
}> {
  return signedPost(`/api/call/${id}`, { caller, value, input })
}

export async function withdrawBalance(user: string): Promise<{ success: boolean }> {
  return signedPost('/api/withdraw', { user })
}
