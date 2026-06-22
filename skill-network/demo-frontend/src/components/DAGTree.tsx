import type { DAGNode } from '../types'
import { tierDot } from '../lib/format'

interface Props {
  node: DAGNode
  isRoot?: boolean
}

export default function DAGTree({ node, isRoot }: Props) {
  return (
    <div className={isRoot ? '' : 'ml-6 border-l border-gray-300 pl-4 mt-1'}>
      <div className="flex items-center gap-2 py-1">
        <div className={`w-2.5 h-2.5 rounded-full ${tierDot(node.tier)}`} />
        <span className="font-medium text-sm">{node.name}</span>
        {node.weight != null && <span className="text-xs text-gray-400">[{node.weight}%]</span>}
        {node.depth != null && <span className="text-xs text-gray-300">d{node.depth}</span>}
      </div>
      {node.children?.map((child, i) => (
        <DAGTree key={`${child.id}-${i}`} node={child} />
      ))}
    </div>
  )
}
