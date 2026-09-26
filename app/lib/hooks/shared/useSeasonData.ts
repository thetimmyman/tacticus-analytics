import { useMemo, useState } from 'react'
import { useBaseQuery } from './useBaseQuery'
import type { BossRotation, Season, SeasonBoss } from './types'

type SeasonTimingResponse = {
  seasonNumber: number
  seasonStart: number
  seasonEnd: number
  source: string
}

type SeasonApiResponse = {
  success: boolean
  seasonNumber?: number
  configId?: string
  currentConfigId?: string
  nextConfigId?: string
  futureConfigId?: string
  bosses?: SeasonBoss[]
  upcomingPreview?: SeasonBoss[]
  futurePreview?: SeasonBoss[]
  levels?: string[]
  resolvedAt?: string
  message?: string
  reason?: string
}

const fetchSeasonEndpoint = async (url: string): Promise<SeasonApiResponse> => {
  const response = await fetch(url)
  const payload = (await response
    .json()
    .catch(() => null)) as SeasonApiResponse | null

  if (!response.ok) {
    const message =
      payload?.message || payload?.reason || 'Failed to load season data'
    throw new Error(message)
  }

  if (!payload || !payload.success) {
    const message =
      payload?.message || payload?.reason || 'Season data unavailable'
    throw new Error(message)
  }

  return payload
}

// Fallback until the timing API responds. Mirrors season-timing-service.ts
// (offset 10 plus the leading season-gap addend); keep in sync.
const FALLBACK_FIRST_START_MS = 1646128800000
const FALLBACK_CYCLE_MS = 1_209_600 * 1000
const FALLBACK_GAP_MS = 86_400 * 1000
const FALLBACK_OFFSET = 10
function computeFallbackStart(seasonNumber: number): number {
  return (
    FALLBACK_FIRST_START_MS +
    FALLBACK_GAP_MS +
    (seasonNumber + FALLBACK_OFFSET - 1) * FALLBACK_CYCLE_MS
  )
}

