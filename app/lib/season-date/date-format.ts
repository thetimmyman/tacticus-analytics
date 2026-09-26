// Locale-dependent formatters take `hasMounted` and return a placeholder before mount (no hydration mismatch).

export function formatShortDate(
  value: string | null,
  hasMounted: boolean
): string | null {
  if (!value) return null
  if (!hasMounted) return 'recently'
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric'
  }).format(new Date(value))
}

export function formatSeasonDateTime(
  iso: string,
  timeZone: string,
  hasMounted: boolean
): string {
  const date = new Date(iso)
  if (!Number.isFinite(date.getTime())) return iso
  if (!hasMounted) return '—'

  try {
    return date.toLocaleString('en-US', {
      timeZone: timeZone || 'UTC',
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return date.toLocaleString()
  }
}

function toUtcYmd(d: Date): string {
  const year = d.getUTCFullYear()
  const month = String(d.getUTCMonth() + 1).padStart(2, '0')
  const day = String(d.getUTCDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatUtcDateShort(dateStr: string | null): string {
  if (!dateStr) return 'Unknown'
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return 'Unknown'
  return toUtcYmd(d)
}

export function formatUtcDateLabel(value: string | number): string {
  const raw = String(value)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return raw
  }

  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  return toUtcYmd(date)
}
