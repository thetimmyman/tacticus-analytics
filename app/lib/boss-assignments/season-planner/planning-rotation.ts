import type { SeasonRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import {
  getSeasonConfigById,
  type SeasonConfig
} from '@/app/lib/loki/season-configs'

export interface ResolvedPlanningRotation {
  rotation: SeasonRotationSnapshot | null
  seasonId: string | null
}

export function resolvePlanningRotation(args: {
  configId?: string | null
  seasonConfig?: SeasonConfig | null
  liveRotation: SeasonRotationSnapshot | null
}): ResolvedPlanningRotation {
  const { liveRotation } = args
  const requested =
    typeof args.configId === 'string' ? args.configId.trim() : ''

  const live = (): ResolvedPlanningRotation => ({
    rotation: liveRotation,
    seasonId: liveRotation?.currentConfigId ?? null
  })

  if (!requested) return live()

  // Raw config ids are a sliding window; cumulative lineups are authoritative.
  const chosen = args.seasonConfig ?? getSeasonConfigById(requested)
  if (chosen.id !== requested) return live()

  if (liveRotation && liveRotation.currentConfigId === requested) {
    return { rotation: liveRotation, seasonId: requested }
  }

  const base: SeasonRotationSnapshot = liveRotation ?? {
    resolvedAt: new Date(0).toISOString(),
    seasonNumber: null,
    source: 'planning',
    currentConfigId: requested,
    nextConfigId: '',
    currentBosses: [],
    nextBosses: [],
    matches: 0,
    observedBosses: [],
    notes: null,
    errorReason: null
  }

  return {
    rotation: {
      ...base,
      currentConfigId: requested,
      currentBosses: chosen.bosses
    },
    seasonId: requested
  }
}
