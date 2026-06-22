import type { SubCall } from '../types'
import { tierDot } from '../lib/format'

function TraceNode({ call, depth }: { call: SubCall; depth: number }) {
  return (
    <div className={depth > 0 ? 'ml-5 border-l border-gray-600 pl-3 mt-0.5' : ''}>
      <div className="flex items-center gap-2 py-0.5 text-xs">
        <div className={`w-2 h-2 rounded-full ${tierDot(call.tier)}`} />
        <span className="text-gray-200">{call.name}</span>
        <span className="text-gray-500">({(call.time / 1000).toFixed(1)}s)</span>
        <span className="text-green-400">&#10003;</span>
      </div>
      {call.subCalls?.map((sc, i) => <TraceNode key={i} call={sc} depth={depth + 1} />)}
    </div>
  )
}

export default function ExecutionTrace({ trace }: { trace: SubCall }) {
  return (
    <div className="font-mono">
      <TraceNode call={trace} depth={0} />
    </div>
  )
}
