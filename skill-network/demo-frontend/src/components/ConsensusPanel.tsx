import type { Consensus } from '../types'
import ScoreBar from './ScoreBar'

interface Props {
  consensus: Consensus
  onLaunch?: () => void
  onRevise?: () => void
}

export default function ConsensusPanel({ consensus, onLaunch, onRevise }: Props) {
  return (
    <div className={`border-2 rounded-lg p-5 animate-fade-in ${
      consensus.approved ? 'border-green-400 bg-green-50' : 'border-red-400 bg-red-50'
    }`}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <span className={`text-lg font-bold ${consensus.approved ? 'text-green-700' : 'text-red-700'}`}>
            {consensus.approved ? 'APPROVED' : 'REJECTED'}
          </span>
          {consensus.approved && <span className="ml-2 text-green-600">&#10003;</span>}
        </div>
        <span className="text-2xl font-bold text-gray-800">{consensus.composite}/100</span>
      </div>
      <div className="space-y-1.5 mb-4">
        <ScoreBar label="Schema" value={consensus.schema} />
        <ScoreBar label="Discover" value={consensus.discover} />
        <ScoreBar label="Callable" value={consensus.callable} />
        <ScoreBar label="Success" value={consensus.success} suffix="%" />
        <ScoreBar label="Rank" value={consensus.percentile} suffix="th" />
      </div>
      <p className="text-xs text-gray-500 mb-4">
        Validator agreement: {consensus.maxDeviation <= 10 ? 'High' : consensus.maxDeviation <= 20 ? 'Moderate' : 'Low'}
        {' '}(max deviation: {consensus.maxDeviation}pts)
      </p>
      {consensus.approved && onLaunch && (
        <button onClick={onLaunch} className="w-full py-2.5 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
          Launch to Marketplace &rarr;
        </button>
      )}
      {!consensus.approved && onRevise && (
        <button onClick={onRevise} className="w-full py-2.5 bg-gray-600 text-white rounded-lg font-semibold hover:bg-gray-700 transition-colors">
          Revise and Resubmit &rarr;
        </button>
      )}
    </div>
  )
}
