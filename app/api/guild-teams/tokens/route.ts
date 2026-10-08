import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  loadGuildTokenStatuses,
  type PlayerTokenStatus
} from '@/app/api/guild-tokens/token-service'
import { requireTokenUsageGuildAccess } from '@/app/api/members/token-usage/access'
import { getLatestSeason } from '@/app/lib/data/get-latest-season'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { requireRoleForApi } from '@/app/lib/auth'

const logger = createComponentLogger('api.guild-teams.tokens')

export const dynamic = 'force-dynamic'

/** From the get_player_token_state projection (raw player_mapping never advances past sync); live
 * values refresh in an unawaited background overlay, throttled per guild. */
const REFRESH_THROTTLE_MS = 5 * 60 * 1000
const lastRefreshAt = new Map<string, number>()

interface GuildTeamsTokenRow {
  display_name: string | null
  player_id: string | null
  tokens_available: number | null
  token_next_in_seconds: number | null
  bombs_available_live: number | null
  bombs_used: number | null
  bomb_next_in_seconds: number | null
}

export const GET = withErrorHandler(async (request: Request) => {
  try {
    const { searchParams } = new URL(request.url)
    const requestedGuild = searchParams.get('guild')
    if (!requestedGuild) {
      throw Errors.fromResponse(400, { error: 'guild parameter required' })
    }

    if (getRuntimeProfile() === 'desktop') {
      const { profile } = await requireRoleForApi('member')
      if (requestedGuild !== profile.guild_code) {
        throw Errors.fromResponse(403, { error: 'Guild access denied' })
      }
      // Imported roster snapshots do not establish live game token state.
      return NextResponse.json([])
    }

    const { guild, clusterCode } =
      await requireTokenUsageGuildAccess(requestedGuild)
    const supabase = serviceDb()

    const { data: members, error } = await guildRosterQuery(
      supabase,
      guild,
      'player_id, display_name, last_sync_tokens, last_sync_bombs, next_token_seconds, next_bomb_seconds, last_sync_at'
    )

    if (error) {
      logger.warn({ guild, error: error.message }, 'Failed to read token cache')
      return NextResponse.json([])
    }

    // With null season an empty RPC result reports 3 tokens / 1 bomb for everyone.
    const currentSeason = await getLatestSeason()
    const projectionByPlayerId = new Map<string, PlayerTokenStatus>()
    if (currentSeason) {
      try {
        const projection = await loadGuildTokenStatuses(supabase, {
          guildCode: guild,
          season: currentSeason,
          clusterCode,
          verifyLiveRoster: false,
          skipLiveOverlay: true
        })
        for (const player of projection.players) {
          projectionByPlayerId.set(player.player_id, player)
        }
      } catch (projectionError) {
        logger.warn(
          {
            guild,
            err:
              projectionError instanceof Error
                ? projectionError.message
                : String(projectionError)
          },
          'Token projection failed; serving cached snapshot values'
        )
      }
    }

    const payload: GuildTeamsTokenRow[] = (members ?? []).map((m) => {
      const projected =
        m.player_id != null ? projectionByPlayerId.get(m.player_id) : undefined
      return {
        display_name: m.display_name,
        player_id: m.player_id,
        tokens_available: projected
          ? projected.tokens_available
          : m.last_sync_tokens,
        token_next_in_seconds: projected
          ? projected.token_next_in_seconds
          : m.next_token_seconds,
        bombs_available_live: projected
          ? projected.bombs_available
          : m.last_sync_bombs,
        bombs_used: null,
        bomb_next_in_seconds: projected
          ? projected.next_bomb_seconds
          : m.next_bomb_seconds
      }
    })

    const now = Date.now()
    if (now - (lastRefreshAt.get(guild) ?? 0) > REFRESH_THROTTLE_MS) {
      lastRefreshAt.set(guild, now)
      void loadGuildTokenStatuses(supabase, {
        guildCode: guild,
        season: null,
        clusterCode,
        verifyLiveRoster: false,
        skipLiveOverlay: false
      }).catch((err) => {
        logger.warn(
          { guild, err: err instanceof Error ? err.message : String(err) },
          'Background token refresh failed'
        )
      })
    }

    return NextResponse.json(payload)
  } catch (error) {
    if (getRuntimeProfile() === 'desktop') throw error
    rethrowIfAppError(error)
    logger.error({ err: error }, 'guild-teams tokens error')
    return NextResponse.json([])
  }
})
