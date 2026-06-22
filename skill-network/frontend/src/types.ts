export type VisibilityTier = 0 | 1 | 2   // OPEN | SHIELDED | PRIVATE
export type SkillType = 0 | 1 | 2 | 3 | 4 | 5 | 6

export interface SkillMetadata {
  name: string
  description: string
  skillType: SkillType
  tier: VisibilityTier
  contentHash: `0x${string}`
  schemaURI: string
  pricePerCall: bigint
  creator: `0x${string}`
  version: bigint
  previousVersion: bigint
  totalCalls: bigint
  totalRevenue: bigint
  createdAt: bigint
}

export interface CompositionEdge {
  parentSkillId: bigint
  weight: bigint
}

export interface SkillWithId extends SkillMetadata {
  tokenId: number
}
