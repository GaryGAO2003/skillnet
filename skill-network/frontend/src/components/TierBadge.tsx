import type { VisibilityTier } from '../types'
import { TIER_LABELS } from '../constants'

// Square tier stamps: OPEN ink outline / SHIELDED warning / PRIVATE danger.
const TIER_CLASS: Record<VisibilityTier, string> = {
  0: 'stamp-open',
  1: 'stamp-shielded',
  2: 'stamp-private',
}

interface TierBadgeProps {
  tier: VisibilityTier
  size?: 'sm' | 'md'
}

export function TierBadge({ tier, size = 'md' }: TierBadgeProps) {
  const sizeClass = size === 'sm' ? 'stamp-sm' : 'stamp-md'
  return (
    <span className={`stamp ${sizeClass} ${TIER_CLASS[tier]}`}>
      {TIER_LABELS[tier]}
    </span>
  )
}
