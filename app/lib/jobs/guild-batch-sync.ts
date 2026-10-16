// One shared LOKI session for all guilds, reused while the game accepts it, then staggered per-guild edge syncs.
// Raw fetch: the Supabase SDK hangs in long-running handlers.

import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { getSharedFetch } from '@/app/lib/network/undici-agent'
import {
  createRestSharedSessionStore,
  ensureSharedLokiSession
} from '@/app/lib/loki/batch-session-refresh'
import { registerJobHandler } from './dispatcher'
import { softDeadlineFor } from './deadline'
import type { JobHandler } from './types'
import { coerceErrorMessage as getErrorMessage } from '@/app/lib/utils/error-message'

const logger = createComponentLogger('lib.jobs.guild-batch-sync')

interface SyncResult {
  guild_code: string
  success: boolean
  entries?: number
  error?: string
  duration: number
}

interface SyncFunctionResponse {
  success?: boolean
  error?: string
  stats?: {
    finalValidEntries?: number | null
  } | null
}

interface GuildConfigRow {
  guild_code: string
  guild_id?: string | null
  auto_sync_enabled: boolean | null
  consecutive_sync_failures: number | null
  last_successful_sync: string | null
  sync_tier?: string | null
}

const TIER_STALE_THRESHOLDS: Record<string, number> = {
  active: 1 * 60 * 60 * 1000,
  warm: 4 * 60 * 60 * 1000,
  dormant: 12 * 60 * 60 * 1000
}

const MAX_GUILDS_PER_RUN = 100
const HEAL_HOUR_UTC = 6
const MAX_HEAL_GUILDS_PER_RUN = 100
// Shared with the healing lane, which must pick up every guild dropped here.
const MAX_CONSECUTIVE_FAILURES = 5
const BATCH_SIZE = 8
const BATCH_DELAY_BASE = 1500
const BATCH_DELAY_JITTER = 500
const GUILD_STAGGER_MAX = 300

const REALTIME_STALE_THRESHOLD_MS = 90 * 1000

