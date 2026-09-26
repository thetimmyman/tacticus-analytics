import { guildRosterQuery } from '@/app/lib/data/guild-roster'
// Shared-Loki-session roster refresh for members without a valid Tacticus API key.

import { randomInt } from 'node:crypto'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { createGuildLokiClient } from '@/app/lib/loki/guild-client'
import { refreshSharedLokiSession } from '@/app/lib/loki/batch-session-refresh'
import {
  persistRosterSnapshot,
  type AnyUnit
} from '@/app/lib/player/roster-sync'
import { registerJobHandler } from './dispatcher'
import { softDeadlineFor } from './deadline'
import type { JobHandler } from './types'
import { coerceErrorMessage as getErrorMessage } from '@/app/lib/utils/error-message'

const logger = createComponentLogger('lib.jobs.roster-loki-backfill')

const BATCH_CONCURRENCY = 2
// Hard ceiling on physical requests, including CONNECT, auth refreshes and replays.
const MAX_PLAYER_REQUESTS_PER_RUN = 400
const SOFT_TIMEOUT_MS = 240_000 // 4 min — comfortable within 5-min cadence
const STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000

interface RosterLokiBackfillPayload {
  guildCode?: string
  staleMinutes?: number
}

const rosterLokiBackfillHandler: JobHandler = async (payload, ctx) => {
  const startTime = Date.now()
  const softDeadline = softDeadlineFor(startTime, SOFT_TIMEOUT_MS, ctx)

  const { guildCode: scopeGuild, staleMinutes } = (payload ??
    {}) as RosterLokiBackfillPayload

  const staleMs =
    staleMinutes && staleMinutes > 0
      ? staleMinutes * 60 * 1000
      : STALE_THRESHOLD_MS

  logger.info(
    {
      jobId: ctx.jobId,
      guildCode: scopeGuild ?? 'ALL',
      staleMinutes: Math.round(staleMs / 60000)
    },
    '[RosterLokiBackfill] starting'
  )

  const supabase = serviceDb()
  let requestsStarted = 0
  let budgetExhausted = false

  // Incremented synchronously before the call, so concurrent requests cannot overshoot the budget.
  const budgetedFetch: typeof fetch = async (input, init) => {
    if (requestsStarted >= MAX_PLAYER_REQUESTS_PER_RUN) {
      budgetExhausted = true
      throw new Error('Roster Loki provider request budget exhausted')
    }
    requestsStarted += 1
    return globalThis.fetch(input, init)
  }

  try {
    try {
      await refreshSharedLokiSession({ fetchImpl: budgetedFetch })
    } catch (preErr) {
      logger.warn(
        { jobId: ctx.jobId, err: getErrorMessage(preErr) },
        '[RosterLokiBackfill] shared Loki session refresh failed (non-fatal)'
      )
    }

    let guildsQuery = supabase
      .from('guild_config')
      .select(
        'guild_code, user_id, session_id, enabled, auto_sync_enabled, consecutive_sync_failures'
      )
      .eq('enabled', true)
      .eq('auto_sync_enabled', true)

    if (scopeGuild) {
      guildsQuery = guildsQuery.eq('guild_code', scopeGuild)
    }

    const { data: guilds, error: guildsErr } = await guildsQuery

    if (guildsErr) {
      throw new Error(`Failed to fetch guilds: ${guildsErr.message}`)
    }

    if (!guilds?.length) {
      logger.info(
        { jobId: ctx.jobId },
        '[RosterLokiBackfill] no eligible guilds'
      )
      return {
        processed: 0,
        failed: 0,
        skipped: 0,
        guilds: 0,
        durationMs: Date.now() - startTime
      }
    }

    const eligibleGuilds = guilds.filter(
      (g) => (g.consecutive_sync_failures ?? 0) < 5
    )

    // Shuffle so a run cut short doesn't always starve the same guilds.
    for (let i = eligibleGuilds.length - 1; i > 0; i--) {
      const j = randomInt(i + 1)
      const tmp = eligibleGuilds[i]!
      eligibleGuilds[i] = eligibleGuilds[j]!
      eligibleGuilds[j] = tmp
    }

    let processed = 0
    let failed = 0
    let skipped = 0
    let timedOutEarly = false
    for (const guild of eligibleGuilds) {
      if (Date.now() >= softDeadline || budgetExhausted) {
        logger.warn(
          {
            jobId: ctx.jobId,
            processed,
            failed,
            skipped,
            requestsStarted,
            budgetExhausted
          },
          budgetExhausted
            ? '[RosterLokiBackfill] request budget reached — partial run'
            : '[RosterLokiBackfill] soft deadline reached — partial run'
        )
        if (!budgetExhausted) timedOutEarly = true
        break
      }

      const lokiClient = await createGuildLokiClient(
        supabase,
        guild.guild_code,
        {
          credentialRow: guild,
          retryAttempts: 0,
          fetchImpl: budgetedFetch
        }
      )
      if (!lokiClient) continue

      const { data: members, error: membersErr } = await guildRosterQuery(
        supabase,
        guild.guild_code,
        'id, user_id, player_id, display_name, api_key_is_valid, tacticus_api_key_encrypted'
      ).not('player_id', 'is', null)

      if (membersErr || !members?.length) {
        if (membersErr) {
          logger.warn(
            {
              jobId: ctx.jobId,
              guildCode: guild.guild_code,
              err: membersErr.message
            },
            '[RosterLokiBackfill] fetch members failed'
          )
        }
        continue
      }

      const lokiOnlyMembers = members.filter(
        (m) => !(m.api_key_is_valid && m.tacticus_api_key_encrypted)
      )

      if (lokiOnlyMembers.length === 0) {
        continue
      }

      const mappingIds = lokiOnlyMembers.map((m) => m.id)
      const staleBefore = new Date(Date.now() - staleMs).toISOString()

      const { data: recentSyncs } = await supabase
        .from('player_roster')
        .select('player_mapping_id')
        .in('player_mapping_id', mappingIds)
        .gte('synced_at', staleBefore)

      const recentlySynced = new Set(
        (recentSyncs ?? []).map((r) => r.player_mapping_id)
      )

      const needsSync = lokiOnlyMembers.filter((m) => !recentlySynced.has(m.id))
      skipped += lokiOnlyMembers.length - needsSync.length

      if (needsSync.length === 0) {
        continue
      }

      logger.info(
        {
          jobId: ctx.jobId,
          guildCode: guild.guild_code,
          eligible: lokiOnlyMembers.length,
          needsSync: needsSync.length
        },
        '[RosterLokiBackfill] guild members to sync'
      )

      for (let i = 0; i < needsSync.length;) {
        if (requestsStarted >= MAX_PLAYER_REQUESTS_PER_RUN) {
          skipped += needsSync.length - i
          budgetExhausted = true
          break
        }

        if (Date.now() >= softDeadline) {
          const remaining = needsSync.length - i
          logger.warn(
            {
              jobId: ctx.jobId,
              guildCode: guild.guild_code,
              processed,
              failed,
              skipped,
              remaining
            },
            '[RosterLokiBackfill] soft deadline reached — partial run'
          )
          skipped += remaining
          timedOutEarly = true
          break
        }

        const remainingBudget = MAX_PLAYER_REQUESTS_PER_RUN - requestsStarted
        const batch = needsSync.slice(
          i,
          i + Math.min(BATCH_CONCURRENCY, remainingBudget)
        )
        await Promise.all(
          batch.map(async (player) => {
            try {
              if (!player.player_id) {
                skipped++
                return
              }
              const result = await lokiClient.getPlayerInfo(player.player_id)
              if (!result.ok || !result.data?.heroInfo?.units?.units) {
                failed++
                return
              }

              const lokiUnits = result.data.heroInfo.units.units
              const units: AnyUnit[] = Object.entries(lokiUnits).map(
                ([id, data]) => ({
                  id,
                  progressionIndex: data.progressionIndex,
                  rank: data.rank,
                  xpLevel: data.xpLevel,
                  abilities: [
                    { id: 'active', level: data.active ?? 0 },
                    { id: 'passive', level: data.passive ?? 0 }
                  ],
                  items: Object.entries(data.items ?? {}).map(
                    ([itemId, level]) => ({
                      id: itemId,
                      level: typeof level === 'number' ? level : undefined
                    })
                  )
                })
              )

              const { upserted } = await persistRosterSnapshot(
                player.user_id ?? null,
                units,
                [],
                supabase,
                player.id,
                {
                  playerPower:
                    result.data.heroInfo.player?.powerLevel ??
                    result.data.heroInfo.player?.totalPower ??
                    null
                }
              )

              logger.info(
                {
                  jobId: ctx.jobId,
                  guildCode: guild.guild_code,
                  playerMappingId: player.id,
                  displayName: player.display_name,
                  upserted
                },
                '[RosterLokiBackfill] synced player'
              )
              processed++
            } catch (err) {
              logger.warn(
                {
                  jobId: ctx.jobId,
                  guildCode: guild.guild_code,
                  playerMappingId: player.id,
                  displayName: player.display_name,
                  err: getErrorMessage(err)
                },
                '[RosterLokiBackfill] player sync failed'
              )
              failed++
            }
          })
        )
        i += batch.length
      }

      if (timedOutEarly || budgetExhausted) break
    }

    const durationMs = Date.now() - startTime
    logger.info(
      {
        jobId: ctx.jobId,
        guilds: eligibleGuilds.length,
        processed,
        failed,
        skipped,
        requestsStarted,
        durationMs,
        timedOutEarly,
        budgetExhausted
      },
      '[RosterLokiBackfill] complete'
    )

    return {
      guilds: eligibleGuilds.length,
      processed,
      failed,
      skipped,
      requestsStarted,
      durationMs,
      partialDueToTimeout: timedOutEarly,
      partialDueToBudget: budgetExhausted
    }
  } catch (error) {
    rethrowIfAppError(error)
    const message = getErrorMessage(error)
    captureSentryException(error, {
      tags: { handler: 'roster-loki-backfill', jobId: String(ctx.jobId) },
      extra: { guildCode: scopeGuild ?? 'ALL' }
    })
    logger.error(
      { jobId: ctx.jobId, err: message },
      '[RosterLokiBackfill] handler failed'
    )
    throw error
  }
}

export function registerRosterLokiBackfillHandler(): void {
  registerJobHandler('roster-loki-backfill', rosterLokiBackfillHandler)
}

export const __internal = {
  rosterLokiBackfillHandler
}
