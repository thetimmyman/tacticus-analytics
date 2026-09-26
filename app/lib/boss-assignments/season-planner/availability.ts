import {
  formatLocalDateKey,
  getZonedParts,
  normalizeTimeZone,
  type ZonedDateTimeParts
} from '@/app/lib/boss-assignments/season-planner/time'

export interface AvailabilityWindow {
  hour: number
  daysWithActivity: number
  probability: number
}

export interface HourlyAvailabilityResult {
  timeZone: string
  observedDays: number
  windows: AvailabilityWindow[]
}

const isValidHour = (value: number): value is number =>
  Number.isFinite(value) && value >= 0 && value <= 23

const toNonNegativeInt = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(0, Math.trunc(value))
}

const parseEventTime = (value: unknown): Date | null => {
  if (typeof value !== 'string' || !value.trim()) return null
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date : null
}

export function inferHourlyAvailability(args: {
  eventTimestamps: string[]
  observedDays: number
  timeZone: string
}): HourlyAvailabilityResult {
  const timeZone = normalizeTimeZone(args.timeZone)
  const observedDays = toNonNegativeInt(args.observedDays, 0)

  const daySetsByHour: Array<Set<string>> = Array.from(
    { length: 24 },
    () => new Set()
  )

  for (const raw of args.eventTimestamps) {
    const date = parseEventTime(raw)
    if (!date) continue

    const parts: ZonedDateTimeParts = getZonedParts(date, timeZone)
    if (!isValidHour(parts.hour)) continue

    const dayKey = formatLocalDateKey({
      year: parts.year,
      month: parts.month,
      day: parts.day
    })
    const daySet = daySetsByHour[parts.hour]
    if (!daySet) continue
    daySet.add(dayKey)
  }

  const windows: AvailabilityWindow[] = daySetsByHour.map((daySet, hour) => {
    const daysWithActivity = daySet.size
    const probability = observedDays > 0 ? daysWithActivity / observedDays : 0
    return { hour, daysWithActivity, probability }
  })

  return { timeZone, observedDays, windows }
}
