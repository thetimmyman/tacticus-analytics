import 'server-only'

import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.services.season-timing-service')

import { getGlobalConfigSnapshot } from '@/app/lib/loki/global-config'

const FALLBACK_FIRST_SEASON_START_MS = 1646128800000
const FALLBACK_SEASON_CYCLE_SECONDS = 1_209_600
const FALLBACK_SEASON_GAP_SECONDS = 86_400
// The API reports the rolled-over season number. A wrong offset shifts every
// `season_calendar` boundary by a whole cycle and breaks token burn math.
const SEASON_NUMBER_OFFSET = 10

export interface SeasonTimingConstants {
  firstSeasonStartMs: number
  seasonCycleSeconds: number
  seasonGapSeconds: number
}

export interface SeasonTimingDivergence {
  field: string
  lokiValue: number
  hardcodedValue: number
  deltaMs: number
}

export interface SeasonTimingData {
  seasonNumber: number
  seasonStart: number
  seasonEnd: number
  nextSeasonStart: number
  isInGap: boolean
  hasEnded: boolean
  hoursElapsed: number
  seasonActiveMs: number
  seasonGapMs: number
  source: 'loki-globalconfig' | 'hardcoded-fallback'
  constants: SeasonTimingConstants
  divergence: SeasonTimingDivergence | null
}

function computeFromConstants(
  constants: SeasonTimingConstants,
  seasonNumber: number,
  nowMs: number
): Omit<SeasonTimingData, 'source' | 'constants' | 'divergence'> {
  const cycleMs = constants.seasonCycleSeconds * 1000
  const gapMs = constants.seasonGapSeconds * 1000
  const activeMs = Math.max(0, cycleMs - gapMs)

  // `firstSeasonStart` precedes a leading gap like every cycle's; without
  // `+ gapMs` calendar boundaries land 24h early and break token burn math.
  const seasonsElapsed = seasonNumber + SEASON_NUMBER_OFFSET - 1
  const seasonStart =
    constants.firstSeasonStartMs + gapMs + seasonsElapsed * cycleMs
  const seasonEnd = seasonStart + activeMs
  const nextSeasonStart = seasonStart + cycleMs

  const hasEnded = nowMs > seasonEnd
  const isInGap = hasEnded && nowMs < nextSeasonStart

  const elapsedMs = Math.max(0, Math.min(nowMs - seasonStart, activeMs))
  const hoursElapsed = elapsedMs / (1000 * 60 * 60)

  return {
    seasonNumber,
    seasonStart,
    seasonEnd,
    nextSeasonStart,
    isInGap,
    hasEnded,
    hoursElapsed,
    seasonActiveMs: activeMs,
    seasonGapMs: gapMs
  }
}

function getCurrentSeasonFromConstants(
  constants: SeasonTimingConstants,
  nowMs: number
): number {
  const cycleMs = constants.seasonCycleSeconds * 1000
  if (cycleMs <= 0) return 1
  const gapMs = constants.seasonGapSeconds * 1000
  const elapsedMs = Math.max(0, nowMs - constants.firstSeasonStartMs - gapMs)
  return Math.floor(elapsedMs / cycleMs) + 1 - SEASON_NUMBER_OFFSET
}

function extractConstants(
  config: Record<string, unknown>
): SeasonTimingConstants | null {
  const guildBoss = config.guildBoss as Record<string, unknown> | undefined
  const misc = guildBoss?.misc as Record<string, unknown> | undefined
  if (!misc) return null

  const firstSeasonStart = misc.firstSeasonStart
  const seasonDuration = misc.seasonDuration
  const bufferAfterSeasonEnd = misc.bufferAfterSeasonEnd

  if (
    typeof firstSeasonStart !== 'number' ||
    typeof seasonDuration !== 'number' ||
    !Number.isFinite(firstSeasonStart) ||
    !Number.isFinite(seasonDuration)
  ) {
    return null
  }

  // A negative buffer would put seasonEnd after nextSeasonStart; use the hardcoded fallback.
  if (
    typeof bufferAfterSeasonEnd === 'number' &&
    Number.isFinite(bufferAfterSeasonEnd) &&
    bufferAfterSeasonEnd < 0
  ) {
    return null
  }

  return {
    firstSeasonStartMs: firstSeasonStart,
    seasonCycleSeconds: seasonDuration,
    seasonGapSeconds:
      typeof bufferAfterSeasonEnd === 'number' &&
      Number.isFinite(bufferAfterSeasonEnd)
        ? bufferAfterSeasonEnd
        : FALLBACK_SEASON_GAP_SECONDS
  }
}

