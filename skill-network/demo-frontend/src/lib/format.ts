export function formatETH(v: number): string {
  if (v === 0) return '0'
  if (v < 0.0001) return v.toExponential(2)
  return v.toFixed(v < 0.01 ? 5 : v < 1 ? 4 : 3)
}

export function scoreColor(score: number): string {
  if (score >= 80) return 'text-green-600'
  if (score >= 60) return 'text-amber-600'
  return 'text-red-600'
}

export function scoreBg(score: number): string {
  if (score >= 80) return 'bg-green-500'
  if (score >= 60) return 'bg-amber-500'
  return 'bg-red-500'
}

export function tierColor(tier: string): string {
  switch (tier) {
    case 'OPEN': return 'text-green-700 bg-green-100 border-green-300'
    case 'SHIELDED': return 'text-amber-700 bg-amber-100 border-amber-300'
    case 'PRIVATE': return 'text-red-700 bg-red-100 border-red-300'
    default: return 'text-gray-700 bg-gray-100 border-gray-300'
  }
}

export function tierDot(tier: string): string {
  switch (tier) {
    case 'OPEN': return 'bg-green-500'
    case 'SHIELDED': return 'bg-amber-500'
    case 'PRIVATE': return 'bg-red-500'
    default: return 'bg-gray-400'
  }
}
