import { WAR_TIMING, type WarPhase, type WarPhaseSource } from './constants'

// Anchored on war_end_date backwards (end − 36h active − 24h prep): endsOn is
// the most reliable synced field. Start-only matches are flagged estimated.

export interface WarPhaseInfo {
  phase: WarPhase
  warNumber: number
  seasonNumber: number
  nextEventTime: Date
  nextEventLabel: string
  source: WarPhaseSource
  sourceLabel: string
  isEstimated: boolean
}

export interface WarMatchTimingData {
  war_start_date: string | null
  war_end_date: string | null
  war_season: number | null
  raw_loki_data?: unknown
}

const parseDateMs = (value: string | null | undefined): number | null => {
  if (!value) return null
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : null
}

const toNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

const formatWarLabel = (
  warNumber: number,
  fallback: 'current' | 'next' = 'current'
) => {
  if (warNumber > 0) return `War ${warNumber}`
  return fallback === 'next' ? 'Next War' : 'Current War'
}

const formatSeasonLabel = (seasonNumber: number) =>
  seasonNumber > 0 ? `Season ${seasonNumber}` : 'Next Season'

export const extractWarNumbers = (match?: WarMatchTimingData) => {
  if (!match) return { warNumber: 0, seasonNumber: 0 }
  const rawData = match.raw_loki_data
  const rawRecord =
    typeof rawData === 'object' && rawData !== null && !Array.isArray(rawData)
      ? (rawData as Record<string, unknown>)
      : undefined

  const rawWarNumber = toNumber(rawRecord?.warNumber)
  const rawSeasonNumber = toNumber(rawRecord?.season)
  const rawEventId = toNumber(rawRecord?.lastGuildWarEventId)

  const computedSeason = rawEventId
    ? Math.floor((rawEventId - 1) / WAR_TIMING.WARS_PER_SEASON) + 1
    : undefined
  const computedWarNumber = rawEventId
    ? ((rawEventId - 1) % WAR_TIMING.WARS_PER_SEASON) + 1
    : undefined

  return {
    warNumber: rawWarNumber ?? computedWarNumber ?? 0,
    seasonNumber: match.war_season ?? rawSeasonNumber ?? computedSeason ?? 0
  }
}

type WarWindow = {
  prepStartMs: number
  activeStartMs: number
  endMs: number
  isEstimated: boolean
}

export const resolveWarWindow = (
  match: WarMatchTimingData
): WarWindow | null => {
  const startMs = parseDateMs(match.war_start_date)
  const endMs = parseDateMs(match.war_end_date)

  if (endMs !== null) {
    const activeStartMs = endMs - WAR_TIMING.ACTIVE_PHASE_MS
    const prepStartMs = activeStartMs - WAR_TIMING.PREP_PHASE_MS
    return { prepStartMs, activeStartMs, endMs, isEstimated: false }
  }

  if (startMs !== null) {
    const prepStartMs = startMs
    const activeStartMs = prepStartMs + WAR_TIMING.PREP_PHASE_MS
    const computedEndMs = activeStartMs + WAR_TIMING.ACTIVE_PHASE_MS
    return {
      prepStartMs,
      activeStartMs,
      endMs: computedEndMs,
      isEstimated: true
    }
  }

  return null
}

export const buildPhaseFromMatch = (
  match: WarMatchTimingData,
  nowMs: number
): WarPhaseInfo | null => {
  const window = resolveWarWindow(match)
  if (!window) return null

  const { warNumber, seasonNumber } = extractWarNumbers(match)
  const { prepStartMs, activeStartMs, endMs, isEstimated } = window

  if (nowMs < prepStartMs) {
    return {
      phase: 'between_wars',
      warNumber,
      seasonNumber,
      nextEventTime: new Date(prepStartMs),
      nextEventLabel: `${formatWarLabel(warNumber, 'next')} Prep Starts`,
      source: 'match_schedule',
      sourceLabel: isEstimated
        ? 'Match schedule (estimated)'
        : 'Match schedule',
      isEstimated
    }
  }

  if (nowMs < activeStartMs) {
    return {
      phase: 'prep',
      warNumber,
      seasonNumber,
      nextEventTime: new Date(activeStartMs),
      nextEventLabel: `${formatWarLabel(warNumber, 'current')} Attacks Begin`,
      source: 'match_schedule',
      sourceLabel: isEstimated
        ? 'Match schedule (estimated)'
        : 'Match schedule',
      isEstimated
    }
  }

  if (nowMs < endMs) {
    return {
      phase: 'active',
      warNumber,
      seasonNumber,
      nextEventTime: new Date(endMs),
      nextEventLabel: `${formatWarLabel(warNumber, 'current')} Ends`,
      source: 'match_schedule',
      sourceLabel: isEstimated
        ? 'Match schedule (estimated)'
        : 'Match schedule',
      isEstimated
    }
  }

  return null
}

