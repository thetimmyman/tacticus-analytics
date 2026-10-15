import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import {
  tryBeginPlayerRosterRefresh,
  selectRosterRefreshCandidates
} from '@/app/lib/player/roster-snapshot-store'
import { NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { requireRoleForApi } from '@/app/lib/auth'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import {
  tacticusAPI,
  resolveMachinesOfWar
} from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-teams.backfill')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  persistRosterSnapshot,
  type AnyUnit
} from '@/app/lib/player/roster-sync'
import { checkActionRateLimit } from '@/app/lib/middleware/rate-limit'

/** Every member with a valid Tacticus key, claimed or not. Skips players synced in 6h. */

const BATCH_CONCURRENCY = 2
const BACKFILL_RATE_LIMIT_SECONDS = 15 * 60
const SOFT_TIMEOUT_MS = 30_000 // 30s — keep page-initiated requests snappy
const STALE_THRESHOLD_MS = 6 * 60 * 60 * 1000

export const dynamic = 'force-dynamic'

export const POST = withErrorHandler(async () => {
  const startTime = Date.now()

  const desktopMode = getRuntimeProfile() === 'desktop'
  const { profile } = await requireRoleForApi(
    desktopMode ? 'member' : 'officer'
  )
  if (desktopMode) {
    return NextResponse.json(
      {
        success: false,
        error:
          'Import your roster from API access and sync to update local team comparisons.'
      },
      { status: 409 }
    )
  }
  const guildCode = profile.guild_code
  if (!guildCode) {
    return NextResponse.json(
      { success: false, error: 'No guild' },
      { status: 400 }
    )
  }
  if (!canManageHeraldRole(profile.role)) {
    return NextResponse.json(
      { success: false, error: 'Insufficient permissions' },
      { status: 403 }
    )
  }

  const rateLimit = await checkActionRateLimit(
    `guild-teams:backfill:${guildCode}`,
    BACKFILL_RATE_LIMIT_SECONDS
  )
  if (!rateLimit.allowed) {
    return NextResponse.json({
      success: true,
      processed: 0,
      skipped: 0,
      failed: 0,
      rateLimited: true,
      retryAfter: rateLimit.remainingTime ?? BACKFILL_RATE_LIMIT_SECONDS,
      message: 'Roster refresh already requested recently'
    })
  }

  const supabase = serviceDb()

  // Unclaimed players are keyed by player_mapping_id.
  const { data: players, error: fetchErr } = await guildRosterQuery(
    supabase,
    guildCode,
    'id, user_id, player_id, display_name, tacticus_api_key_encrypted, api_key_is_valid'
  )

  if (fetchErr || !players?.length) {
    return NextResponse.json({
      success: true,
      processed: 0,
      skipped: 0,
      failed: 0
    })
  }

  // Without a valid key there is no roster source, so don't claim a refresh slot.
  const keyed = players.filter(
    (player) => player.tacticus_api_key_encrypted && player.api_key_is_valid
  )
  const needsSync = await selectRosterRefreshCandidates(
    keyed,
    {
      freshMs: STALE_THRESHOLD_MS,
      retryMs: 5 * 60_000,
      requireEnabledGuild: false
    },
    supabase
  )

  if (needsSync.length === 0) {
    return NextResponse.json({
      success: true,
      processed: 0,
      skipped: players.length,
      failed: 0,
      message: 'All rosters recently synced'
    })
  }

  let processed = 0
  let skipped = players.length - needsSync.length
  let failed = 0

  for (let i = 0; i < needsSync.length; i += BATCH_CONCURRENCY) {
    if (Date.now() - startTime > SOFT_TIMEOUT_MS) {
      logger.warn(
        {
          processed,
          failed,
          skipped,
          remaining: needsSync.length - i
        },
        '[GuildTeamsBackfill] Soft timeout'
      )
      skipped += needsSync.length - i
      break
    }

    const batch = needsSync.slice(i, i + BATCH_CONCURRENCY)

    await Promise.all(
      batch.map(async (player) => {
        try {
          let units: AnyUnit[] = []
          let mows: AnyUnit[] = []
          let playerPower: number | null = null
          const observation = await tryBeginPlayerRosterRefresh(
            player.user_id ?? null,
            player.id,
            {
              freshMs: STALE_THRESHOLD_MS,
              retryMs: 5 * 60_000,
              requireEnabledGuild: false
            },
            supabase
          )
          if (!observation) {
            skipped++
            return
          }

          if (player.tacticus_api_key_encrypted && player.api_key_is_valid) {
            const apiKey = await getPlayerApiKey(player)
            if (apiKey) {
              const tacticusPlayer = await tacticusAPI.getPlayer(apiKey)
              if (tacticusPlayer) {
                playerPower = tacticusPlayer.details?.powerLevel ?? null
                units = Array.isArray(tacticusPlayer.units)
                  ? tacticusPlayer.units
                  : []
                mows = resolveMachinesOfWar(tacticusPlayer)
              }
            }
          }

          if (units.length === 0) {
            skipped++
            return
          }

          const receipt = await persistRosterSnapshot(
            player.user_id ?? null,
            units,
            mows,
            supabase,
            player.id, // player_mapping_id — works for both claimed and unclaimed
            { playerPower, observation }
          )
          if (receipt.status === 'superseded') skipped++
          else if (!receipt.complete) failed++
          else processed++
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          logger.warn(
            {
              playerMappingId: player.id,
              displayName: player.display_name,
              error: msg
            },
            '[GuildTeamsBackfill] Player failed'
          )
          failed++
        }
      })
    )
  }

  logger.info(
    {
      guildCode,
      processed,
      failed,
      skipped,
      durationMs: Date.now() - startTime
    },
    '[GuildTeamsBackfill] Complete'
  )

  return NextResponse.json({ success: true, processed, failed, skipped })
})
