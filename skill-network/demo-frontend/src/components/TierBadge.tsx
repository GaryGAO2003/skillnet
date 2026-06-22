import { tierColor } from '../lib/format'

export default function TierBadge({ tier }: { tier: string }) {
  return (
    <span className={`inline-block px-2 py-0.5 text-xs font-semibold rounded border ${tierColor(tier)}`}>
      {tier}
    </span>
  )
}
