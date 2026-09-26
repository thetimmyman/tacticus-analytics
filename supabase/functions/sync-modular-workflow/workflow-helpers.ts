import type { LokiSeasonTimingConstants } from '../_shared/loki-build-version.ts'

// One shared implementation: the dedup suffix is a load-bearing join key.
export { disambiguateDuplicateDisplayNames } from '../_shared/display-name-dedup.ts'

// The API reports the rolled-over season number (app/lib/loki/season-configs.ts).
const SEASON_NUMBER_OFFSET = 10

export interface LokiMember {
  userId: string
  displayName: string
  role: string
  originalDisplayName?: string
  hasDuplicateName?: boolean
}

export function computeSeasonWindow(
  season: number | null,
  constants: LokiSeasonTimingConstants
): { startsAtIso: string; endsAtIso: string } | null {
  if (season == null || !Number.isFinite(season) || season <= 0) return null
  const cycleMs = constants.seasonCycleSeconds * 1000
  const gapMs = constants.seasonGapSeconds * 1000
  const activeMs = Math.max(0, cycleMs - gapMs)
  if (cycleMs <= 0 || activeMs <= 0) return null

  // +gapMs: LOKI's firstSeasonStart sits one gap before in-game S1.
  const seasonsElapsed = season + SEASON_NUMBER_OFFSET - 1
  const startMs =
    constants.firstSeasonStartMs + gapMs + seasonsElapsed * cycleMs
  const endMs = startMs + activeMs
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null

  return {
    startsAtIso: new Date(startMs).toISOString(),
    endsAtIso: new Date(endMs).toISOString()
  }
}

export function assessSeasonRetention(
  seasons: number[],
  currentSeason: number,
  minimumRequired: number,
  maximumRetained: number
) {
  const uniqueSeasons = [...new Set(seasons)].sort((a, b) => b - a)
  const seasonCount = uniqueSeasons.length
  const missingSeasons: number[] = []

  // Row presence in older seasons does not cover holes in recent history.
  const lookbackStart = Math.max(
    1,
    currentSeason - Math.min(minimumRequired, maximumRetained)
  )
  for (let season = currentSeason - 1; season >= lookbackStart; season--) {
    if (!uniqueSeasons.includes(season)) missingSeasons.push(season)
  }

  return {
    seasonCount,
    needsBackfill: missingSeasons.length > 0,
    missingSeasons
  }
}

interface SyncMetrics {
  elapsed: number
  remaining: number
  progress: number
  shouldTerminate: boolean
}

export interface SyncCompletionInput {
  correlationId: string
  season: number | null
  startedAt: number
  lockAcquireStarted: number
  lockAcquiredAt: number
  rawEntries: number
  droppedEntries: number
  validEntries: number
  processedEntries: number
  upsertedEntries: number
  insertedEntries: number
  updatedEntries: number
  errorEntries: number
  bombEntries: number
  lokiMappingsRefreshed: boolean
}

export function buildSyncCompletion(
  input: SyncCompletionInput,
  metrics: SyncMetrics
) {
  const lockWaitMs =
    input.lockAcquireStarted && input.lockAcquiredAt
      ? Math.max(0, input.lockAcquiredAt - input.lockAcquireStarted)
      : 0

  return {
    summary: {
      correlation_id: input.correlationId,
      season: input.season,
      elapsed_ms: metrics.elapsed,
      remaining_ms: metrics.remaining,
      entries_fetched: input.rawEntries,
      entries_dropped: input.droppedEntries,
      entries_valid: input.validEntries,
      entries_processed: input.processedEntries,
      entries_upserted: input.upsertedEntries,
      entries_inserted: input.insertedEntries,
      entries_updated: input.updatedEntries,
      error_entries: input.errorEntries,
      bomb_entries: input.bombEntries,
      lock_wait_ms: lockWaitMs,
      loki_mappings_refreshed: input.lokiMappingsRefreshed,
      started_at: input.startedAt
    },
    execution: {
      elapsed_ms: metrics.elapsed,
      remaining_ms: metrics.remaining,
      progress_percent: Math.round(metrics.progress * 100),
      early_termination: metrics.shouldTerminate
    },
    warnings: [
      input.rawEntries === 0
        ? 'Sync health: no entries fetched (possible lockout window)'
        : null,
      input.droppedEntries > 0
        ? `Sync health: dropped entries detected (${input.droppedEntries})`
        : null,
      input.errorEntries > 0
        ? `Sync health: errors during upsert (${input.errorEntries})`
        : null,
      lockWaitMs > 5000
        ? `Sync health: lock wait high (${lockWaitMs}ms)`
        : null,
      metrics.remaining < metrics.elapsed * 0.2
        ? `Sync health: timeout budget low (remaining ${metrics.remaining}ms)`
        : null
    ].filter((warning): warning is string => warning !== null)
  }
}
