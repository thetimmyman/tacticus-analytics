export function extractApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== 'object') return fallback
  const body = data as Record<string, unknown>
  if (typeof body.error === 'string') return body.error
  if (body.error && typeof body.error === 'object') {
    const message = (body.error as Record<string, unknown>).message
    if (typeof message === 'string') return message
  }
  if (typeof body.message === 'string') return body.message
  return fallback
}

export function formatRelativeTime(date: Date): string {
  const divisions: Array<[number, Intl.RelativeTimeFormatUnit]> = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
    [7, 'day'],
    [4.348, 'week'],
    [12, 'month'],
    [Number.POSITIVE_INFINITY, 'year']
  ]
  const formatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })
  let value = (date.getTime() - Date.now()) / 1000
  for (const [amount, unit] of divisions) {
    if (Math.abs(value) < amount)
      return formatter.format(Math.round(value), unit)
    value /= amount
  }
  return formatter.format(Math.round(value), 'year')
}
