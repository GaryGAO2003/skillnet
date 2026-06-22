const TIERS = [
  { value: 'OPEN', label: 'OPEN', color: 'border-green-500 bg-green-50 text-green-800', ring: 'ring-green-500', desc: 'Fully public. Anyone can see, call, and compose. Revenue from composition royalties.' },
  { value: 'SHIELDED', label: 'SHIELDED', color: 'border-amber-500 bg-amber-50 text-amber-800', ring: 'ring-amber-500', desc: 'Schema public, implementation private (TEE). Pay-per-call revenue model.' },
  { value: 'PRIVATE', label: 'PRIVATE', color: 'border-red-500 bg-red-50 text-red-800', ring: 'ring-red-500', desc: 'Schema public, access restricted. License required. Enterprise pricing.' },
] as const

interface Props {
  value: string
  onChange: (v: string) => void
}

export default function TierSelector({ value, onChange }: Props) {
  const selected = TIERS.find(t => t.value === value) || TIERS[0]
  return (
    <div>
      <div className="flex gap-3">
        {TIERS.map(t => (
          <button key={t.value} type="button" onClick={() => onChange(t.value)}
            className={`px-4 py-2 rounded-lg border-2 font-semibold text-sm transition-all ${
              value === t.value ? `${t.color} ring-2 ${t.ring}` : 'border-gray-200 bg-white text-gray-500 hover:border-gray-300'
            }`}>
            {t.label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-sm text-gray-600">{selected.desc}</p>
    </div>
  )
}
