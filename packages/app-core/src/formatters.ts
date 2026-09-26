/**
 * Number formatting. `number-format.ts#formatNumber` and the Deno copy in _shared/formatters.ts
 * tier differently on purpose; do not merge them.
 */

/**
 * >= 999.5T -> Q, >= 999.5B -> T, >= 999.5M -> B, >= 999,500 -> M (all with
 * `decimals` places, default 2); 100,000-999,499 -> ###k; below that, commas.
 */
export function formatNumber(
  num: number | null | undefined,
  decimals: number = 2
): string {
  if (num === null || num === undefined || isNaN(num)) return '0'

  const absNum = Math.abs(num)
  const sign = num < 0 ? '-' : ''
  const decimalsToUse = Math.max(0, decimals)

  const formatWithSuffix = (value: number, suffix: string): string => {
    const formatted = value.toFixed(decimalsToUse)
    const parts = formatted.split('.')
    const integerPart = Number(parts[0]).toLocaleString()
    if (decimalsToUse === 0 || parts[1] === undefined) {
      return `${sign}${integerPart}${suffix}`
    }
    return `${sign}${integerPart}.${parts[1]}${suffix}`
  }

  if (absNum >= 999500000000000000) {
    return formatWithSuffix(absNum / 1000000000000000, 'Q')
  }

  if (absNum >= 999500000000) {
    return formatWithSuffix(absNum / 1000000000000, 'T')
  }

  if (absNum >= 1000000000) {
    return formatWithSuffix(absNum / 1000000000, 'B')
  }

  if (absNum >= 999500) {
    return formatWithSuffix(absNum / 1000000, 'M')
  }

  if (absNum >= 100000) {
    const thousands = Math.round(absNum / 1000)
    return `${sign}${thousands}k`
  }

  const rounded = Math.round(absNum)
  return `${sign}${rounded.toLocaleString()}`
}

export function formatDamage(
  damage: number | null | undefined,
  decimals: number = 2
): string {
  return formatNumber(Math.abs(damage || 0), decimals)
}

/** @param value - fraction, e.g. 0.15 for 15% */
export function formatPercentage(
  value: number | null | undefined,
  decimals: number = 0
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '0%'
  return `${(value * 100).toFixed(decimals)}%`
}

export function formatPercentageDiff(
  value: number | null | undefined,
  decimals: number = 0
): string {
  if (value === null || value === undefined || !Number.isFinite(value))
    return '0%'
  const formatted = value.toFixed(decimals).replace(/\.0+$/, '')
  return value >= 0 ? `+${formatted}%` : `${formatted}%`
}

export function formatDuration(seconds: number | null | undefined): string {
  if (
    seconds === null ||
    seconds === undefined ||
    isNaN(seconds) ||
    seconds <= 0
  )
    return '0m'

  const totalMinutes = Math.floor(seconds / 60)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60

  if (hours > 0) {
    if (minutes > 0) {
      return `${hours}h ${minutes}m`
    }
    return `${hours}h`
  }

  return `${minutes}m`
}
