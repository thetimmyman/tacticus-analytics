// beta_tester fast lane; double-fires are safe (SKIP LOCKED claim plus per-minute dedupe_key).

import { createDirectClient } from '@/app/lib/network/direct-supabase'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { runHeraldFromDb } from '@/app/lib/herald/from-db'
import {
  createRestSharedSessionStore,
  ensureSharedLokiSession
} from '@/app/lib/loki/batch-session-refresh'
import { getSharedFetch } from '@/app/lib/network/undici-agent'
import { registerJobHandler } from './dispatcher'
import { softDeadlineFor } from './deadline'
import type { JobHandler } from './types'
import { coerceErrorMessage as getErrorMessage } from '@/app/lib/utils/error-message'

const logger = createComponentLogger('lib.jobs.guild-sync')

const STALE_THRESHOLD_MS = 30 * 1000
const GUILD_STAGGER_MAX_MS = 200
// Runaway guard, not a tuning knob: stalest-first plus the per-minute re-fire still converges.
const MAX_BETA_GUILDS_PER_RUN = 25

interface SyncFunctionResponse {
  success?: boolean
  error?: string
  stats?: {
    finalValidEntries?: number | null
  } | null
}

interface SyncResult {
  guild_code: string
  success: boolean
  entries?: number
  error?: string
  duration: number
}

