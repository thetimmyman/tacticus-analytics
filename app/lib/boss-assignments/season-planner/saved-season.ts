import {
  GLOBAL_CONFIG,
  FIRST_SEASON_START_MS,
  SEASON_DURATION_SECONDS,
  SEASON_NUMBER_OFFSET
} from '@/app/lib/loki/season-configs'
import { computeSeasonWindowMs } from './season-window'
import { getSeasonConfigForSeasonNumber } from '@/app/lib/loki/season-configs'
import type { SeasonRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import { Errors } from '@/app/lib/errors/AppError'

/** Captured selected-season inputs only; never refresh the global hosted cache. */
export function resolveSavedPlanningRotation(
  season: string,
  snapshotAt: string,
  configId?: string | null
): SeasonRotationSnapshot {
  const config = getSeasonConfigForSeasonNumber(Number(season))
  if (!config || (configId && configId !== config.id))
    throw Errors.fromResponse(422, {
      error: 'Captured boss configuration is unavailable for this saved season.'
    })
  return {
    resolvedAt: snapshotAt,
    seasonNumber: Number(season),
    source: 'saved-season',
    currentConfigId: config.id,
    nextConfigId: '',
    currentBosses: config.bosses,
    nextBosses: [],
    matches: 0,
    observedBosses: [],
    notes: 'Captured configuration for the selected saved season',
    errorReason: null
  }
}

export function resolveSavedSeasonWindow(season: string) {
  return computeSeasonWindowMs(Number(season), {
    firstSeasonStartMs: FIRST_SEASON_START_MS,
    seasonDurationSeconds: SEASON_DURATION_SECONDS,
    bufferAfterSeasonEndSeconds:
      GLOBAL_CONFIG?.guildBoss?.misc?.bufferAfterSeasonEnd ?? 86400,
    seasonNumberOffset: SEASON_NUMBER_OFFSET
  })
}
