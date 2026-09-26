import {
  addDaysToLocalDate,
  formatLocalDateKey,
  getZonedParts,
  normalizeTimeZone,
  zonedTimeToUtc,
  type LocalDate
} from '@/app/lib/boss-assignments/season-planner/time'
import type { AvailabilityWindow } from '@/app/lib/boss-assignments/season-planner/availability'

export interface SessionTemplate {
  hour: number
  probability: number
}

export interface GeneratedSession {
  at: string
  localDay: string
  localHour: number
  probability: number
}

const DEFAULT_SESSION_HOURS = [18, 6, 12]

const toClampedInt = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.trunc(value)
}

const toSessionHours = (hours: number[]): number[] =>
  Array.from(
    new Set(
      hours
        .map((h) => Math.trunc(h))
        .filter((h) => Number.isFinite(h) && h >= 0 && h <= 23)
    )
  )

export function pickSessionTemplates(args: {
  windows: AvailabilityWindow[]
  maxPerDay: number
  minProbability?: number
}): SessionTemplate[] {
  const maxPerDay = Math.max(1, toClampedInt(args.maxPerDay, 1))
  const minProbability =
    typeof args.minProbability === 'number'
      ? Math.max(0, args.minProbability)
      : 0

  const sorted = [...args.windows].sort((a, b) => {
    if (b.probability !== a.probability) return b.probability - a.probability
    return a.hour - b.hour
  })

  const picked = sorted
    .filter((w) => w.probability >= minProbability)
    .slice(0, maxPerDay)
    .map((w) => ({ hour: w.hour, probability: w.probability }))

  // All-zero probabilities would tiebreak to 00:00; treat them as no data.
  const hasSignal = picked.some((p) => p.probability > 0)
  if (picked.length > 0 && hasSignal) return picked

  const fallbackHours = DEFAULT_SESSION_HOURS.slice(0, maxPerDay)
  return fallbackHours.map((hour) => ({ hour, probability: 0 }))
}

const toLocalDay = (date: Date, timeZone: string): LocalDate => {
  const parts = getZonedParts(date, timeZone)
  return { year: parts.year, month: parts.month, day: parts.day }
}

const localDateToComparable = (date: LocalDate): number =>
  Date.UTC(date.year, date.month - 1, date.day)

export function generateSessions(args: {
  seasonStartAt: string
  seasonEndAt: string
  timeZone: string
  templates: SessionTemplate[]
  minute?: number
  second?: number
}): GeneratedSession[] {
  const timeZone = normalizeTimeZone(args.timeZone)

  const seasonStart = new Date(args.seasonStartAt)
  const seasonEnd = new Date(args.seasonEndAt)
  if (
    !Number.isFinite(seasonStart.getTime()) ||
    !Number.isFinite(seasonEnd.getTime())
  ) {
    return []
  }

  const templates = args.templates
    .map((t) => ({ hour: Math.trunc(t.hour), probability: t.probability }))
    .filter((t) => Number.isFinite(t.hour) && t.hour >= 0 && t.hour <= 23)
    .sort((a, b) => a.hour - b.hour)

  if (templates.length === 0) {
    return []
  }

  const minute = Math.max(0, Math.min(59, toClampedInt(args.minute, 0)))
  const second = Math.max(0, Math.min(59, toClampedInt(args.second, 0)))

  const startLocalDay = toLocalDay(seasonStart, timeZone)
  const endLocalDay = toLocalDay(seasonEnd, timeZone)

  const startComparable = localDateToComparable(startLocalDay)
  const endComparable = localDateToComparable(endLocalDay)

  if (!Number.isFinite(startComparable) || !Number.isFinite(endComparable)) {
    return []
  }

  const sessions: GeneratedSession[] = []
  const dayCount = Math.max(
    0,
    Math.round((endComparable - startComparable) / 86_400_000) + 2
  )

  const normalizedSessionHours = toSessionHours(templates.map((t) => t.hour))
  if (normalizedSessionHours.length === 0) return []

  const templateByHour = new Map<number, SessionTemplate>()
  templates.forEach((template) => {
    templateByHour.set(template.hour, template)
  })

  for (let i = 0; i < dayCount; i += 1) {
    const day = addDaysToLocalDate(startLocalDay, i)
    if (localDateToComparable(day) > endComparable) {
      break
    }

    for (const hour of normalizedSessionHours) {
      const template = templateByHour.get(hour)
      const sessionUtc = zonedTimeToUtc(
        {
          year: day.year,
          month: day.month,
          day: day.day,
          hour,
          minute,
          second
        },
        timeZone
      )
      if (sessionUtc < seasonStart || sessionUtc >= seasonEnd) continue

      sessions.push({
        at: sessionUtc.toISOString(),
        localDay: formatLocalDateKey(day),
        localHour: hour,
        probability: template?.probability ?? 0
      })
    }
  }

  sessions.sort((a, b) => a.at.localeCompare(b.at))
  return sessions
}