const guildBatchSyncHandler: JobHandler = async (payload, ctx) => {
  const startTime = Date.now()
  const realtimeOnly =
    (payload as { realtimeOnly?: boolean } | null | undefined)?.realtimeOnly ===
    true
  const softDeadline = softDeadlineFor(startTime, Number.POSITIVE_INFINITY, ctx)
  try {
    const directFetch = getSharedFetch()
    const internalUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || ''
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || ''

    if (!internalUrl || !serviceKey || !anonKey) {
      throw new Error(
        'SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY missing'
      )
    }

    let sharedLokiSession: 'reused' | 'connected' | 'none' = 'none'
    let sharedLokiSessionId: string | null = null
    let sharedLokiSessionUserId: string | null = null

    // `not.is.false` keeps unvalidated (null) keys.
    const guildResp = await directFetch(
      `${internalUrl}/rest/v1/guild_config?select=guild_code,guild_id,auto_sync_enabled,consecutive_sync_failures,last_successful_sync,sync_tier&enabled=eq.true&api_key_is_valid=not.is.false${realtimeOnly ? '&realtime_sync=eq.true' : ''}&order=guild_code`,
      {
        method: 'GET',
        headers: {
          apikey: anonKey,
          Authorization: `Bearer ${serviceKey}`,
          'Content-Type': 'application/json'
        }
      }
    )
    if (!guildResp.ok) {
      const errText = await guildResp.text()
      throw new Error(
        `Failed to fetch guild_config: HTTP ${guildResp.status}: ${errText}`
      )
    }
    const guilds: GuildConfigRow[] = await guildResp.json()

    const now = new Date()
    const needsSync = guilds.filter((guild) => {
      if (!guild.auto_sync_enabled) return false
      if ((guild.consecutive_sync_failures ?? 0) >= MAX_CONSECUTIVE_FAILURES)
        return false
      if (!guild.last_successful_sync) return true
      const ageMs =
        now.getTime() - new Date(guild.last_successful_sync).getTime()
      if (realtimeOnly) return ageMs >= REALTIME_STALE_THRESHOLD_MS
      const tier = guild.sync_tier ?? 'active'
      const threshold =
        TIER_STALE_THRESHOLDS[tier] ??
        TIER_STALE_THRESHOLDS.active ??
        60 * 60 * 1000
      return ageMs >= threshold
    })

    // Healing lane: daily re-probe of excluded guilds; a successful sync is the only automated path
    // back to api_key_is_valid=true. The cohort is the exact complement of normal-lane eligibility,
    // except `enabled` (the human-set disable), which is never overridden.
    let healGuilds: GuildConfigRow[] = []
    if (!realtimeOnly && now.getUTCHours() === HEAL_HOUR_UTC) {
      const healCohort = [
        'api_key_is_valid.is.false',
        'auto_sync_enabled.is.false',
        'auto_sync_enabled.is.null',
        `consecutive_sync_failures.gte.${MAX_CONSECUTIVE_FAILURES}`
      ].join(',')
      const healResp = await directFetch(
        `${internalUrl}/rest/v1/guild_config?select=guild_code,guild_id,auto_sync_enabled,consecutive_sync_failures,last_successful_sync,sync_tier&enabled=eq.true&api_key_encrypted=not.is.null&or=(${healCohort})&order=last_successful_sync.desc.nullslast&limit=${MAX_HEAL_GUILDS_PER_RUN}`,
        {
          method: 'GET',
          headers: {
            apikey: anonKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json'
          }
        }
      )
      if (healResp.ok) {
        healGuilds = await healResp.json()
        if (healGuilds.length > 0) {
          logger.info(
            { jobId: ctx.jobId, healCandidates: healGuilds.length },
            '[GuildBatchSync] daily healing lane — re-probing guilds the normal lane excludes'
          )
        }
      } else {
        logger.warn(
          { jobId: ctx.jobId, status: healResp.status },
          '[GuildBatchSync] healing-lane guild fetch failed — skipping heal this run'
        )
      }
    }

    if (needsSync.length === 0 && healGuilds.length === 0) {
      return {
        message: 'No guilds need syncing',
        guildsChecked: guilds.length,
        guildsProcessed: 0,
        successful: 0,
        failed: 0,
        totalEntries: 0,
        lokiSharedSession: sharedLokiSession,
        durationMs: Date.now() - startTime
      }
    }

    needsSync.sort((a, b) => {
      const aTime = a.last_successful_sync
        ? new Date(a.last_successful_sync).getTime()
        : 0
      const bTime = b.last_successful_sync
        ? new Date(b.last_successful_sync).getTime()
        : 0
      return aTime - bTime
    })
    const normalGuildsToSync = needsSync.slice(0, MAX_GUILDS_PER_RUN)
    const alreadyQueued = new Set(normalGuildsToSync.map((g) => g.guild_code))
    const guildsToSync = [
      ...normalGuildsToSync,
      ...healGuilds.filter((g) => !alreadyQueued.has(g.guild_code))
    ]

    try {
      const shared = await ensureSharedLokiSession({
        store: createRestSharedSessionStore({
          fetchImpl: directFetch,
          baseUrl: internalUrl,
          anonKey,
          serviceKey,
          scraperUserId: process.env.LOKI_SCRAPER_USER_ID || ''
        }),
        // Only guilds with a guild_id reach LOKI, so only they can test the session.
        probeGuildId: guildsToSync.find((g) => g.guild_id)?.guild_id ?? null
      })
      sharedLokiSessionId = shared.sessionId
      sharedLokiSessionUserId = shared.userId
      if (shared.sessionId) {
        sharedLokiSession = shared.reused ? 'reused' : 'connected'
        logger.info(
          {
            jobId: ctx.jobId,
            session: sharedLokiSession,
            durationMs: shared.durationMs
          },
          'shared LOKI session ready'
        )
      } else if (shared.error) {
        logger.warn(
          { jobId: ctx.jobId, err: shared.error },
          'no shared LOKI session this run; each guild refreshes its own (thundering-herd risk)'
        )
      }
    } catch (sessionError) {
      logger.warn(
        { jobId: ctx.jobId, err: getErrorMessage(sessionError) },
        'shared LOKI session exception (non-fatal)'
      )
    }

    logger.info(
      {
        jobId: ctx.jobId,
        realtimeOnly,
        guildsChecked: guilds.length,
        guildsPendingSync: needsSync.length,
        guildsToProcess: guildsToSync.length
      },
      'starting guild-batch-sync'
    )

    const results: SyncResult[] = []
    for (let i = 0; i < guildsToSync.length; i += BATCH_SIZE) {
      if (Date.now() >= softDeadline) {
        logger.warn(
          {
            jobId: ctx.jobId,
            processed: results.length,
            remaining: guildsToSync.length - i
          },
          '[GuildBatchSync] soft deadline reached — partial run'
        )
        break
      }

      const batch = guildsToSync.slice(i, i + BATCH_SIZE)

      const batchPromises = batch.map(async (guild, index) => {
        if (index > 0) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.random() * GUILD_STAGGER_MAX)
          )
        }
        const guildStartTime = Date.now()
        try {
          const fnResp = await directFetch(
            `${internalUrl}/functions/v1/sync-modular-workflow`,
            {
              method: 'POST',
              headers: {
                apikey: anonKey,
                Authorization: `Bearer ${serviceKey}`,
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                guild_code: guild.guild_code,
                // The edge sends the session only as the account that minted it.
                ...(sharedLokiSessionId && sharedLokiSessionUserId
                  ? {
                      fresh_session_id: sharedLokiSessionId,
                      fresh_session_user_id: sharedLokiSessionUserId
                    }
                  : {})
              })
            }
          )
          if (!fnResp.ok) {
            const errText = await fnResp.text()
            throw new Error(`HTTP ${fnResp.status}: ${errText}`)
          }
          const data: SyncFunctionResponse = await fnResp.json()
          if (!data?.success) {
            throw new Error(data?.error || 'Sync reported failure')
          }
          return {
            guild_code: guild.guild_code,
            success: true,
            entries: data.stats?.finalValidEntries || 0,
            duration: Date.now() - guildStartTime
          } satisfies SyncResult
        } catch (error: unknown) {
          return {
            guild_code: guild.guild_code,
            success: false,
            error: getErrorMessage(error),
            duration: Date.now() - guildStartTime
          } satisfies SyncResult
        }
      })

      const batchResults = await Promise.all(batchPromises)
      results.push(...batchResults)

      if (i + BATCH_SIZE < guildsToSync.length) {
        const jitteredDelay =
          BATCH_DELAY_BASE + Math.random() * BATCH_DELAY_JITTER
        await new Promise((resolve) => setTimeout(resolve, jitteredDelay))
      }
    }

    const successful = results.filter((r) => r.success).length
    const failed = results.filter((r) => !r.success).length
    const totalEntries = results.reduce((sum, r) => sum + (r.entries || 0), 0)
    const totalDuration = Date.now() - startTime

    logger[failed > 0 ? 'warn' : 'info'](
      {
        jobId: ctx.jobId,
        successful,
        failed,
        totalEntries,
        durationMs: totalDuration
      },
      'guild-batch-sync complete'
    )

    return {
      guildsChecked: guilds.length,
      guildsPendingSync: needsSync.length,
      guildsProcessed: results.length,
      successful,
      failed,
      totalEntries,
      durationMs: totalDuration,
      averageSyncMs:
        results.length > 0
          ? Math.round(
              results.reduce((sum, r) => sum + r.duration, 0) / results.length
            )
          : 0,
      lokiSharedSession: sharedLokiSession,
      nextSyncRecommended:
        needsSync.length > guildsToSync.length ? '1 hour' : '4 hours'
    }
  } catch (error: unknown) {
    rethrowIfAppError(error)
    const message = getErrorMessage(error)
    logger.error({ jobId: ctx.jobId, err: message }, 'guild-batch-sync failed')
    captureSentryException(error, {
      tags: { component: 'guild-batch-sync', layer: 'work-queue-handler' },
      extra: { jobId: ctx.jobId, durationMs: Date.now() - startTime }
    })
    throw error
  }
}

export function registerGuildBatchSyncHandler(): void {
  registerJobHandler('guild-batch-sync', guildBatchSyncHandler)
}

export const __internal = {
  guildBatchSyncHandler,
  TIER_STALE_THRESHOLDS,
  REALTIME_STALE_THRESHOLD_MS
}
