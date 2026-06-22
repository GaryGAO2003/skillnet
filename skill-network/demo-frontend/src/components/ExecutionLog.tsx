interface Step {
  label: string
  detail?: string
  time?: string
  status: 'done' | 'loading' | 'pending'
}

export default function ExecutionLog({ steps }: { steps: Step[] }) {
  return (
    <div className="border rounded-lg p-4 bg-gray-900 text-gray-100 font-mono text-xs space-y-1.5">
      {steps.map((s, i) => (
        <div key={i} className={`flex items-start gap-2 ${s.status === 'pending' ? 'opacity-30' : 'animate-fade-in'}`}
          style={{ animationDelay: `${i * 200}ms` }}>
          <span className="w-4 text-center">
            {s.status === 'done' ? <span className="text-green-400">&#10003;</span>
              : s.status === 'loading' ? <span className="text-blue-400 animate-pulse">&#9696;</span>
              : <span className="text-gray-600">&#9675;</span>}
          </span>
          <span className="flex-1">
            {s.label}
            {s.detail && <span className="text-gray-500 ml-2">{s.detail}</span>}
          </span>
          {s.time && <span className="text-gray-500">({s.time})</span>}
        </div>
      ))}
    </div>
  )
}
