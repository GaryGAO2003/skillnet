import { scoreBg } from '../lib/format'

export default function ScoreBar({ label, value, suffix }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 w-20">{label}</span>
      <div className="flex-1 h-3 bg-gray-200 rounded-full overflow-hidden">
        <div className={`h-full rounded-full animate-progress ${scoreBg(value)}`} style={{ width: `${value}%` }} />
      </div>
      <span className="text-sm font-mono w-12 text-right">{value}{suffix || ''}</span>
    </div>
  )
}
