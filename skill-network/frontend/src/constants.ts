export const SKILL_NFT_ADDRESS = (import.meta.env.VITE_SKILL_NFT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`
export const DAG_ADDRESS = (import.meta.env.VITE_COMPOSITION_DAG_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`
export const FEE_ROUTER_ADDRESS = (import.meta.env.VITE_FEE_ROUTER_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`
export const SETTLEMENT_VAULT_ADDRESS = (import.meta.env.VITE_SETTLEMENT_VAULT_ADDRESS || '0x0000000000000000000000000000000000000000') as `0x${string}`

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as `0x${string}`

// Hedera public mirror node (testnet) — keyless, CORS-open REST API (origin only;
// paths are built as `${MIRROR_BASE}/api/v1/...` and mirror `links.next` is prefixed
// with this same origin since it already carries the `/api/v1` path).
export const MIRROR_BASE = 'https://testnet.mirrornode.hedera.com'
// HCS-26 discovery registry topic — every `register` message's sequence_number is a skill_uid.
export const DISCOVERY_TOPIC = '0.0.8599076'

export const TIER_LABELS = ['OPEN', 'SHIELDED', 'PRIVATE'] as const
export const SKILL_TYPE_LABELS = [
  'PROMPT_WORKFLOW',
  'TOOL_ADAPTER',
  'AGENT_BEHAVIOR',
  'EVAL_PIPELINE',
  'LORA_ADAPTER',
  'DATASET',
  'COMPOSITE_BUNDLE',
] as const
