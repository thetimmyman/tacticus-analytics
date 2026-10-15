// One batch job, not per-player fan-out: throughput is bound by the Tacticus rate budget.
// Database-owned observation order lets partial runs rotate through the cohort.

import { serviceDb } from '@/app/lib/db'
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import {
  tacticusAPI,
  resolveMachinesOfWar
} from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { captureSentryException } from '@/app/lib/monitoring/sentry'
import { persistRosterSnapshot } from '@/app/lib/player/roster-sync'
import {
  tryBeginPlayerRosterRefresh,
  selectRosterRefreshCandidates
} from '@/app/lib/player/roster-snapshot-store'
import {
  clearKeyRejections,
  isKeyRejection,
  recordKeyRejection
} from '@/app/lib/player-key/strike'
import type { AnyUnit } from '@/app/lib/player/roster-sync'
import { withTimeout, TimeoutError } from '@/app/lib/utils/async-timeout'
import { registerJobHandler } from './dispatcher'
import { softDeadlineFor } from './deadline'
import type { JobHandler } from './types'
import { coerceErrorMessage as getErrorMessage } from '@/app/lib/utils/error-message'

const logger = createComponentLogger('lib.jobs.roster-backfill')

const BATCH_CONCURRENCY = 5
const SOFT_TIMEOUT_MS = 360_000
const PER_PLAYER_TIMEOUT_MS = 30_000
// Preserve the half-hour sweep cadence with ten minutes for pass/deadline drift.
// An explicit full player read can satisfy this background verification window.
const DEFAULT_FRESHNESS_MS = 20 * 60_000
const RETRY_COOLDOWN_MS = 5 * 60_000

interface RosterBackfillPayload {
  guildCode?: string
  staleHours?: number
}

