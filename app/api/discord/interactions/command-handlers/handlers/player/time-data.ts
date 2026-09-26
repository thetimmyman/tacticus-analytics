import type { AvailabilityWindow } from '@/app/lib/boss-assignments/season-planner/availability'
import { inferHourlyAvailability } from '@/app/lib/boss-assignments/season-planner/availability'
import {
  formatLocalDateKey,
  getZonedParts,
  normalizeTimeZone
} from '@/app/lib/boss-assignments/season-planner/time'
import type { Supabase } from '../../types'
import { normalizeGuild } from '../../utils/formatting'
import {
  resolveAllowedGuilds,
  resolvePlayerByName
} from '../../utils/player-resolution'
import { resolveGuildDisplayLabel } from '@/app/api/discord/guild-label'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import type { EOTGRData } from '@tacticus/app-core/types'

type PlayerNameRow = {
  display_name: string | null
}

type PlayerActivityLookupRow = Pick<
  EOTGRData,
  | 'userId'
  | 'displayName'
  | 'Guild'
  | 'Season'
  | 'startedOn'
  | 'completedOn'
  | 'damageType'
>

export type PlayerTimeActivityWindow = {
  hour: number
  probability: number
  daysWithActivity: number
}

export type PlayerTimeSummary = {
  playerName: string
  displayName: string
  guild: string
  guildLabel: string
  season: string | null
  lookbackDays: number
  timezone: string
  timezoneFallbackReason: 'missing' | 'invalid' | null
  nowLocalHour: number
  nowLocalTimeLabel: string
  peakHour: number
  peakProbability: number
  withinOneHour: boolean
  distanceToPeakHours: number
  observedDays: number
  totalEvents: number
  scopeLabel: string
  topActivityWindows: PlayerTimeActivityWindow[]
  chartWindows: PlayerTimeActivityWindow[]
}

export type PlayerTimeSummaryResult =
  { ok: true; summary: PlayerTimeSummary } | { ok: false; message: string }

const DEFAULT_LOOKBACK_DAYS = 30
const MAX_ACTIVITY_ROWS_PER_QUERY = 1200

function resolveTimezone(input: string | null | undefined): {
  timezone: string
  fallbackReason: 'missing' | 'invalid' | null
} {
  const raw = (input ?? '').trim()
  const normalized = normalizeTimeZone(raw)

  if (!raw) {
    return { timezone: 'UTC', fallbackReason: 'missing' }
  }

  try {
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(
      new Date()
    )
    return { timezone: normalized, fallbackReason: null }
  } catch {
    return { timezone: 'UTC', fallbackReason: 'invalid' }
  }
}

function formatHourLabel(hour: number): string {
  return `${String(Math.max(0, Math.min(23, Math.trunc(hour)))).padStart(2, '0')}:00`
}

function getEventTimestamp(row: PlayerActivityLookupRow): string | null {
  return row.startedOn ?? row.completedOn ?? null
}

function circularHourDistance(a: number, b: number): number {
  const safeA = ((Math.trunc(a) % 24) + 24) % 24
  const safeB = ((Math.trunc(b) % 24) + 24) % 24
  const diff = Math.abs(safeA - safeB)
  return Math.min(diff, 24 - diff)
}

function formatLocalNowLabel(now: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(now)
}

function rankWindows(
  windows: AvailabilityWindow[]
): PlayerTimeActivityWindow[] {
  return windows
    .filter((window) => window.daysWithActivity > 0)
    .sort((a, b) => {
      if (b.probability !== a.probability) {
        return b.probability - a.probability
      }
      if (b.daysWithActivity !== a.daysWithActivity) {
        return b.daysWithActivity - a.daysWithActivity
      }
      return a.hour - b.hour
    })
    .map((window) => ({
      hour: window.hour,
      probability: window.probability,
      daysWithActivity: window.daysWithActivity
    }))
}

function dedupeRows(
  rows: PlayerActivityLookupRow[]
): PlayerActivityLookupRow[] {
  const seen = new Set<string>()
  const deduped: PlayerActivityLookupRow[] = []

  rows.forEach((row) => {
    const timestamp = getEventTimestamp(row) ?? 'no-time'
    const key = [
      row.userId ?? 'no-user',
      row.displayName ?? 'no-name',
      row.Guild ?? 'no-guild',
      row.Season ?? 'no-season',
      row.damageType ?? 'no-type',
      timestamp
    ].join('|')

    if (seen.has(key)) return
    seen.add(key)
    deduped.push(row)
  })

  return deduped
}

