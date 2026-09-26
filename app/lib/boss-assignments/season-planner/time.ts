export type LocalDate = {
  year: number
  month: number
  day: number
}

export type ZonedDateTimeParts = LocalDate & {
  hour: number
  minute: number
  second: number
}

const pad2 = (value: number) => String(value).padStart(2, '0')

export const normalizeTimeZone = (value?: string | null): string => {
  const trimmed = (value ?? '').trim()
  if (!trimmed) return 'UTC'
  if (trimmed.toUpperCase() === 'UTC' || trimmed.toUpperCase() === 'GMT')
    return 'UTC'
  return trimmed
}

const FORMATTER_CACHE = new Map<string, Intl.DateTimeFormat>()

const FORMATTER_OPTIONS: Intl.DateTimeFormatOptions = {
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit'
}

const getFormatter = (timeZone: string): Intl.DateTimeFormat => {
  const normalized = normalizeTimeZone(timeZone)
  const cached = FORMATTER_CACHE.get(normalized)
  if (cached) return cached

  let formatter: Intl.DateTimeFormat
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: normalized,
      ...FORMATTER_OPTIONS
    })
  } catch {
    // An invalid IANA zone makes Intl throw; degrade to UTC instead of a 500.
    formatter =
      FORMATTER_CACHE.get('UTC') ??
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'UTC',
        ...FORMATTER_OPTIONS
      })
    FORMATTER_CACHE.set('UTC', formatter)
  }

  FORMATTER_CACHE.set(normalized, formatter)
  return formatter
}

export function getZonedParts(
  date: Date,
  timeZone: string
): ZonedDateTimeParts {
  const formatter = getFormatter(timeZone)
  const parts = formatter.formatToParts(date)

  const map: Record<string, string> = {}
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value
    }
  }

  return {
    year: Number.parseInt(map.year ?? '0', 10),
    month: Number.parseInt(map.month ?? '1', 10),
    day: Number.parseInt(map.day ?? '1', 10),
    hour: Number.parseInt(map.hour ?? '0', 10),
    minute: Number.parseInt(map.minute ?? '0', 10),
    second: Number.parseInt(map.second ?? '0', 10)
  }
}

export const formatLocalDateKey = (localDate: LocalDate): string =>
  `${localDate.year}-${pad2(localDate.month)}-${pad2(localDate.day)}`

export const addDaysToLocalDate = (
  localDate: LocalDate,
  days: number
): LocalDate => {
  const base = new Date(
    Date.UTC(localDate.year, localDate.month - 1, localDate.day)
  )
  base.setUTCDate(base.getUTCDate() + Math.trunc(days))
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate()
  }
}

export function zonedTimeToUtc(
  input: LocalDate & { hour: number; minute?: number; second?: number },
  timeZone: string
): Date {
  const normalized = normalizeTimeZone(timeZone)

  const desired = {
    year: input.year,
    month: input.month,
    day: input.day,
    hour: input.hour,
    minute: input.minute ?? 0,
    second: input.second ?? 0
  }

  let guess = new Date(
    Date.UTC(
      desired.year,
      desired.month - 1,
      desired.day,
      desired.hour,
      desired.minute,
      desired.second
    )
  )

  for (let i = 0; i < 4; i += 1) {
    const zoned = getZonedParts(guess, normalized)
    const desiredUtcMs = Date.UTC(
      desired.year,
      desired.month - 1,
      desired.day,
      desired.hour,
      desired.minute,
      desired.second
    )
    const actualUtcMs = Date.UTC(
      zoned.year,
      zoned.month - 1,
      zoned.day,
      zoned.hour,
      zoned.minute,
      zoned.second
    )

    const deltaMs = desiredUtcMs - actualUtcMs
    if (deltaMs === 0) {
      break
    }
    guess = new Date(guess.getTime() + deltaMs)
  }

  return guess
}
