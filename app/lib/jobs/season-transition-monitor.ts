// Backfills each ended season for every active guild, then advances season_tracking (idempotent).

import { createDirectClient } from '@/app/lib/network/direct-supabase'
import { getSeasonTiming } from '@/app/lib/services/season-timing-service'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { createComponentLogger } from '@/app/lib/logging'
import { registerJobHandler } from './dispatcher'
import { softDeadlineFor } from './deadline'
import type { JobHandler } from './types'
import { coerceErrorMessage as getErrorMessage } from '@/app/lib/utils/error-message'

const logger = createComponentLogger('lib.jobs.season-transition-monitor')

interface GuildBackfillResult {
  guild_code: string
  success: boolean
  totalInserted: number
  error?: string
}

interface BackfillResult {
  season: number
  success: boolean
  guildsProcessed: number
  totalInserted: number
  failures: string[]
  executionTimeMs: number
}

interface SeasonTrackingRow {
  id: number
  last_tracked_season: number
  last_check_date: string
  updated_at?: string
}

interface HealthCheckResult {
  healthScore: number
  healthyGuilds: number
  totalActiveGuilds: number
  guildsNeedingAttention: number
  criticalIssues: boolean
}

const BACKFILL_CONCURRENCY = 5
const MAX_BACKFILL_MS = 270_000

async function performHealthCheck(): Promise<HealthCheckResult> {
  try {
    const db = createDirectClient()
    const { data: guilds } = await db.query<
      Array<{
        guild_code: string
        last_successful_sync: string
        auto_sync_enabled: boolean
        enabled: boolean
      }>
    >(
      'guild_config?select=guild_code,last_successful_sync,auto_sync_enabled,enabled&enabled=eq.true'
    )

    const now = new Date()
    const STALE_THRESHOLD = 12 * 60 * 60 * 1000

    const healthyGuilds = (guilds || []).filter((g) => {
      if (!g.auto_sync_enabled || !g.last_successful_sync) return false
      const ageMs = now.getTime() - new Date(g.last_successful_sync).getTime()
      return ageMs < STALE_THRESHOLD
    }).length

    const totalActiveGuilds = (guilds || []).filter(
      (g) => g.auto_sync_enabled
    ).length
    const healthScore =
      totalActiveGuilds > 0
        ? Math.round((healthyGuilds / totalActiveGuilds) * 100)
        : 100

    const staleGuilds = (guilds || []).filter((g) => {
      if (!g.auto_sync_enabled || !g.last_successful_sync) return false
      const ageMs = now.getTime() - new Date(g.last_successful_sync).getTime()
      return ageMs >= STALE_THRESHOLD
    })

    return {
      healthScore,
      healthyGuilds,
      totalActiveGuilds,
      guildsNeedingAttention: staleGuilds.length,
      criticalIssues: staleGuilds.length > totalActiveGuilds * 0.2
    }
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: getErrorMessage(error) }, 'Health check failed')
    return {
      healthScore: 0,
      healthyGuilds: 0,
      totalActiveGuilds: 0,
      guildsNeedingAttention: 999,
      criticalIssues: true
    }
  }
}

