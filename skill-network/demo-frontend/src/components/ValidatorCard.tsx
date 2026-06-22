import type { ValidatorReport } from '../types'
import ScoreBar from './ScoreBar'

interface Props {
  validator: ValidatorReport
  progress: number // 0-100
  revealed: boolean
  delay: number
}

export default function ValidatorCard({ validator, progress, revealed, delay }: Props) {
  const status = progress >= 100 ? 'Done' : progress > 0 ? 'Testing...' : 'Waiting'
  return (
    <div className="border rounded-lg p-4 bg-white animate-fade-in" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex items-center justify-between mb-3">
        <div>
          <span className="font-semibold text-sm">{validator.nodeId}</span>
          <span className="ml-2 text-xs text-gray-400">Stake: {validator.stake} ETH</span>
        </div>
        <span className={`text-xs font-medium px-2 py-0.5 rounded ${
          status === 'Done' ? 'bg-green-100 text-green-700' : status === 'Testing...' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
        }`}>{status}</span>
      </div>
      <div className="w-full h-2 bg-gray-200 rounded-full mb-3 overflow-hidden">
        <div className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-out" style={{ width: `${progress}%` }} />
      </div>
      {revealed ? (
        <div className="space-y-1.5">
          <ScoreBar label="Schema" value={validator.scores.schema} />
          <ScoreBar label="Discover" value={validator.scores.discover} />
          <ScoreBar label="Callable" value={validator.scores.callable} />
          <ScoreBar label="Success" value={validator.scores.success} suffix="%" />
          <ScoreBar label="Rank" value={validator.scores.percentile} suffix="th" />
        </div>
      ) : (
        <div className="space-y-1.5">
          {['Schema', 'Discover', 'Callable', 'Success', 'Rank'].map(l => (
            <div key={l} className="flex items-center gap-2">
              <span className="text-xs text-gray-500 w-20">{l}</span>
              <div className="flex-1 h-3 bg-gray-100 rounded-full" />
              <span className="text-sm font-mono w-12 text-right text-gray-300">--</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