const guildSyncHandler: JobHandler = async (_payload, ctx) => {
  const startTime = Date.now()

  try {
    const db = createDirectClient()

    const { data: betaGuilds, error: queryError } = await db.query<
      Array<{
        guild_code: string
        guild_id: string | null
        enabled: boolean
        auto_sync_enabled: boolean
        last_successful_sync: string | null
        consecutive_sync_failures: number | null
      }>
    >(
      `guild_config?select=guild_code,guild_id,enabled,auto_sync_enabled,last_successful_sync,consecutive_sync_failures&beta_tester=eq.true`
    )

    if (queryError) {
      throw new Error(`Failed to fetch beta-tester guilds: ${queryError}`)
    }

    if (!betaGuilds || betaGuilds.length === 0) {
      return {
        message: 'No beta-tester guilds to sync',
        durationMs: Date.now() - startTime
      }
    }

    const now = new Date()
    const needsSync = betaGuilds.filter((g) => {
      if (!g.enabled || !g.auto_sync_enabled) return false
      if ((g.consecutive_sync_failures ?? 0) >= 5) return false
      if (!g.last_successful_sync) return true
      const ageMs = now.getTime() - new Date(g.last_successful_sync).getTime()
      return ageMs >= STALE_THRESHOLD_MS
    })

    needsSync.sort((a, b) => {
      const aTime = a.last_successful_sync
        ? new Date(a.last_successful_sync).getTime()
        : 0
      const bTime = b.last_successful_sync
        ? new Date(b.last_successful_sync).getTime()
        : 0
      return aTime - bTime
    })
    const guildsToSync = needsSync.slice(0, MAX_BETA_GUILDS_PER_RUN)
    if (guildsToSync.length < needsSync.length) {
      logger.warn(
        {
          jobId: ctx.jobId,
          eligible: needsSync.length,
          capped: guildsToSync.length
        },
        '[GuildSync] guild cap truncated this tick; remainder syncs next fire'
      )
    }

    logger.info(
      {
        jobId: ctx.jobId,
        betaCount: betaGuilds.length,
        needsSync: needsSync.length,
        syncing: guildsToSync.length
      },
      '[GuildSync] starting'
    )

    if (needsSync.length === 0) {
      return {
        message: 'All beta-tester guilds are fresh',
        betaGuilds: betaGuilds.length,
        durationMs: Date.now() - startTime
      }
    }

    // The fan-out cannot wind down mid-flight, so if claimed past the soft deadline, defer to the next fire.
    const softDeadline = softDeadlineFor(
      startTime,
      Number.POSITIVE_INFINITY,
      ctx
    )
    if (Date.now() >= softDeadline) {
      logger.warn(
        { jobId: ctx.jobId, deferred: needsSync.length },
        '[GuildSync] claimed past worker tick soft deadline — deferring fan-out to next fire'
      )
      return {
        message: 'Deferred: claimed past worker tick soft deadline',
        deferred: needsSync.length,
        durationMs: Date.now() - startTime
      }
    }

    let sharedLokiSession: 'reused' | 'connected' | 'none' = 'none'
    let sharedLokiSessionId: string | null = null
    let sharedLokiSessionUserId: string | null = null
    try {
      const shared = await ensureSharedLokiSession({
        store: createRestSharedSessionStore({
          fetchImpl: getSharedFetch(),
          baseUrl:
            process.env.SUPABASE_URL ||
            process.env.NEXT_PUBLIC_SUPABASE_URL ||
            '',
          anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '',
          serviceKey: process.env.SUPABASE_SERVICE_ROLE_KEY || '',
          scraperUserId: process.env.LOKI_SCRAPER_USER_ID || ''
        }),
        // Only guilds with a guild_id reach LOKI, so only they can test the session.
        probeGuildId: guildsToSync.find((g) => g.guild_id)?.guild_id ?? null
      })
      sharedLokiSessionId = shared.sessionId
      sharedLokiSessionUserId = shared.userId
      if (shared.sessionId) {
        sharedLokiSession = shared.reused ? 'reused' : 'connected'
      } else if (shared.error) {
        logger.warn(
          { jobId: ctx.jobId, err: shared.error },
          '[GuildSync] no shared LOKI session this run; each guild refreshes its own'
        )
      }
    } catch (sessionError) {
      logger.warn(
        { jobId: ctx.jobId, err: getErrorMessage(sessionError) },
        '[GuildSync] shared LOKI session exception (non-fatal)'
      )
    }

    const results: SyncResult[] = await Promise.all(
      guildsToSync.map(async (guild, index) => {
        if (index > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * GUILD_STAGGER_MAX_MS)
          )
        }
        const guildStart = Date.now()

        try {
          const { data, error } = await db.invoke<SyncFunctionResponse>(
            'sync-modular-workflow',
            {
              guild_code: guild.guild_code,
              // Without it each guild refreshes a rejected session on its own.
              // The edge sends the session only as the account that minted it.
              ...(sharedLokiSessionId && sharedLokiSessionUserId
                ? {
                    fresh_session_id: sharedLokiSessionId,
                    fresh_session_user_id: sharedLokiSessionUserId
                  }
                : {})
            }
          )

          if (error) throw new Error(error)
          if (!data?.success)
            throw new Error(data?.error || 'Sync reported failure')

          const result: SyncResult = {
            guild_code: guild.guild_code,
            success: true,
            entries: data.stats?.finalValidEntries || 0,
            duration: Date.now() - guildStart
          }
          logger.info(
            {
              jobId: ctx.jobId,
              guildCode: guild.guild_code,
              entries: result.entries,
              durationMs: result.duration
            },
            '[GuildSync] guild synced'
          )

          try {
            const heraldSupabase = serviceDb()
            const heraldResult = await runHeraldFromDb({
              supabase: heraldSupabase,
              guildCode: guild.guild_code
            })
            if (
              heraldResult.detected > 0 ||
              heraldResult.availability_detected > 0
            ) {
              logger.info(
                {
                  jobId: ctx.jobId,
                  guildCode: guild.guild_code,
                  defeats: `${heraldResult.detected}/${heraldResult.posted}`,
                  available: `${heraldResult.availability_detected}/${heraldResult.availability_posted}`,
                  dedup:
                    heraldResult.deduped + heraldResult.availability_deduped
                },
                '[GuildSync] Herald run'
              )
            }
          } catch (heraldErr) {
            logger.warn(
              {
                jobId: ctx.jobId,
                guildCode: guild.guild_code,
                err: getErrorMessage(heraldErr)
              },
              '[GuildSync] Herald crashed (non-fatal)'
            )
          }
          return result
        } catch (err) {
          const result: SyncResult = {
            guild_code: guild.guild_code,
            success: false,
            error: getErrorMessage(err),
            duration: Date.now() - guildStart
          }
          logger.warn(
            {
              jobId: ctx.jobId,
              guildCode: guild.guild_code,
              err: result.error
            },
            '[GuildSync] guild sync failed'
          )
          return result
        }
      })
    )

    const successful = results.filter((r) => r.success).length
    const totalEntries = results.reduce((sum, r) => sum + (r.entries || 0), 0)
    const totalDuration = Date.now() - startTime

    logger.info(
      {
        jobId: ctx.jobId,
        successful,
        total: results.length,
        totalEntries,
        durationMs: totalDuration
      },
      '[GuildSync] complete'
    )

    return {
      betaGuilds: betaGuilds.length,
      eligible: needsSync.length,
      synced: results.length,
      successful,
      failed: results.length - successful,
      totalEntries,
      durationMs: totalDuration,
      lokiSharedSession: sharedLokiSession
    }
  } catch (error) {
    rethrowIfAppError(error)
    const message = getErrorMessage(error)
    captureSentryException(error, {
      tags: { handler: 'guild-sync', jobId: String(ctx.jobId) }
    })
    logger.error(
      { jobId: ctx.jobId, err: message },
      '[GuildSync] handler failed'
    )
    throw error
  }
}

export function registerGuildSyncHandler(): void {
  // Must match the pg_cron enqueue key; rename both together.
  registerJobHandler('premium-guild-sync', guildSyncHandler)
}

export const __internal = {
  guildSyncHandler
}
