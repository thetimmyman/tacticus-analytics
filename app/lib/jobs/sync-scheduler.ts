// Direct PostgREST: the SDK hangs in long-running jobs.

import { createDirectClient } from '@/app/lib/network/direct-supabase'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { registerJobHandler } from './dispatcher'
import type { JobHandler } from './types'
import { coerceErrorMessage as getErrorMessage } from '@/app/lib/utils/error-message'

const logger = createComponentLogger('lib.jobs.sync-scheduler')

const VALIDATION_BATCH_SIZE = 50
const VALIDATION_BATCH_DELAY_MS = 100
const MAX_VALIDATION_BATCHES = 1000
const VALIDATION_HOUR_UTC = 6

interface GuildSyncStatusRow {
  last_sync: string | null
  status?: string | null
  full_sync_at: string | null
}

interface SyncHealthRow {
  health_status?: string | null
  consecutive_failures?: number | null
  data_freshness_hours?: number | null
  last_failed_sync?: string | null
}

interface ActiveRealtimeJobRow {
  guild_code: string | null
  status: string | null
  attempts: number | null
  max_attempts: number | null
}

// At most one active row per guild (unique_active_job), so this read stays small.
const ACTIVE_REALTIME_JOBS_PATH =
  'sync_queue?select=guild_code,status,attempts,max_attempts&job_type=eq.realtime_sync&status=in.(pending,processing)'

/** Guilds whose realtime_sync is still claimable; empty on a read failure, so scheduling fails open. */
async function loadGuildsWithActiveRealtime(
  db: ReturnType<typeof createDirectClient>,
  jobId: number
): Promise<Set<string>> {
  const { data, error } = await db.query<ActiveRealtimeJobRow[]>(
    ACTIVE_REALTIME_JOBS_PATH
  )
  const guilds = new Set<string>()
  if (error || !Array.isArray(data)) {
    logger.warn(
      { jobId, err: error },
      'could not read active realtime jobs; incremental syncs are not deferred this run'
    )
    return guilds
  }
  for (const row of data) {
    if (!row.guild_code) continue
    // Mirrors claim_next_job: a pending row at max_attempts is never claimed.
    const claimable =
      row.status === 'processing' ||
      (row.status === 'pending' &&
        typeof row.attempts === 'number' &&
        typeof row.max_attempts === 'number' &&
        row.attempts < row.max_attempts)
    if (claimable) guilds.add(row.guild_code)
  }
  return guilds
}

interface GuildRow {
  guild_code: string
  enabled: boolean
  last_successful_sync: string | null
  guild_sync_status: GuildSyncStatusRow | GuildSyncStatusRow[] | null
  sync_health: SyncHealthRow | SyncHealthRow[] | null
}

