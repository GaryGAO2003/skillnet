import { formatETH } from '../lib/format'

interface Props {
  distribution: Record<string, number>
  total: number
}

export default function FeeFlowPreview({ distribution, total }: Props) {
  const entries = Object.entries(distribution).sort((a, b) => b[1] - a[1])
  return (
    <div className="border rounded-lg p-4 bg-white">
      <h4 className="text-sm font-semibold mb-3">Fee Distribution for {formatETH(total)} ETH call</h4>
      <div className="space-y-1.5">
        {entries.map(([label, amount]) => (
          <div key={label} className="flex items-center justify-between text-xs">
            <span className="text-gray-600 truncate max-w-[70%]">{label}</span>
            <span className="font-mono text-gray-800">{formatETH(amount)} ETH</span>
          </div>
        ))}
        <div className="border-t pt-1.5 flex items-center justify-between text-xs font-semibold">
          <span>Total</span>
          <span className="font-mono">{formatETH(total)} ETH</span>
        </div>
      </div>
    </div>
  )
}