async function loadHistoricalNames(
  supabase: Supabase,
  playerId: string,
  displayName: string
): Promise<string[]> {
  const { data, error } = await supabase
    .from('player_mapping')
    .select('display_name')
    .eq('player_id', playerId)
    .order('updated_at', { ascending: false })

  if (error) {
    return [displayName]
  }

  const names = new Set<string>()
  ;((data ?? []) as unknown as PlayerNameRow[]).forEach((row) => {
    const raw = row.display_name?.trim()
    if (raw) {
      names.add(raw)
    }
  })
  names.add(displayName)

  return Array.from(names)
}

async function loadActivityRows(
  supabase: Supabase,
  {
    playerId,
    historicalNames,
    allowedGuilds,
    season,
    lookbackDays
  }: {
    playerId: string
    historicalNames: string[]
    allowedGuilds: string[]
    season: string | null
    lookbackDays: number
  }
): Promise<
  { ok: true; rows: PlayerActivityLookupRow[] } | { ok: false; message: string }
> {
  const lookbackStart = new Date(
    Date.now() - lookbackDays * 86_400_000
  ).toISOString()

  const userIdQuery = supabase
    .from('EOT_GR_data')
    .select(
      'userId, displayName, Guild, Season, startedOn, completedOn, damageType'
    )
    .in('Guild', allowedGuilds)
    .in('damageType', ['Battle', 'Bomb'])
    .eq('userId', playerId)
    .order('startedOn', { ascending: false, nullsFirst: false })
    .limit(MAX_ACTIVITY_ROWS_PER_QUERY)

  const namesQuery = supabase
    .from('EOT_GR_data')
    .select(
      'userId, displayName, Guild, Season, startedOn, completedOn, damageType'
    )
    .in('Guild', allowedGuilds)
    .in('damageType', ['Battle', 'Bomb'])
    .in('displayName', historicalNames)
    .order('startedOn', { ascending: false, nullsFirst: false })
    .limit(MAX_ACTIVITY_ROWS_PER_QUERY)

  const scopedUserIdQuery = season
    ? userIdQuery.eq('Season', season)
    : userIdQuery.gte('startedOn', lookbackStart)
  const scopedNamesQuery = season
    ? namesQuery.eq('Season', season)
    : namesQuery.gte('startedOn', lookbackStart)

  const [
    { data: userIdData, error: userIdError },
    { data: nameData, error: nameError }
  ] = await Promise.all([scopedUserIdQuery, scopedNamesQuery])

  if (userIdError) {
    return {
      ok: false,
      message: `Failed to load player activity by userId: ${userIdError.message}`
    }
  }
  if (nameError) {
    return {
      ok: false,
      message: `Failed to load player activity by display name: ${nameError.message}`
    }
  }

  const merged = dedupeRows([...(userIdData ?? []), ...(nameData ?? [])])

  const filtered = merged.filter((row) => {
    if (row.userId && row.userId !== playerId) {
      return false
    }
    return Boolean(getEventTimestamp(row))
  })

  filtered.sort((a, b) => {
    const aTime = getEventTimestamp(a)
      ? new Date(getEventTimestamp(a)!).getTime()
      : 0
    const bTime = getEventTimestamp(b)
      ? new Date(getEventTimestamp(b)!).getTime()
      : 0
    return bTime - aTime
  })

  return { ok: true, rows: filtered }
}