const seasonTransitionMonitorHandler: JobHandler = async (_payload, ctx) => {
  const startTime = Date.now()
  const softDeadline = softDeadlineFor(startTime, MAX_BACKFILL_MS, ctx)
  const db = createDirectClient()

  const currentSeason = (await getSeasonTiming()).seasonNumber

  const { data: trackingRows, error: trackingError } = await db.query<
    SeasonTrackingRow[]
  >('season_tracking?select=*&order=id.desc&limit=1')

  if (trackingError) {
    throw new Error(`Failed to fetch season tracking: ${trackingError}`)
  }

  const trackingData = trackingRows?.[0] ?? null
  const lastTrackedSeason =
    trackingData?.last_tracked_season || currentSeason - 1

  logger.info(
    {
      jobId: ctx.jobId,
      currentSeason,
      lastTrackedSeason
    },
    'season-transition-monitor: tracking comparison'
  )

  if (currentSeason <= lastTrackedSeason) {
    const healthCheck = await performHealthCheck()
    return {
      transitionDetected: false,
      currentSeason,
      lastTrackedSeason,
      healthCheck: {
        healthScore: healthCheck.healthScore,
        guildsNeedingAttention: healthCheck.guildsNeedingAttention,
        criticalIssues: healthCheck.criticalIssues
      },
      durationMs: Date.now() - startTime
    }
  }

  // The cursor is the last observed *current* season, so the range includes it.
  const previousSeasons: number[] = []
  for (let season = lastTrackedSeason; season < currentSeason; season++) {
    if ((await getSeasonTiming(season)).hasEnded) {
      previousSeasons.push(season)
    }
  }

  logger.info(
    {
      jobId: ctx.jobId,
      currentSeason,
      previousSeasons
    },
    'season-transition-monitor: new season transition detected'
  )

  const { data: activeGuilds, error: activeGuildsError } = await db.query<
    Array<{ guild_code: string }>
  >('guild_config?select=guild_code&enabled=eq.true&auto_sync_enabled=eq.true')

  // Treating this as "no guilds" would advance the cursor over zero coverage.
  if (activeGuildsError) {
    throw new Error(`Failed to fetch active guilds: ${activeGuildsError}`)
  }

  const guildCodes = (activeGuilds || []).map((g) => g.guild_code)

  const backfillResults: BackfillResult[] = []

  let timeBudgetExhausted = false

  for (const season of previousSeasons) {
    if (timeBudgetExhausted) {
      logger.warn(
        {
          jobId: ctx.jobId,
          season,
          skippedSeasons: previousSeasons.slice(previousSeasons.indexOf(season))
        },
        'season-transition-monitor: skipping season entirely — total job budget exhausted by earlier season(s)'
      )
      backfillResults.push({
        season,
        success: false,
        guildsProcessed: 0,
        totalInserted: 0,
        failures: [
          'Skipped: total job time budget exhausted by earlier season(s)'
        ],
        executionTimeMs: 0
      })
      continue
    }

    const seasonStart = Date.now()
    const guildResults: GuildBackfillResult[] = []
    let seasonHitTimeout = false

    for (let i = 0; i < guildCodes.length; i += BACKFILL_CONCURRENCY) {
      if (Date.now() >= softDeadline) {
        logger.warn(
          {
            jobId: ctx.jobId,
            processed: guildResults.length,
            remaining: guildCodes.length - i,
            season
          },
          'season-transition-monitor: soft deadline reached mid-season, stopping early'
        )
        seasonHitTimeout = true
        timeBudgetExhausted = true
        break
      }

      const batch = guildCodes.slice(i, i + BACKFILL_CONCURRENCY)
      const batchResults = await Promise.allSettled(
        batch.map(async (guild_code) => {
          const { data, error } = await db.invoke(
            'historical-backfill-modular',
            { guild_code, force_seasons: [season] }
          )
          if (error) throw new Error(error)
          const responseData = data as {
            success?: boolean
            error?: string
            stats?: { totalInserted?: number }
            results?: Array<{
              season?: number
              success?: boolean
              error?: string
            }>
          } | null
          // HTTP 200 can still carry per-season failures in `results`.
          const failedSeasons = (responseData?.results ?? []).filter(
            (r) => r.success === false
          )
          const nestedFailureDetail =
            failedSeasons.length > 0
              ? failedSeasons
                  .map(
                    (r) =>
                      `season ${r.season ?? season}: ${r.error ?? 'failed'}`
                  )
                  .join('; ')
              : undefined
          const failureDetail = responseData?.error || nestedFailureDetail
          const guildResult: GuildBackfillResult = {
            guild_code,
            success:
              responseData?.success === true &&
              failedSeasons.length === 0 &&
              !responseData?.error,
            totalInserted: responseData?.stats?.totalInserted || 0
          }
          if (failureDetail) guildResult.error = failureDetail
          return guildResult
        })
      )

      for (const [j, settled] of batchResults.entries()) {
        const guild_code = batch[j]
        if (!guild_code) continue
        if (settled.status === 'fulfilled') {
          guildResults.push(settled.value)
        } else {
          guildResults.push({
            guild_code,
            success: false,
            totalInserted: 0,
            error: getErrorMessage(settled.reason)
          })
        }
      }
    }

    const successful = guildResults.filter((r) => r.success)
    const failed = guildResults.filter((r) => !r.success)
    const totalInserted = guildResults.reduce(
      (sum, r) => sum + r.totalInserted,
      0
    )

    backfillResults.push({
      season,
      success: failed.length === 0 && !seasonHitTimeout,
      guildsProcessed: guildResults.length,
      totalInserted,
      failures: failed.map(
        (f) =>
          `${f.guild_code}: ${f.error ?? 'reported failure without detail'}`
      ),
      executionTimeMs: Date.now() - seasonStart
    })

    logger.info(
      {
        jobId: ctx.jobId,
        season,
        successful: successful.length,
        total: guildResults.length,
        totalInserted,
        failures: failed.length,
        partialDueToTimeout: seasonHitTimeout
      },
      'season-transition-monitor: season backfill complete'
    )
  }

  const now = new Date().toISOString()
  // Fail closed: advance only when every season succeeded, or a failed season is skipped forever.
  const allSeasonsComplete = backfillResults.every((r) => r.success)
  const nextTrackedSeason =
    timeBudgetExhausted || !allSeasonsComplete
      ? lastTrackedSeason
      : currentSeason
  if (trackingData) {
    const { error: cursorError } = await db.mutate(
      `season_tracking?id=eq.${trackingData.id}`,
      'PATCH',
      {
        last_tracked_season: nextTrackedSeason,
        last_check_date: now,
        updated_at: now
      }
    )
    if (cursorError) {
      throw new Error(`Failed to persist season cursor (PATCH): ${cursorError}`)
    }
  } else {
    const { error: cursorError } = await db.mutate('season_tracking', 'POST', {
      last_tracked_season: nextTrackedSeason,
      last_check_date: now
    })
    if (cursorError) {
      throw new Error(`Failed to persist season cursor (POST): ${cursorError}`)
    }
  }

  const healthCheck = await performHealthCheck()
  const totalInserted = backfillResults.reduce(
    (sum, r) => sum + r.totalInserted,
    0
  )

  return {
    transitionDetected: true,
    currentSeason,
    previousSeason: lastTrackedSeason,
    seasonsBackfilled: previousSeasons,
    totalEntriesAdded: totalInserted,
    backfillResults: backfillResults.map((r) => ({
      season: r.season,
      success: r.success,
      guildsProcessed: r.guildsProcessed,
      entriesAdded: r.totalInserted,
      failures: r.failures
    })),
    healthCheck: {
      healthScore: healthCheck.healthScore,
      guildsNeedingAttention: healthCheck.guildsNeedingAttention,
      criticalIssues: healthCheck.criticalIssues
    },
    durationMs: Date.now() - startTime
  }
}

export function registerSeasonTransitionMonitorHandler(): void {
  registerJobHandler(
    'season-transition-monitor',
    seasonTransitionMonitorHandler
  )
}

export const __internal = {
  seasonTransitionMonitorHandler,
  performHealthCheck
}