const rosterBackfillHandler: JobHandler = async (payload, ctx) => {
  const startTime = Date.now()
  const softDeadline = softDeadlineFor(startTime, SOFT_TIMEOUT_MS, ctx)

  const { guildCode, staleHours } = (payload ?? {}) as RosterBackfillPayload

  logger.info(
    {
      jobId: ctx.jobId,
      guildCode: guildCode ?? 'ALL',
      staleHours: staleHours ?? 'none'
    },
    '[RosterBackfill] starting'
  )

  const supabase = serviceDb()

  try {
    let query = supabase
      .from('player_mapping')
      .select(
        'id, user_id, player_id, display_name, guild_code, tacticus_api_key_encrypted, consecutive_api_key_failures'
      )
      .eq('is_current', true)
      .eq('api_key_is_valid', true)
      .not('tacticus_api_key_encrypted', 'is', null)

    if (guildCode) {
      query = query.eq('guild_code', guildCode)
    }

    const { data: cohort, error: fetchErr } = await query

    if (fetchErr) {
      throw new Error(`Failed to fetch players: ${fetchErr.message}`)
    }

    const freshMs =
      typeof staleHours === 'number' &&
      Number.isFinite(staleHours) &&
      staleHours > 0
        ? Math.max(60_000, staleHours * 60 * 60 * 1000)
        : DEFAULT_FRESHNESS_MS
    const players = await selectRosterRefreshCandidates(
      cohort ?? [],
      {
        freshMs,
        retryMs: Math.min(freshMs, RETRY_COOLDOWN_MS)
      },
      supabase
    )
    const notDue = (cohort?.length ?? 0) - players.length

    if (!players?.length) {
      logger.info({ jobId: ctx.jobId }, '[RosterBackfill] no players to sync')
      return {
        processed: 0,
        failed: 0,
        skipped: notDue,
        notDue,
        total: cohort?.length ?? 0,
        durationMs: Date.now() - startTime
      }
    }

    logger.info(
      {
        jobId: ctx.jobId,
        count: players.length,
        guildCode: guildCode ?? 'ALL'
      },
      '[RosterBackfill] players to sync'
    )

    let processed = 0
    let failed = 0
    let skipped = notDue
    let unchanged = 0
    let timedOutEarly = false

    for (let i = 0; i < players.length; i += BATCH_CONCURRENCY) {
      if (Date.now() >= softDeadline) {
        const remaining = players.length - i
        logger.warn(
          { jobId: ctx.jobId, processed, failed, skipped, remaining },
          '[RosterBackfill] soft deadline reached — partial run'
        )
        skipped += remaining
        timedOutEarly = true
        break
      }

      const batch = players.slice(i, i + BATCH_CONCURRENCY)

      await Promise.all(
        batch.map(async (player) => {
          try {
            if (!player.user_id && !player.id) {
              skipped++
              return
            }
            const apiKey = await getPlayerApiKey(player)
            if (!apiKey) {
              skipped++
              return
            }

            const observation = await tryBeginPlayerRosterRefresh(
              player.user_id ?? null,
              player.id,
              { freshMs, retryMs: Math.min(freshMs, RETRY_COOLDOWN_MS) },
              supabase
            )
            if (!observation) {
              skipped++
              return
            }
            const { player: tacticusPlayer, status } = await withTimeout(
              tacticusAPI.getPlayerResult(apiKey),
              PER_PLAYER_TIMEOUT_MS,
              `tacticusAPI.getPlayer(${player.display_name ?? player.id})`
            )
            if (!tacticusPlayer) {
              // A rejected key counts toward flagging it invalid, which drops it
              // from this job's api_key_is_valid filter instead of retrying forever.
              const strike =
                isKeyRejection(status) && player.player_id
                  ? await recordKeyRejection(supabase, player.player_id)
                  : null
              logger.warn(
                {
                  jobId: ctx.jobId,
                  playerMappingId: player.id,
                  userId: player.user_id,
                  status,
                  strikes: strike?.strikes,
                  flagged: strike?.flagged
                },
                '[RosterBackfill] Tacticus API returned null'
              )
              failed++
              return
            }

            if (player.consecutive_api_key_failures > 0) {
              await clearKeyRejections(supabase, player.id)
            }

            const unitsRaw: AnyUnit[] = Array.isArray(tacticusPlayer.units)
              ? tacticusPlayer.units
              : []
            const mowsRaw: AnyUnit[] = resolveMachinesOfWar(tacticusPlayer)

            const receipt = await persistRosterSnapshot(
              player.user_id ?? null,
              unitsRaw,
              mowsRaw,
              supabase,
              player.id,
              {
                playerPower: tacticusPlayer.details?.powerLevel ?? null,
                observation
              }
            )
            if (receipt.status === 'superseded') {
              skipped++
              return
            }
            if (!receipt.complete) {
              failed++
              return
            }
            if (receipt.unchanged) unchanged++

            logger.info(
              {
                jobId: ctx.jobId,
                playerMappingId: player.id,
                userId: player.user_id,
                displayName: player.display_name,
                upserted: receipt.upserted,
                unchanged: receipt.unchanged
              },
              '[RosterBackfill] synced player'
            )
            processed++
          } catch (err) {
            const msg = getErrorMessage(err)
            const isTimeout = err instanceof TimeoutError
            logger.warn(
              {
                jobId: ctx.jobId,
                userId: player.user_id,
                displayName: player.display_name,
                error: msg,
                timedOut: isTimeout
              },
              '[RosterBackfill] player sync failed'
            )
            failed++
          }
        })
      )
    }

    const durationMs = Date.now() - startTime
    logger.info(
      {
        jobId: ctx.jobId,
        processed,
        failed,
        skipped,
        unchanged,
        durationMs,
        timedOutEarly
      },
      '[RosterBackfill] complete'
    )

    return {
      processed,
      failed,
      skipped,
      unchanged,
      total: cohort?.length ?? 0,
      notDue,
      durationMs,
      partialDueToTimeout: timedOutEarly
    }
  } catch (error) {
    rethrowIfAppError(error)
    const message = getErrorMessage(error)
    captureSentryException(error, {
      tags: { handler: 'roster-backfill', jobId: String(ctx.jobId) },
      extra: { guildCode: guildCode ?? 'ALL', staleHours: staleHours ?? null }
    })
    logger.error(
      { jobId: ctx.jobId, err: message },
      '[RosterBackfill] handler failed'
    )
    throw error
  }
}

export function registerRosterBackfillHandler(): void {
  registerJobHandler('roster-backfill', rosterBackfillHandler)
}