export async function fetchPlayerTimeSummary(
  supabase: Supabase,
  {
    playerName,
    linkedGuilds,
    requestedGuild,
    requestedSeason,
    lookbackDays = DEFAULT_LOOKBACK_DAYS
  }: {
    playerName: string
    linkedGuilds: string[]
    requestedGuild?: string | null
    requestedSeason?: string | null
    lookbackDays?: number
  }
): Promise<PlayerTimeSummaryResult> {
  const scopeResult = resolveAllowedGuilds({ linkedGuilds, requestedGuild })
  if (!scopeResult.ok) {
    return scopeResult
  }
  const { allowedGuilds, resolvedRequestedGuild } = scopeResult.scope

  const rawPlayerResult = await resolvePlayerByName(supabase, {
    playerName,
    allowedGuilds,
    requestedGuild: resolvedRequestedGuild,
    includeTimezone: true
  })
  if (!rawPlayerResult.ok) {
    return rawPlayerResult
  }
  // Unlike /player-stats, this presents the NORMALIZED guild code.
  const playerResult = {
    ok: true as const,
    player: {
      playerId: rawPlayerResult.player.playerId,
      displayName: rawPlayerResult.player.displayName,
      guild: normalizeGuild(rawPlayerResult.player.guildCode),
      timezone: rawPlayerResult.player.timezone
    }
  }

  const historicalNames = await loadHistoricalNames(
    supabase,
    playerResult.player.playerId,
    playerResult.player.displayName
  )

  const season = requestedSeason?.trim() || null
  const safeLookbackDays = Number.isFinite(lookbackDays)
    ? Math.max(7, Math.min(120, Math.trunc(lookbackDays)))
    : DEFAULT_LOOKBACK_DAYS

  const activityResult = await loadActivityRows(supabase, {
    playerId: playerResult.player.playerId,
    historicalNames,
    allowedGuilds,
    season,
    lookbackDays: safeLookbackDays
  })
  if (!activityResult.ok) {
    return activityResult
  }

  const { timezone, fallbackReason } = resolveTimezone(
    playerResult.player.timezone
  )

  const eventTimestamps: string[] = []
  const uniqueDayKeys = new Set<string>()
  activityResult.rows.forEach((row) => {
    const timestamp = getEventTimestamp(row)
    if (!timestamp) return
    const date = new Date(timestamp)
    if (!Number.isFinite(date.getTime())) return

    eventTimestamps.push(timestamp)

    const zoned = getZonedParts(date, timezone)
    uniqueDayKeys.add(
      formatLocalDateKey({
        year: zoned.year,
        month: zoned.month,
        day: zoned.day
      })
    )
  })

  // displayName stays raw wherever it is a lookup key.
  const memberLabels = await getMemberLabelMap()

  if (eventTimestamps.length === 0) {
    const scope = season
      ? `season ${season}`
      : `the last ${safeLookbackDays} days`
    return {
      ok: false,
      message: `No usable activity timestamps found for ${resolveMemberLabel(playerResult.player.displayName, memberLabels)} in ${scope}.`
    }
  }

  const observedDays = Math.max(1, uniqueDayKeys.size)
  const availability = inferHourlyAvailability({
    eventTimestamps,
    observedDays,
    timeZone: timezone
  })

  const rankedWindows = rankWindows(availability.windows)
  if (rankedWindows.length === 0) {
    return {
      ok: false,
      message: `Not enough activity history to detect a peak time window for ${resolveMemberLabel(playerResult.player.displayName, memberLabels)}.`
    }
  }

  const now = new Date()
  const nowLocalParts = getZonedParts(now, timezone)
  const peak = rankedWindows[0]!
  const distanceToPeakHours = circularHourDistance(
    nowLocalParts.hour,
    peak.hour
  )

  const guildLabel = await resolveGuildDisplayLabel(
    supabase,
    playerResult.player.guild
  )

  return {
    ok: true,
    summary: {
      playerName: playerName.trim(),
      displayName: playerResult.player.displayName,
      guild: playerResult.player.guild,
      guildLabel,
      season,
      lookbackDays: safeLookbackDays,
      timezone,
      timezoneFallbackReason: fallbackReason,
      nowLocalHour: nowLocalParts.hour,
      nowLocalTimeLabel: formatLocalNowLabel(now, timezone),
      peakHour: peak.hour,
      peakProbability: peak.probability,
      withinOneHour: distanceToPeakHours <= 1,
      distanceToPeakHours,
      observedDays,
      totalEvents: eventTimestamps.length,
      scopeLabel: season ? `Season ${season}` : `Last ${safeLookbackDays} days`,
      topActivityWindows: rankedWindows.slice(0, 6),
      chartWindows: rankedWindows.slice(0, 8)
    }
  }
}

export { formatHourLabel }