export const buildEstimatedPhaseFromMatch = (
  match: WarMatchTimingData,
  nowMs: number
): WarPhaseInfo | null => {
  const window = resolveWarWindow(match)
  if (!window) return null

  const base = extractWarNumbers(match)
  const warNumber = base.warNumber
  const seasonNumber = base.seasonNumber
  const { prepStartMs, activeStartMs, endMs } = window

  if (nowMs < prepStartMs) {
    return {
      phase: 'between_wars',
      warNumber,
      seasonNumber,
      nextEventTime: new Date(prepStartMs),
      nextEventLabel: `${formatWarLabel(warNumber, 'next')} Prep Starts`,
      source: 'estimated',
      sourceLabel: 'Estimated schedule',
      isEstimated: true
    }
  }

  if (nowMs < activeStartMs) {
    return {
      phase: 'prep',
      warNumber,
      seasonNumber,
      nextEventTime: new Date(activeStartMs),
      nextEventLabel: `${formatWarLabel(warNumber, 'current')} Attacks Begin`,
      source: 'estimated',
      sourceLabel: 'Estimated schedule',
      isEstimated: true
    }
  }

  if (nowMs < endMs) {
    return {
      phase: 'active',
      warNumber,
      seasonNumber,
      nextEventTime: new Date(endMs),
      nextEventLabel: `${formatWarLabel(warNumber, 'current')} Ends`,
      source: 'estimated',
      sourceLabel: 'Estimated schedule',
      isEstimated: true
    }
  }

  let nextWarNumber = warNumber > 0 ? warNumber + 1 : 0
  let nextSeasonNumber = seasonNumber > 0 ? seasonNumber : 0
  let nextPrepStartMs = endMs
  let nextPhase: 'between_wars' | 'between_seasons' = 'between_wars'

  if (warNumber > 0 && warNumber >= WAR_TIMING.WARS_PER_SEASON) {
    nextWarNumber = 1
    nextSeasonNumber = seasonNumber > 0 ? seasonNumber + 1 : 0
    nextPrepStartMs = endMs + WAR_TIMING.ESTIMATED_SEASON_BREAK_MS
    nextPhase = 'between_seasons'
  } else {
    nextPrepStartMs = endMs + WAR_TIMING.PREP_PHASE_MS
  }

  let nextActiveStartMs = nextPrepStartMs + WAR_TIMING.PREP_PHASE_MS
  let nextEndMs = nextActiveStartMs + WAR_TIMING.ACTIVE_PHASE_MS

  let guard = 0
  while (nowMs >= nextEndMs && guard < 12) {
    guard += 1
    if (nextWarNumber > 0 && nextWarNumber >= WAR_TIMING.WARS_PER_SEASON) {
      nextWarNumber = 1
      nextSeasonNumber = nextSeasonNumber > 0 ? nextSeasonNumber + 1 : 0
      nextPrepStartMs = nextEndMs + WAR_TIMING.ESTIMATED_SEASON_BREAK_MS
      nextPhase = 'between_seasons'
    } else {
      nextWarNumber = nextWarNumber > 0 ? nextWarNumber + 1 : 0
      nextPrepStartMs = nextEndMs + WAR_TIMING.PREP_PHASE_MS
      nextPhase = 'between_wars'
    }
    nextActiveStartMs = nextPrepStartMs + WAR_TIMING.PREP_PHASE_MS
    nextEndMs = nextActiveStartMs + WAR_TIMING.ACTIVE_PHASE_MS
  }

  if (nowMs < nextPrepStartMs) {
    return {
      phase: nextPhase,
      warNumber: nextWarNumber,
      seasonNumber: nextSeasonNumber,
      nextEventTime: new Date(nextPrepStartMs),
      nextEventLabel:
        nextPhase === 'between_seasons'
          ? `${formatSeasonLabel(nextSeasonNumber)} Starts`
          : `${formatWarLabel(nextWarNumber, 'next')} Prep Starts`,
      source: 'estimated',
      sourceLabel: 'Estimated schedule',
      isEstimated: true
    }
  }

  if (nowMs < nextActiveStartMs) {
    return {
      phase: 'prep',
      warNumber: nextWarNumber,
      seasonNumber: nextSeasonNumber,
      nextEventTime: new Date(nextActiveStartMs),
      nextEventLabel: `${formatWarLabel(nextWarNumber, 'current')} Attacks Begin`,
      source: 'estimated',
      sourceLabel: 'Estimated schedule',
      isEstimated: true
    }
  }

  if (nowMs < nextEndMs) {
    return {
      phase: 'active',
      warNumber: nextWarNumber,
      seasonNumber: nextSeasonNumber,
      nextEventTime: new Date(nextEndMs),
      nextEventLabel: `${formatWarLabel(nextWarNumber, 'current')} Ends`,
      source: 'estimated',
      sourceLabel: 'Estimated schedule',
      isEstimated: true
    }
  }

  return null
}
