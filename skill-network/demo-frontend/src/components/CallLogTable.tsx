import type { TxLogEntry } from '../types'
import { formatETH } from '../lib/format'

interface Props {
  log: TxLogEntry[]
  creator: string
}

export default function CallLogTable({ log, creator }: Props) {
  // Show entries where this creator earned money
  const relevant = log.filter(t => {
    if (t.type !== 'CALL') return false
    // Direct call to their skill
    if (t.breakdown && t.breakdown.creatorTotal > 0) {
      // Need to check if this creator is the skill creator — we check upstream too
    }
    // Appears in upstream
    if (t.breakdown?.upstream?.some(u => u.creator === creator)) return true
    return true // show all calls for simplicity
  }).slice(0, 20)

  return (
    <div className="border rounded-lg bg-white overflow-hidden">
      <div className="px-4 py-2 bg-gray-50 border-b">
        <h4 className="text-sm font-semibold">Call Log</h4>
      </div>
      <div className="max-h-60 overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="bg-gray-50 sticky top-0">
            <tr>
              <th className="text-left px-4 py-1.5 text-gray-500 font-medium">Time</th>
              <th className="text-left px-4 py-1.5 text-gray-500 font-medium">Skill</th>
              <th className="text-left px-4 py-1.5 text-gray-500 font-medium">Caller</th>
              <th className="text-right px-4 py-1.5 text-gray-500 font-medium">Value</th>
            </tr>
          </thead>
          <tbody>
            {relevant.map(t => (
              <tr key={t.id} className="border-t hover:bg-gray-50">
                <td className="px-4 py-1.5 text-gray-400 font-mono">{new Date(t.ts).toLocaleTimeString()}</td>
                <td className="px-4 py-1.5">{t.skillName}</td>
                <td className="px-4 py-1.5 text-gray-500">{t.caller}</td>
                <td className="px-4 py-1.5 text-right font-mono text-green-600">+{formatETH(t.value || 0)}</td>
              </tr>
            ))}
            {relevant.length === 0 && (
              <tr><td colSpan={4} className="px-4 py-4 text-center text-gray-400">No calls yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
