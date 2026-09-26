export interface FormatNumberOptions {
  decimals?: number
  fallback?: string
  forceSign?: boolean
}

export function formatCompactNumber(
  value: number | null | undefined,
  options: FormatNumberOptions = {}
): string {
  const { decimals = 1, fallback = '--', forceSign = false } = options

  if (value === null || value === undefined || Number.isNaN(value)) {
    return fallback
  }

  const absolute = Math.abs(value)
  let formatted: string
  let suffix = ''

  if (absolute >= 1_000_000_000) {
    formatted = (absolute / 1_000_000_000).toFixed(decimals)
    suffix = 'B'
  } else if (absolute >= 1_000_000) {
    formatted = (absolute / 1_000_000).toFixed(decimals)
    suffix = 'M'
  } else if (absolute >= 1_000) {
    formatted = (absolute / 1_000).toFixed(decimals)
    suffix = 'K'
  } else {
    formatted = absolute.toFixed(decimals)
  }

  if (formatted.includes('.')) {
    formatted = formatted.replace(/\.0+$/, '').replace(/\.?0+$/, '')
  }

  const sign = value < 0 ? '-' : forceSign && value > 0 ? '+' : ''
  return `${sign}${formatted}${suffix}`
}

export function formatPercentage(
  value: number | null | undefined,
  options: { decimals?: number; fallback?: string } = {}
): string {
  const { decimals = 1, fallback = '--' } = options

  if (value === null || value === undefined || Number.isNaN(value)) {
    return fallback
  }

  const percentage = (value * 100).toFixed(decimals)
  return percentage.replace(/\.0+$/, '').replace(/\.?0+$/, '') + '%'
}

export function formatDurationShort(
  seconds: number | null | undefined
): string | null {
  if (seconds === null || seconds === undefined || Number.isNaN(seconds)) {
    return null
  }

  const total = Math.max(0, Math.floor(seconds))
  const days = Math.floor(total / 86_400)
  const hours = Math.floor((total % 86_400) / 3_600)
  const minutes = Math.floor((total % 3_600) / 60)

  if (days > 0) return hours > 0 ? `${days}d ${hours}h` : `${days}d`
  if (hours > 0) return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`
  return `${minutes}m`
}

export function formatIntervalDuration(
  interval: string | null | undefined,
  options: { fallback?: string } = {}
): string {
  const { fallback = '--' } = options

  if (!interval) return fallback

  const parts = interval.split(':').map((part) => {
    const parsed = Number.parseInt(part, 10)
    return Number.isNaN(parsed) ? NaN : parsed
  })

  if (parts.some((part) => Number.isNaN(part))) {
    return fallback
  }

  const [hours = 0, minutes = 0, seconds = 0] = parts
  const totalMinutes = hours * 60 + minutes + Math.round(seconds / 60)

  if (totalMinutes <= 0) return 'Ready'
  if (totalMinutes < 60) return `${totalMinutes}m`

  const wholeHours = Math.floor(totalMinutes / 60)
  const remainingMinutes = totalMinutes % 60
  return remainingMinutes > 0
    ? `${wholeHours}h ${remainingMinutes}m`
    : `${wholeHours}h`
}

export function formatRelativeDuration(
  targetDate: string | number | Date | null | undefined,
  options: { fallback?: string } = {}
): string {
  const { fallback = '--' } = options

  if (!targetDate) return fallback

  const target = new Date(targetDate)
  if (Number.isNaN(target.getTime())) return fallback

  const now = new Date()
  const diffMs = target.getTime() - now.getTime()
  if (diffMs <= 0) return 'Ready'

  const diffMinutes = Math.round(diffMs / (60 * 1000))
  if (diffMinutes < 60) return `${diffMinutes}m`

  const diffHours = Math.floor(diffMinutes / 60)
  const remainingMinutes = diffMinutes % 60

  if (diffHours < 24) {
    return remainingMinutes > 0
      ? `${diffHours}h ${remainingMinutes}m`
      : `${diffHours}h`
  }

  const diffDays = Math.floor(diffHours / 24)
  const remainingHours = diffHours % 24
  return remainingHours > 0 ? `${diffDays}d ${remainingHours}h` : `${diffDays}d`
}

export function formatTimeRemaining(hours: number, minutes: number): string {
  if (typeof hours !== 'number' || typeof minutes !== 'number') {
    return 'UNKNOWN'
  }

  const h = Math.max(0, Math.floor(hours))
  const m = Math.max(0, Math.floor(minutes))

  if (h === 0 && m === 0) return '00h00m'

  if (hours < 0) {
    const absHours = Math.abs(h)
    const absMinutes = Math.abs(m)
    return `-${absHours}h${absMinutes.toString().padStart(2, '0')}m`
  }

  return `${h}h${m.toString().padStart(2, '0')}m`
}

export function formatList(
  items: string[],
  options: { emptyLabel?: string } = {}
): string {
  const { emptyLabel = 'None' } = options

  if (!items || items.length === 0) return emptyLabel
  if (items.length === 1) return items[0]
  if (items.length === 2) return `${items[0]} and ${items[1]}`

  const allButLast = items.slice(0, -1).join(', ')
  const last = items[items.length - 1]
  return `${allButLast}, and ${last}`
}

export function formatTimestamp(date: Date | string | number): string {
  const d = new Date(date)
  const hours = d.getUTCHours().toString().padStart(2, '0')
  const minutes = d.getUTCMinutes().toString().padStart(2, '0')
  const year = d.getUTCFullYear()
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0')
  const day = d.getUTCDate().toString().padStart(2, '0')
  return `${hours}:${minutes} on ${year}/${month}/${day}`
}