const syncSchedulerHandler: JobHandler = async (_payload, ctx) => {
  const startTime = Date.now()

  try {
    const db = createDirectClient()

    const guildSelect =
      'guild_code,enabled,last_successful_sync,guild_sync_status!inner(last_sync,status,full_sync_at),sync_health(health_status,consecutive_failures,data_freshness_hours,last_failed_sync)'
    const guildPath = `guild_config?select=${guildSelect}&enabled=eq.true&api_key_encrypted=not.is.null&api_key_is_valid=not.is.false`

    const { data: guilds, error: guildsError } =
      await db.query<GuildRow[]>(guildPath)

    if (guildsError || !guilds) {
      throw new Error(`Failed to fetch guilds: ${guildsError ?? 'no data'}`)
    }

    const results = {
      realtime_sync: 0,
      incremental_sync: 0,
      full_sync: 0,
      validation_sync: 0,
      player_sync: 0,
      total: 0
    }
    let validationIncomplete = false
    let incrementalDeferred = 0

    // Realtime and incremental syncs replay the same season snapshot, so an
    // incremental queued behind a guild's pending realtime (lower priority) only waits and ages the queue.
    const guildsWithActiveRealtime = await loadGuildsWithActiveRealtime(
      db,
      ctx.jobId
    )

    const now = new Date()

    for (const guild of guilds) {
      const syncStatusRow = Array.isArray(guild.guild_sync_status)
        ? guild.guild_sync_status[0]
        : guild.guild_sync_status
      // Two clocks: last_sync (any attempt) only throttles retries;
      // last_successful_sync alone decides freshness, so failing guilds never look fresh.
      const lastAttempt = syncStatusRow?.last_sync
        ? new Date(syncStatusRow.last_sync)
        : null
      const lastSuccess = guild.last_successful_sync
        ? new Date(guild.last_successful_sync)
        : null
      const fullSyncAt = syncStatusRow?.full_sync_at
        ? new Date(syncStatusRow.full_sync_at)
        : null
      const health = Array.isArray(guild.sync_health)
        ? guild.sync_health[0]
        : guild.sync_health

      const consecutiveFailures = health?.consecutive_failures ?? 0
      if (consecutiveFailures >= 5) {
        const cooldownMinutes = consecutiveFailures >= 10 ? 120 : 30
        const lastFailed = health?.last_failed_sync
          ? new Date(health.last_failed_sync)
          : null
        if (
          lastFailed &&
          now.getTime() - lastFailed.getTime() < cooldownMinutes * 60 * 1000
        ) {
          continue
        }
      }

      const minutesSinceAttempt = lastAttempt
        ? (now.getTime() - lastAttempt.getTime()) / (1000 * 60)
        : Infinity
      const minutesSinceSync = lastSuccess
        ? (now.getTime() - lastSuccess.getTime()) / (1000 * 60)
        : Infinity
      const hoursSinceFullSync = fullSyncAt
        ? (now.getTime() - fullSyncAt.getTime()) / (1000 * 60 * 60)
        : Infinity

      let jobType: string | null = null
      let priority = 5

      if (minutesSinceAttempt < 5) {
        continue
      }

      if (health?.health_status === 'critical' || consecutiveFailures >= 5) {
        jobType = 'validation_sync'
        priority = 1
        logger.warn(
          { jobId: ctx.jobId, guild: guild.guild_code },
          'critical health status, scheduling validation sync'
        )
      } else if (hoursSinceFullSync >= 24) {
        jobType = 'full_sync'
        priority = 7
      } else if (minutesSinceSync >= 360) {
        jobType = 'player_sync'
        priority = 8
      } else if (minutesSinceSync >= 5 && minutesSinceSync < 15) {
        jobType = 'realtime_sync'
        priority = 3
      } else if (minutesSinceSync >= 15) {
        if (guildsWithActiveRealtime.has(guild.guild_code)) {
          incrementalDeferred++
          continue
        }
        jobType = 'incremental_sync'
        priority = 5
      }

      if (jobType) {
        const { data: jobId, error: enqueueError } = await db.rpc<
          string | number
        >('enqueue_sync', {
          p_guild_code: guild.guild_code,
          p_job_type: jobType,
          p_priority: priority,
          p_scheduled_for: now.toISOString()
        })

        if (!enqueueError && jobId) {
          results[jobType as keyof typeof results]++
          results.total++
        } else if (enqueueError) {
          logger.error(
            { jobId: ctx.jobId, guild: guild.guild_code, err: enqueueError },
            'failed to enqueue job'
          )
        }
      }
    }

    if (now.getUTCHours() !== VALIDATION_HOUR_UTC) {
      logger.debug(
        {
          jobId: ctx.jobId,
          currentHourUTC: now.getUTCHours(),
          expectedHourUTC: VALIDATION_HOUR_UTC
        },
        'skipping daily validation pass — handler ran outside 06:xx UTC window'
      )
    } else {
      logger.info(
        { jobId: ctx.jobId },
        'starting daily 06:xx UTC validation pass'
      )
      let offset = 0
      let hasMore = true
      let batchCount = 0

      while (hasMore) {
        if (batchCount >= MAX_VALIDATION_BATCHES) {
          logger.error(
            { jobId: ctx.jobId, batchCount, offset },
            'validation pagination hit MAX_VALIDATION_BATCHES — aborting possible runaway; marking pass incomplete'
          )
          validationIncomplete = true
          break
        }
        batchCount++
        const path = `guild_config?select=guild_code&enabled=eq.true&api_key_encrypted=not.is.null&api_key_is_valid=not.is.false&order=guild_code.asc&offset=${offset}&limit=${VALIDATION_BATCH_SIZE}`
        const { data: batchGuilds, error: batchError } =
          await db.query<{ guild_code: string }[]>(path)

        if (batchError) {
          logger.error(
            { jobId: ctx.jobId, err: batchError },
            'failed to fetch guilds for validation sync'
          )
          validationIncomplete = true
          break
        }

        if (!batchGuilds || batchGuilds.length === 0) {
          hasMore = false
          break
        }

        for (const guild of batchGuilds) {
          const { error: enqueueError } = await db.rpc('enqueue_sync', {
            p_guild_code: guild.guild_code,
            p_job_type: 'validation_sync',
            p_priority: 9,
            p_scheduled_for: now.toISOString()
          })

          if (enqueueError) {
            logger.error(
              { jobId: ctx.jobId, guild: guild.guild_code, err: enqueueError },
              'failed to enqueue validation sync'
            )
          } else {
            results.validation_sync++
            results.total++
          }
        }

        offset += VALIDATION_BATCH_SIZE
        hasMore = batchGuilds.length === VALIDATION_BATCH_SIZE

        if (hasMore) {
          await new Promise((resolve) =>
            setTimeout(resolve, VALIDATION_BATCH_DELAY_MS)
          )
        }
      }
    }

    const totalDuration = Date.now() - startTime

    logger[validationIncomplete ? 'warn' : 'info'](
      {
        jobId: ctx.jobId,
        guildsChecked: guilds.length,
        scheduled: results.total,
        breakdown: results,
        incrementalDeferred,
        validationIncomplete,
        durationMs: totalDuration
      },
      validationIncomplete
        ? 'sync-scheduler complete (validation pass INCOMPLETE — see earlier error)'
        : 'sync-scheduler complete'
    )

    return {
      guildsChecked: guilds.length,
      scheduled: results.total,
      breakdown: results,
      incrementalDeferred,
      validationIncomplete,
      durationMs: totalDuration
    }
  } catch (error) {
    rethrowIfAppError(error)
    const message = getErrorMessage(error)
    captureSentryException(error, {
      tags: { handler: 'sync-scheduler', jobId: String(ctx.jobId) }
    })
    logger.error(
      { jobId: ctx.jobId, err: message },
      'sync-scheduler handler failed'
    )
    throw error
  }
}

export function registerSyncSchedulerHandler(): void {
  registerJobHandler('sync-scheduler', syncSchedulerHandler)
}

export const __internal = {
  syncSchedulerHandler
}
