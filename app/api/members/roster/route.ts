import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import {
  tacticusAPI,
  resolveMachinesOfWar
} from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
import { CLUSTER_LOOKUP_SELECT } from '@/app/lib/guild-config-selects'
const logger = createComponentLogger('api.members.roster')
import { createGuildLokiClient } from '@/app/lib/loki/guild-client'
import type { LokiPlayerInfoUnit } from '@/app/lib/loki/types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import {
  requireSessionUser,
  resolveCurrentMembership
} from '@/app/lib/api/session-user'
import { checkActionRateLimit } from '@/app/lib/middleware/rate-limit'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities
} from '@/app/lib/auth/verified-player-authority'

export const dynamic = 'force-dynamic'

interface PartialPlayerData {
  powerLevel: number | undefined
  pvpLineup: string[] | undefined
  units: Array<{ id: string } & LokiPlayerInfoUnit>
  pvpInfo:
    | {
        leagueIndex?: number
        playerPosition?: number
        ranked?: boolean
        trophies?: number
      }
    | undefined
}

async function tryLokiPlayerInfoFallback(
  guildCode: string | null,
  playerId: string
): Promise<PartialPlayerData | null> {
  if (!guildCode) return null

  try {
    const serviceSupabase = serviceDb()

    const client = await createGuildLokiClient(serviceSupabase, guildCode)
    if (!client) return null

    const result = await client.getPlayerInfo(playerId)

    if (!result.ok || !result.data?.heroInfo) {
      logger.warn(
        {
          error: result.ok ? 'No heroInfo' : result.error?.message
        },
        'LOKI GET_PLAYER_INFO fallback failed'
      )
      return null
    }

    const heroInfo = result.data.heroInfo
    const units = heroInfo.units?.units
      ? Object.entries(heroInfo.units.units).map(([id, data]) => ({
          id,
          abilities: [] as Array<{ id: string; level: number }>,
          ...data
        }))
      : []

    return {
      powerLevel: heroInfo.player?.powerLevel,
      pvpLineup: heroInfo.units?.lineup?.pvp,
      units,
      pvpInfo: heroInfo.pvpInfo
    }
  } catch (error) {
    rethrowIfAppError(error)
    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error)
      },
      'LOKI GET_PLAYER_INFO fallback error'
    )
    return null
  }
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()

    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    const playerId = request.nextUrl.searchParams.get('player_id')
    if (!playerId) {
      throw Errors.fromResponse(400, { error: 'player_id is required' })
    }

    const currentUser = await resolveCurrentMembership(supabase, user.id)

    if (!currentUser || !canManageHeraldRole(currentUser.role)) {
      throw Errors.fromResponse(403, {
        error: 'Only officers and leaders can view member rosters',
        code: 'INSUFFICIENT_PERMISSIONS'
      })
    }

    const serviceSupabase = serviceDb()

    const { data: targetPlayer } = (await serviceSupabase
      .from('player_mapping')
      .select(
        'id, user_id, player_id, display_name, guild_code, tacticus_api_key_encrypted, tacticus_share_url, discord_user_id'
      )
      .eq('player_id', playerId)
      .eq('is_current', true)
      .single()) as {
      data: {
        id: number
        user_id: string | null
        player_id: string
        display_name: string | null
        guild_code: string | null
        tacticus_api_key_encrypted: string | null
        tacticus_share_url: string | null
        discord_user_id: string | null
      } | null
      error: unknown
    }

    if (!targetPlayer) {
      throw Errors.fromResponse(404, {
        error: 'Player not found',
        code: 'PLAYER_NOT_FOUND'
      })
    }

    // player_mapping.cluster_code is never populated.
    const guildCodes = [currentUser.guild_code, targetPlayer.guild_code].filter(
      Boolean
    ) as string[]
    const { data: guildConfigs } = await serviceSupabase
      .from('guild_config')
      .select(CLUSTER_LOOKUP_SELECT)
      .in('guild_code', guildCodes)

    const currentUserCluster = guildConfigs?.find(
      (gc) => gc.guild_code === currentUser.guild_code
    )?.cluster_code
    const targetPlayerCluster = guildConfigs?.find(
      (gc) => gc.guild_code === targetPlayer.guild_code
    )?.cluster_code

    const isSameGuild = targetPlayer.guild_code === currentUser.guild_code
    const isSameCluster =
      currentUserCluster &&
      targetPlayerCluster &&
      currentUserCluster === targetPlayerCluster

    if (!isSameGuild && !isSameCluster) {
      throw Errors.fromResponse(403, {
        error: 'You can only view rosters for members in your guild or cluster',
        code: 'WRONG_GUILD'
      })
    }

    if (!targetPlayer.tacticus_api_key_encrypted) {
      const verifiedDiscord = targetPlayer.discord_user_id
        ? await resolveVerifiedDiscordIdentities(serviceSupabase, [
            targetPlayer.discord_user_id
          ])
        : []
      const hasVerifiedDiscord = Boolean(
        findVerifiedDiscordForMapping(verifiedDiscord, {
          mappingId: targetPlayer.id,
          playerId: targetPlayer.player_id,
          userId: targetPlayer.user_id,
          guildCode: targetPlayer.guild_code,
          discordUserId: targetPlayer.discord_user_id
        })
      )
      const rateLimit = await checkActionRateLimit(
        `member-roster:loki:${targetPlayer.player_id}`,
        60
      )
      if (!rateLimit.allowed) {
        throw Errors.fromResponse(429, {
          error: 'Please wait before refreshing this roster again',
          code: 'RATE_LIMITED',
          retryAfter: rateLimit.remainingTime ?? 60
        })
      }

      const partialData = await tryLokiPlayerInfoFallback(
        targetPlayer.guild_code,
        targetPlayer.player_id
      )

      if (partialData) {
        return NextResponse.json({
          success: true,
          partial: true,
          playerName: targetPlayer.display_name,
          powerLevel: partialData.powerLevel,
          pvpLineup: partialData.pvpLineup,
          units: partialData.units,
          pvpInfo: partialData.pvpInfo,
          guildCode: targetPlayer.guild_code,
          tacticusShareUrl: targetPlayer.tacticus_share_url
        })
      }

      throw Errors.fromResponse(400, {
        error: 'This player has not configured their API key',
        code: 'NO_API_KEY',
        playerName: targetPlayer.display_name,
        hasDiscord: hasVerifiedDiscord
      })
    }

    const apiKey = await getPlayerApiKey(targetPlayer)
    if (!apiKey) {
      throw Errors.fromResponse(500, {
        error: 'Failed to decrypt API key',
        code: 'DECRYPT_FAILED'
      })
    }

    const player = await tacticusAPI.getPlayer(apiKey)
    if (!player) {
      throw Errors.fromResponse(502, {
        error: 'Failed to fetch player data from Tacticus API',
        code: 'API_FAILED'
      })
    }

    return NextResponse.json({
      success: true,
      playerName: targetPlayer.display_name,
      powerLevel: player.details?.powerLevel,
      units: player.units || [],
      // Parity with /api/player/roster; the Loki partial path has no MoW data.
      machinesOfWar: resolveMachinesOfWar(player),
      progress: player.progress || {},
      guildCode: targetPlayer.guild_code,
      tacticusShareUrl: targetPlayer.tacticus_share_url
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Member roster fetch error')
    throw Errors.fromResponse(500, { error: 'An unexpected error occurred' })
  }
})
