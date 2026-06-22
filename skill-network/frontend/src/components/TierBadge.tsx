import type { VisibilityTier } from '../types'
import { TIER_LABELS } from '../constants'

const TIER_STYLES: Record<VisibilityTier, string> = {
  0: 'bg-green-100 text-green-800 border border-green-300',
  1: 'bg-amber-100 text-amber-800 border border-amber-300',
  2: 'bg-red-100 text-red-800 border border-red-300',
}

interface TierBadgeProps {
  tier: VisibilityTier
  size?: 'sm' | 'md'
}

export function TierBadge({ tier, size = 'md' }: TierBadgeProps) {
  const sizeClass = size === 'sm' ? 'text-xs px-1.5 py-0.5' : 'text-sm px-2.5 py-1'
  return (
    <span className={`inline-flex items-center rounded-full font-medium ${sizeClass} ${TIER_STYLES[tier]}`}>
      {TIER_LABELS[tier]}
    </span>
  )
}
