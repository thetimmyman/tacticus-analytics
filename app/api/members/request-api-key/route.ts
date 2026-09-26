import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.members.request-api-key')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  canManageHeraldRole,
  isClusterLeaderRole
} from '@/app/lib/auth/role-predicates'
import { sendDiscordDirectMessage } from '@/app/lib/discord/dm-service'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities,
  resolveVerifiedPlayers
} from '@/app/lib/auth/verified-player-authority'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()

    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, { error: 'Authentication required' })
    )

    const body = await request.json()
    const { playerId } = body

    if (!playerId) {
      throw Errors.fromResponse(400, { error: 'player_id is required' })
    }

    const service = serviceDb()
    const verifiedCallers = await resolveVerifiedPlayers(service, [user.id])
    if (verifiedCallers.length !== 1) {
      throw Errors.fromResponse(403, {
        error: 'Verified player ownership is required',
        code: 'UNVERIFIED_PLAYER'
      })
    }
    const callerAuthority = verifiedCallers[0]!

    const { data: currentUser } = await service
      .from('player_mapping')
      .select('role, guild_code, cluster_code, display_name')
      .eq('id', callerAuthority.mappingId)
      .eq('user_id', user.id)
      .eq('is_current', true)
      .single()

    if (!currentUser || !canManageHeraldRole(currentUser.role)) {
      throw Errors.fromResponse(403, {
        error: 'Only officers and leaders can request API keys',
        code: 'INSUFFICIENT_PERMISSIONS'
      })
    }

    const { data: targetPlayer } = (await service
      .from('player_mapping')
      .select(
        'id, user_id, player_id, display_name, guild_code, cluster_code, discord_user_id'
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
        cluster_code: string | null
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

    const isSameGuild = targetPlayer.guild_code === currentUser.guild_code
    const isSameCluster =
      isClusterLeaderRole(currentUser.role) &&
      targetPlayer.cluster_code &&
      targetPlayer.cluster_code === currentUser.cluster_code

    if (!isSameGuild && !isSameCluster) {
      throw Errors.fromResponse(403, {
        error: 'You can only message members in your guild or cluster',
        code: 'WRONG_GUILD'
      })
    }

    const verifiedTargetRows = targetPlayer.discord_user_id
      ? await resolveVerifiedDiscordIdentities(service, [
          targetPlayer.discord_user_id
        ])
      : []
    const verifiedTarget = findVerifiedDiscordForMapping(verifiedTargetRows, {
      mappingId: targetPlayer.id,
      playerId: targetPlayer.player_id,
      userId: targetPlayer.user_id,
      guildCode: targetPlayer.guild_code,
      discordUserId: targetPlayer.discord_user_id
    })

    if (!verifiedTarget) {
      throw Errors.fromResponse(400, {
        error: 'This player does not have Discord linked',
        code: 'NO_DISCORD'
      })
    }

    const message = [
      `👋 **API Key Request from ${currentUser.display_name || 'your guild leader'}**`,
      '',
      `Your guild ${currentUser.role} has requested that you add your Player API Key to Tacticus Analytics.`,
      '',
      'Adding your API key allows your guild leaders to:',
      '• View your roster and help with raid assignments',
      '• Track your progress and provide better support',
      '',
      '**How to add your API key:**',
      '1. Go to https://www.tacticusgame.com/api-key/',
      '2. Generate a key with "Guild" and "Guild Raid" permissions',
      '3. Sign in to Tacticus Analytics and add it in your Profile settings',
      '',
      '_This is an automated message sent on behalf of your guild._'
    ].join('\n')

    const dmResult = await sendDiscordDirectMessage({
      discordUserId: verifiedTarget.discordUserId,
      content: message
    })

    if (!dmResult.ok) {
      if (dmResult.reason === 'no_bot_token') {
        throw Errors.fromResponse(500, {
          error: 'Discord bot is not configured',
          code: 'BOT_NOT_CONFIGURED'
        })
      }
      if (dmResult.step === 'message') {
        throw Errors.fromResponse(400, {
          error: 'Failed to send Discord message',
          code: 'MESSAGE_FAILED'
        })
      }
      throw Errors.fromResponse(400, {
        error:
          'Failed to send Discord message. The user may have DMs disabled.',
        code: 'DM_FAILED'
      })
    }

    logger.info('[Request API Key] Successfully sent API key request')

    return NextResponse.json({
      success: true,
      message: `Discord message sent to ${targetPlayer.display_name}`
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, '[Request API Key] Unexpected error')
    throw Errors.fromResponse(500, { error: 'An unexpected error occurred' })
  }
})