function checkDivergence(
  loki: SeasonTimingConstants,
  hardcoded: SeasonTimingConstants
): SeasonTimingDivergence | null {
  const THRESHOLD_MS = 1000

  if (
    Math.abs(loki.firstSeasonStartMs - hardcoded.firstSeasonStartMs) >
    THRESHOLD_MS
  ) {
    return {
      field: 'firstSeasonStartMs',
      lokiValue: loki.firstSeasonStartMs,
      hardcodedValue: hardcoded.firstSeasonStartMs,
      deltaMs: loki.firstSeasonStartMs - hardcoded.firstSeasonStartMs
    }
  }

  const lokiCycleMs = loki.seasonCycleSeconds * 1000
  const hardcodedCycleMs = hardcoded.seasonCycleSeconds * 1000
  if (Math.abs(lokiCycleMs - hardcodedCycleMs) > THRESHOLD_MS) {
    return {
      field: 'seasonCycleSeconds',
      lokiValue: loki.seasonCycleSeconds,
      hardcodedValue: hardcoded.seasonCycleSeconds,
      deltaMs: lokiCycleMs - hardcodedCycleMs
    }
  }

  const lokiGapMs = loki.seasonGapSeconds * 1000
  const hardcodedGapMs = hardcoded.seasonGapSeconds * 1000
  if (Math.abs(lokiGapMs - hardcodedGapMs) > THRESHOLD_MS) {
    return {
      field: 'seasonGapSeconds',
      lokiValue: loki.seasonGapSeconds,
      hardcodedValue: hardcoded.seasonGapSeconds,
      deltaMs: lokiGapMs - hardcodedGapMs
    }
  }

  return null
}

const HARDCODED_CONSTANTS: SeasonTimingConstants = {
  firstSeasonStartMs: FALLBACK_FIRST_SEASON_START_MS,
  seasonCycleSeconds: FALLBACK_SEASON_CYCLE_SECONDS,
  seasonGapSeconds: FALLBACK_SEASON_GAP_SECONDS
}

export async function getSeasonTiming(
  seasonNumber?: number
): Promise<SeasonTimingData> {
  const nowMs = Date.now()

  try {
    const snapshot = await getGlobalConfigSnapshot()
    const lokiConstants = extractConstants(
      snapshot.config as unknown as Record<string, unknown>
    )

    if (!lokiConstants) {
      logger.warn(
        '[SeasonTiming] Failed to extract constants from LOKI GlobalConfig, using hardcoded fallback'
      )
      const resolved =
        seasonNumber ??
        getCurrentSeasonFromConstants(HARDCODED_CONSTANTS, nowMs)
      return {
        ...computeFromConstants(HARDCODED_CONSTANTS, resolved, nowMs),
        source: 'hardcoded-fallback',
        constants: HARDCODED_CONSTANTS,
        divergence: null
      }
    }

    const divergence = checkDivergence(lokiConstants, HARDCODED_CONSTANTS)
    if (divergence) {
      logger.warn(
        { divergence: divergence },
        '[SeasonTiming] LOKI constants diverge from hardcoded values!'
      )
    }

    const resolved =
      seasonNumber ?? getCurrentSeasonFromConstants(lokiConstants, nowMs)

    return {
      ...computeFromConstants(lokiConstants, resolved, nowMs),
      source: 'loki-globalconfig',
      constants: lokiConstants,
      divergence
    }
  } catch (error) {
    logger.warn(
      { error: error },
      '[SeasonTiming] LOKI GlobalConfig unavailable, using hardcoded fallback'
    )
    const resolved =
      seasonNumber ?? getCurrentSeasonFromConstants(HARDCODED_CONSTANTS, nowMs)
    return {
      ...computeFromConstants(HARDCODED_CONSTANTS, resolved, nowMs),
      source: 'hardcoded-fallback',
      constants: HARDCODED_CONSTANTS,
      divergence: null
    }
  }
}
