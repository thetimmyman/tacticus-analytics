// Current season every run; the 2 older seasons only on each UTC hour's first run. Direct
// PostgREST: the SDK's Promise chain hangs in long-running App Router contexts.

import { createDirectClient } from '@/app/lib/network/direct-supabase'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'
import { coerceErrorMessage as getErrorMessage } from '@/app/lib/utils/error-message'

const logger = createComponentLogger('lib.jobs.refresh-meta-atlas')

const SEASONS_TO_REFRESH = 3

interface SeasonRefreshResult {
  season: string
  rows_inserted: number
  duration_ms: number
  error?: string
}

const createRefreshMetaAtlasHandler =
  (now: () => Date): JobHandler =>
  async (_payload, ctx) => {
    const startTime = Date.now()

    try {
      const scheduledMinute = now().getUTCMinutes()
      const db = createDirectClient()

      const { data: latestSeasonData, error: seasonError } =
        await db.rpc<string>('get_latest_season')

      if (seasonError || !latestSeasonData) {
        throw new Error(
          `Failed to get latest season: ${seasonError || 'no data'}`
        )
      }

      const latestSeason = parseInt(latestSeasonData, 10)
      if (isNaN(latestSeason)) {
        throw new Error(`Invalid season format: ${latestSeasonData}`)
      }

      const allSeasonsToRefresh: string[] = []
      for (let i = 0; i < SEASONS_TO_REFRESH; i++) {
        allSeasonsToRefresh.push((latestSeason - i).toString())
      }
      const refreshHistoricalSeasons = scheduledMinute < 15
      const seasonsToRefresh = refreshHistoricalSeasons
        ? allSeasonsToRefresh
        : allSeasonsToRefresh.slice(0, 1)
      const skippedSeasons = refreshHistoricalSeasons
        ? []
        : allSeasonsToRefresh.slice(1)

      logger.info(
        {
          jobId: ctx.jobId,
          seasons: seasonsToRefresh,
          skippedSeasons
        },
        '[MetaAtlasRefresh] starting'
      )

      const results: SeasonRefreshResult[] = []

      for (const season of seasonsToRefresh) {
        const seasonStartTime = Date.now()

        try {
          const { data, error } = await db.rpc<
            Array<{ rows_affected?: number }>
          >('refresh_meta_atlas_season', { p_season: season })

          if (error) {
            logger.warn(
              { jobId: ctx.jobId, season, err: error },
              '[MetaAtlasRefresh] season refresh failed'
            )
            results.push({
              season,
              rows_inserted: 0,
              duration_ms: Date.now() - seasonStartTime,
              error
            })
            continue
          }

          const rowsInserted = data?.[0]?.rows_affected ?? 0
          results.push({
            season,
            rows_inserted: rowsInserted,
            duration_ms: Date.now() - seasonStartTime
          })
        } catch (err) {
          const message = getErrorMessage(err)
          logger.warn(
            { jobId: ctx.jobId, season, err: message },
            '[MetaAtlasRefresh] season exception'
          )
          results.push({
            season,
            rows_inserted: 0,
            duration_ms: Date.now() - seasonStartTime,
            error: message
          })
        }
      }

      const totalDuration = Date.now() - startTime
      const successful = results.filter((r) => !r.error).length
      const totalRows = results.reduce((sum, r) => sum + r.rows_inserted, 0)

      logger.info(
        {
          jobId: ctx.jobId,
          successful,
          total: results.length,
          totalRows,
          durationMs: totalDuration
        },
        '[MetaAtlasRefresh] complete'
      )

      return {
        status: successful === results.length ? 'ok' : 'partial',
        latestSeason: latestSeasonData,
        seasonsProcessed: results.length,
        successful,
        failed: results.length - successful,
        totalRowsInserted: totalRows,
        durationMs: totalDuration,
        skippedSeasons,
        results
      }
    } catch (error) {
      rethrowIfAppError(error)
      const message = getErrorMessage(error)
      captureSentryException(error, {
        tags: { handler: 'refresh-meta-atlas', jobId: String(ctx.jobId) }
      })
      logger.error(
        { jobId: ctx.jobId, err: message },
        '[MetaAtlasRefresh] handler failed'
      )
      throw error
    }
  }

const refreshMetaAtlasHandler = createRefreshMetaAtlasHandler(() => new Date())

export function registerRefreshMetaAtlasHandler(): void {
  registerJobHandler('refresh-meta-atlas', refreshMetaAtlasHandler)
}

export const __internal = {
  createRefreshMetaAtlasHandler
}
