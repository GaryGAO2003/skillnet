// The Exact Ledger — money formatting.
// Money is always full precision, tabular, never rounded away.
// wei (bigint) -> "0.015000" (>= 6 decimals; more digits if sub-6 precision exists, never fewer).

const WEI_PER_ETH = 1_000_000_000_000_000_000n // 1e18
const MIN_DECIMALS = 6

/**
 * Format a wei amount (bigint) as a full-precision ETH decimal string.
 * Always shows at least 6 decimals; if finer precision exists it shows more
 * digits (never rounds it away), but trailing zeros beyond 6 are trimmed to
 * keep the fixed-width ledger feel. Returns the number only, e.g. "0.015000".
 */
export function formatWeiValue(wei: bigint): string {
  const negative = wei < 0n
  const abs = negative ? -wei : wei

  const whole = abs / WEI_PER_ETH
  const frac = abs % WEI_PER_ETH

  // 18-digit, zero-padded fractional part.
  let fracStr = frac.toString().padStart(18, '0')
  // Trim trailing zeros...
  fracStr = fracStr.replace(/0+$/, '')
  // ...but never fewer than MIN_DECIMALS.
  if (fracStr.length < MIN_DECIMALS) fracStr = fracStr.padEnd(MIN_DECIMALS, '0')

  return `${negative ? '-' : ''}${whole.toString()}.${fracStr}`
}

/**
 * Full ETH string with unit, e.g. "0.015000 ETH". This is the canonical form —
 * render inside `font-mono`.
 */
export function formatEth(wei: bigint): string {
  return `${formatWeiValue(wei)} ETH`
}

/**
 * Format a floating-point ETH amount (used by the fee-flow simulator, which
 * works in floats rather than wei) to the same ledger precision. Always >= 6
 * decimals. Number only, e.g. "0.007000".
 */
export function formatEthFloat(eth: number): string {
  if (!Number.isFinite(eth)) return '0.000000'
  // Round at 12 decimals to absorb IEEE float noise (the simulator works in
  // floats, not wei), then apply the same trim-to-meaningful-but-min-6 rule as
  // the wei formatter to keep the fixed-width ledger feel.
  const s = Math.abs(eth).toFixed(12)
  let [whole, fracStr = ''] = s.split('.')
  fracStr = fracStr.replace(/0+$/, '')
  if (fracStr.length < MIN_DECIMALS) fracStr = fracStr.padEnd(MIN_DECIMALS, '0')
  return `${eth < 0 ? '-' : ''}${whole}.${fracStr}`
}

/**
 * Registry mark digits for a token id: 6 -> "0006".
 */
export function registryId(id: number | bigint): string {
  return id.toString().padStart(4, '0')
}

/**
 * Full registry mark: 6 -> "⬡ 0006".
 */
export function registryMark(id: number | bigint): string {
  return `⬡ ${registryId(id)}`
}
