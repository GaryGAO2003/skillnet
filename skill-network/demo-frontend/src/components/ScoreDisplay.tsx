import { scoreColor } from '../lib/format'
import type { Scores } from '../types'

export default function ScoreDisplay({ scores, compact }: { scores: Scores; compact?: boolean }) {
  if (compact) {
    return (
      <div className="flex gap-2 text-xs font-mono">
        <span className={scoreColor(scores.schema)}>S:{scores.schema}</span>
        <span className={scoreColor(scores.discover)}>D:{scores.discover}</span>
        <span className={scoreColor(scores.callable)}>C:{scores.callable}</span>
        <span className={scoreColor(scores.success)}>R:{scores.success}%</span>
        <span className={scoreColor(scores.percentile)}>P:{scores.percentile}th</span>
      </div>
    )
  }

  const dims = [
    { label: 'Schema', value: scores.schema },
    { label: 'Discover', value: scores.discover },
    { label: 'Callable', value: scores.callable },
    { label: 'Success', value: scores.success, suffix: '%' },
    { label: 'Rank', value: scores.percentile, suffix: 'th' },
  ]

  return (
    <div className="space-y-1.5">
      {dims.map(d => (
        <div key={d.label} className="flex items-center gap-2">
          <span className="text-xs text-gray-500 w-16">{d.label}</span>
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${
              d.value >= 80 ? 'bg-green-500' : d.value >= 60 ? 'bg-amber-500' : 'bg-red-500'
            }`} style={{ width: `${d.value}%` }} />
          </div>
          <span className={`text-xs font-mono w-10 text-right ${scoreColor(d.value)}`}>
            {d.value}{d.suffix || ''}
          </span>
        </div>
      ))}
    </div>
  )
}
