import type { StageKillDurationMedian } from './stage-timing'

export interface SavedStageTimingRow {
  Season: string
  damageType: 'Battle'
  rarity: string
  set: number
  loopIndex: number
  startedOn: string
}

const MAX_HISTORY_ROWS = 10000
const WINDOW_MS = 60 * 86_400_000

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value)
}

function historyTime(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 64) return null
  const parts =
    /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(
      value
    )
  const fraction = /\.(\d+)/.exec(value)?.[1]
  if (
    !parts ||
    (fraction !== undefined && /[1-9]/.test(fraction.slice(3))) ||
    Number(parts[2]) > 23 ||
    Number(parts[3]) > 59 ||
    Number(parts[4]) > 59 ||
    Number(parts[5] ?? 0) > 23 ||
    Number(parts[6] ?? 0) > 59
  )
    return null
  const calendar = new Date(`${parts[1]}T00:00:00Z`)
  const at = Date.parse(value)
  if (
    !Number.isFinite(calendar.getTime()) ||
    calendar.toISOString().slice(0, 10) !== parts[1] ||
    !Number.isSafeInteger(at) ||
    at < 0
  )
    return null
  return at
}

/** Mirrors the canonical duration-median grouping, using supplied signed rows
 * and an explicit model instant instead of database NOW(). Completeness and
 * caller/guild admission belong to the saved calculation entry. Nonzero
 * sub-millisecond history is unavailable rather than rounded into the model. */
export function buildSavedStageKillDurationMedians(args: {
  rows: readonly SavedStageTimingRow[]
  season: string
  asOf: string
}): Map<string, StageKillDurationMedian> {
  const invalid = () => {
    throw new Error('Invalid saved stage timing inputs')
  }
  if (
    !record(args) ||
    typeof args.season !== 'string' ||
    !/^[1-9]\d{0,5}$/.test(args.season) ||
    typeof args.asOf !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(args.asOf) ||
    !Array.isArray(args.rows) ||
    args.rows.length > MAX_HISTORY_ROWS
  )
    return invalid()
  const currentSeason = Number(args.season)
  const asOfMs = historyTime(args.asOf)
  if (asOfMs === null) return invalid()
  const windowStart = asOfMs - WINDOW_MS
  const occurrences = new Map<
    string,
    {
      season: number
      stageCode: string
      loopIndex: number
      first: number
      last: number
      attempts: number
    }
  >()
  const latest = new Map<number, number>()
  for (const row of args.rows) {
    if (
      !record(row) ||
      typeof row.Season !== 'string' ||
      !/^\d{1,6}$/.test(row.Season) ||
      Number(row.Season) < 1 ||
      row.damageType !== 'Battle' ||
      typeof row.rarity !== 'string' ||
      !/^(legendary|mythic)$/i.test(row.rarity) ||
      !integer(row.set) ||
      row.set < 0 ||
      row.set > 4 ||
      !integer(row.loopIndex) ||
      row.loopIndex < 0
    )
      return invalid()
    const season = Number(row.Season)
    const at = historyTime(row.startedOn)
    if (at === null) return invalid()
    if (
      at > asOfMs ||
      season > currentSeason ||
      (season < currentSeason && at < windowStart)
    )
      continue
    const stageCode = `${row.rarity.toLowerCase().startsWith('mythic') ? 'M' : 'L'}${row.set + 1}`
    const key = `${season}:${stageCode}:${row.loopIndex}`
    const occurrence = occurrences.get(key)
    if (occurrence) {
      occurrence.first = Math.min(occurrence.first, at)
      occurrence.last = Math.max(occurrence.last, at)
      occurrence.attempts++
    } else
      occurrences.set(key, {
        season,
        stageCode,
        loopIndex: row.loopIndex,
        first: at,
        last: at,
        attempts: 1
      })
    latest.set(season, Math.max(latest.get(season) ?? at, at))
  }
  const groups = new Map<
    string,
    {
      stageCode: string
      loopIndex: number
      source: 'current_season' | 'rolling_window'
      spans: number[]
    }
  >()
  for (const occurrence of occurrences.values()) {
    if (occurrence.attempts < 3 || occurrence.last <= occurrence.first) continue
    const source =
      occurrence.season === currentSeason ? 'current_season' : 'rolling_window'
    if (
      source === 'current_season' &&
      occurrence.last >= latest.get(currentSeason)!
    )
      continue
    const key = `${source}:${occurrence.stageCode}:${occurrence.loopIndex}`
    const group = groups.get(key) ?? {
      stageCode: occurrence.stageCode,
      loopIndex: occurrence.loopIndex,
      source,
      spans: []
    }
    group.spans.push((occurrence.last - occurrence.first) / 1000)
    groups.set(key, group)
  }
  const medians = new Map<string, StageKillDurationMedian>()
  for (const source of ['rolling_window', 'current_season'] as const) {
    for (const group of groups.values()) {
      if (group.source !== source) continue
      group.spans.sort((a, b) => a - b)
      const middle = Math.floor(group.spans.length / 2)
      const upper = group.spans[middle]
      if (upper === undefined) return invalid()
      let medianSeconds = upper
      if (group.spans.length % 2 === 0) {
        const lower = group.spans[middle - 1]
        if (lower === undefined) return invalid()
        medianSeconds = (lower + upper) / 2
      }
      medians.set(`${group.stageCode}|${group.loopIndex}`, {
        stageCode: group.stageCode,
        loopIndex: group.loopIndex,
        medianSeconds,
        sampleCount: group.spans.length,
        source
      })
    }
  }
  return medians
}