export function useSeasonData(
  guildCode?: string,
  options?: { enabled?: boolean }
) {
  const enabled = options?.enabled ?? Boolean(guildCode ?? true)

  const currentQuery = useBaseQuery({
    queryKey: ['season-data', guildCode ?? 'global', 'current'],
    queryFn: () =>
      fetchSeasonEndpoint('/api/assignments/current-season-bosses'),
    enabled,
    cacheDuration: 5 * 60 * 1000
  })

  const nextQuery = useBaseQuery({
    queryKey: ['season-data', guildCode ?? 'global', 'upcoming'],
    queryFn: () => fetchSeasonEndpoint('/api/assignments/next-season-bosses'),
    enabled,
    cacheDuration: 5 * 60 * 1000
  })

  const bossesSeasonNumber =
    typeof currentQuery.data?.seasonNumber === 'number'
      ? currentQuery.data.seasonNumber
      : null

  const timingQuery = useBaseQuery<SeasonTimingResponse>({
    queryKey: ['season-timing', bossesSeasonNumber ?? 'current'],
    queryFn: () =>
      fetch(
        bossesSeasonNumber !== null
          ? `/api/season/timing?season=${bossesSeasonNumber}`
          : '/api/season/timing'
      ).then((r) => {
        if (!r.ok) throw new Error('Failed to fetch season timing')
        return r.json()
      }),
    enabled: true,
    cacheDuration: 5 * 60 * 1000,
    retryCount: 1
  })

  const liveSeasonNumber =
    bossesSeasonNumber ??
    (typeof timingQuery.data?.seasonNumber === 'number'
      ? timingQuery.data.seasonNumber
      : null)

  const currentSeason = useMemo<Season | null>(() => {
    if (!currentQuery.data) return null

    const seasonNumber =
      typeof currentQuery.data.seasonNumber === 'number'
        ? currentQuery.data.seasonNumber
        : liveSeasonNumber
    if (seasonNumber === null) return null

    return {
      seasonNumber,
      configId:
        currentQuery.data.configId ?? currentQuery.data.currentConfigId ?? null,
      bosses: currentQuery.data.bosses ?? [],
      previewBosses: currentQuery.data.upcomingPreview ?? [],
      levels: currentQuery.data.levels ?? [],
      resolvedAt: currentQuery.data.resolvedAt ?? null
    }
  }, [currentQuery.data, liveSeasonNumber])

  const upcomingSeason = useMemo<Season | null>(() => {
    if (!nextQuery.data) return null

    const baseSeasonNumber =
      typeof nextQuery.data.seasonNumber === 'number'
        ? nextQuery.data.seasonNumber
        : (currentSeason?.seasonNumber ?? liveSeasonNumber)
    if (baseSeasonNumber === null) return null

    return {
      seasonNumber: baseSeasonNumber + 1,
      configId:
        nextQuery.data.nextConfigId ?? nextQuery.data.currentConfigId ?? null,
      bosses: nextQuery.data.bosses ?? [],
      previewBosses: nextQuery.data.futurePreview ?? [],
      levels: nextQuery.data.levels ?? [],
      resolvedAt: nextQuery.data.resolvedAt ?? null
    }
  }, [currentSeason?.seasonNumber, liveSeasonNumber, nextQuery.data])

  const rotation = useMemo<BossRotation[]>(() => {
    const entries: BossRotation[] = []
    if (currentSeason) {
      entries.push({
        kind: 'current',
        seasonNumber: currentSeason.seasonNumber,
        configId: currentSeason.configId ?? null,
        bosses: currentSeason.bosses,
        levels: currentSeason.levels,
        resolvedAt: currentSeason.resolvedAt ?? null
      })
    }

    if (upcomingSeason) {
      entries.push({
        kind: 'upcoming',
        seasonNumber: upcomingSeason.seasonNumber,
        configId: upcomingSeason.configId ?? null,
        bosses: upcomingSeason.bosses,
        levels: upcomingSeason.levels,
        resolvedAt: upcomingSeason.resolvedAt ?? null
      })
    }

    if (nextQuery.data?.futurePreview && upcomingSeason) {
      entries.push({
        kind: 'future',
        seasonNumber: upcomingSeason.seasonNumber + 1,
        configId: nextQuery.data.futureConfigId ?? null,
        bosses: nextQuery.data.futurePreview,
        levels: nextQuery.data.levels ?? [],
        resolvedAt: nextQuery.data.resolvedAt ?? null
      })
    }

    return entries
  }, [currentSeason, nextQuery.data, upcomingSeason])

  const resolvedSeasonNumber = currentSeason?.seasonNumber ?? liveSeasonNumber

  const [fallbackNow] = useState(() => Date.now())
  const seasonStart = timingQuery.data
    ? new Date(timingQuery.data.seasonStart)
    : new Date(
        resolvedSeasonNumber !== null && resolvedSeasonNumber > 0
          ? computeFallbackStart(resolvedSeasonNumber)
          : fallbackNow
      )
  const seasonEnd = timingQuery.data
    ? new Date(timingQuery.data.seasonEnd)
    : new Date(seasonStart.getTime() + 13 * 24 * 60 * 60 * 1000)
  const resolvedAt =
    currentSeason?.resolvedAt ?? nextQuery.data?.resolvedAt ?? null
  const resolvedAtMs = resolvedAt ? Date.parse(resolvedAt) : Number.NaN
  const nowMs = Number.isFinite(resolvedAtMs)
    ? resolvedAtMs
    : seasonStart.getTime()
  const totalMs = Math.max(0, seasonEnd.getTime() - seasonStart.getTime())
  const elapsedMs = Math.max(0, nowMs - seasonStart.getTime())
  const seasonProgress = totalMs > 0 ? Math.min(1, elapsedMs / totalMs) : 0
  const daysRemaining = Math.max(
    0,
    Math.ceil((seasonEnd.getTime() - nowMs) / (1000 * 60 * 60 * 24))
  )

  const refetch = async () => {
    await Promise.all([currentQuery.refetch(), nextQuery.refetch()])
  }

  return {
    currentSeason,
    upcomingSeason,
    rotation,
    seasonProgress,
    daysRemaining,
    isLoading: currentQuery.isLoading || nextQuery.isLoading,
    error: currentQuery.error ?? nextQuery.error ?? null,
    refetch
  }
}
