import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { formatLeaderboardEmbed } from '@/app/lib/discord/formatters'
import {
  logDiscordWebhookDelivery,
  postToWebhook
} from '@/app/lib/discord/webhook-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.discord-webhooks.leaderboard')
import { validateWebhookManagementAccess } from '@/app/lib/utils/cluster-validation'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { loadWebhookCallerProfile } from '@/app/api/discord-webhooks/_shared/caller-profile'
import type { PlayerMapping } from '@tacticus/app-core/types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { findWebhookForGuild } from '@/app/lib/webhooks/webhook-helper'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

interface OverallPlayer {
  display_name: string
  total_damage: number
  battle_count: number
  guild_code: string
}

interface BossPlayer {
  display_name: string
  boss_name: string
  damage: number
}

interface PrimePlayer {
  display_name: string
  prime1_damage?: number
  prime2_damage?: number
}

type LeaderboardPayload =
  | {
      type: 'overall_leaderboard'
      season: string
      data: OverallPlayer[]
      guild?: string
    }
  | {
      type: 'boss_leaderboard'
      season: string
      data: BossPlayer[]
      guild?: string
    }
  | {
      type: 'prime_leaderboard'
      season: string
      data: PrimePlayer[]
      guild?: string
    }

const isLeaderboardPayload = (value: unknown): value is LeaderboardPayload => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const payload = value as Record<string, unknown>
  if (
    payload.type !== 'overall_leaderboard' &&
    payload.type !== 'boss_leaderboard' &&
    payload.type !== 'prime_leaderboard'
  ) {
    return false
  }

  if (typeof payload.season !== 'string') {
    return false
  }

  if (!Array.isArray(payload.data)) {
    return false
  }

  return true
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  try {
    const supabase = await db()

    const user = await requireSessionUser(supabase, () =>
      Errors.authenticationRequired(
        'Authentication required to post Discord leaderboards',
        { endpoint: '/api/discord-webhooks/leaderboard' }
      )
    )

    const profile = await loadWebhookCallerProfile(
      supabase,
      user.id,
      '/api/discord-webhooks/leaderboard'
    )

    if (!profile || !canManageHeraldRole(profile.role)) {
      logger.warn(
        {
          user_id: user.id,
          role: profile?.role,
          guild: profile?.guild_code
        },
        'Insufficient permissions for leaderboard posting'
      )
      throw Errors.insufficientPermissions(
        'Only officers and leaders can post leaderboards',
        { endpoint: '/api/discord-webhooks/leaderboard' }
      )
    }

    let requestBody: unknown
    try {
      requestBody = await req.json()
    } catch (error) {
      rethrowIfAppError(error)
      logger.error({ error }, 'Invalid JSON in leaderboard request')
      throw Errors.invalidRequest('Invalid JSON in request body', {
        endpoint: '/api/discord-webhooks/leaderboard'
      })
    }

    if (!isLeaderboardPayload(requestBody)) {
      logger.warn(
        { userGuild: profile.guild_code },
        'Invalid leaderboard payload received'
      )
      throw Errors.invalidRequest(
        'Invalid leaderboard payload. Ensure type, season, and data are present.',
        { endpoint: '/api/discord-webhooks/leaderboard' }
      )
    }

    const { type, season, data, guild } = requestBody

    const targetGuild = guild || profile.guild_code

    if (!targetGuild) {
      throw Errors.invalidRequest(
        'No guild specified and user has no guild_code',
        { endpoint: '/api/discord-webhooks/leaderboard', user_id: user.id }
      )
    }

    if (targetGuild !== profile.guild_code) {
      const accessValidation = await validateWebhookManagementAccess(
        profile as PlayerMapping,
        targetGuild ?? undefined
      )
      if (!accessValidation.valid) {
        logger.warn(
          {
            user_id: user.id,
            userGuild: profile?.guild_code,
            targetGuild: targetGuild,
            role: profile?.role,
            error: accessValidation.error
          },
          'Access denied for leaderboard webhook management'
        )
        throw Errors.insufficientPermissions(
          `Access denied: ${accessValidation.error}`,
          {
            endpoint: '/api/discord-webhooks/leaderboard',
            user_id: user.id,
            guild_code: profile?.guild_code ?? undefined,
            target_guild: targetGuild,
            suggestion:
              'You can only post leaderboards for guilds in your cluster'
          }
        )
      }
    }

    const webhookUrl = await findWebhookForGuild(targetGuild, 'leaderboard')

    if (!webhookUrl) {
      logger.warn(
        {
          targetGuild: targetGuild,
          userGuild: profile.guild_code,
          type: 'leaderboard'
        },
        'No webhook found for leaderboard posting'
      )
      throw Errors.webhookNotConfigured(targetGuild, 'leaderboard')
    }

    // Relabel duplicate-name members for display.
    const memberLabels = await getMemberLabelMap()
    const relabelledData = (data as Array<{ display_name: string }>).map(
      (entry) => ({
        ...entry,
        display_name: resolveMemberLabel(entry.display_name, memberLabels)
      })
    )

    const payload = formatLeaderboardEmbed({
      type,
      season,
      data: relabelledData
    } as LeaderboardPayload)

    const postResult = await postToWebhook(webhookUrl, payload, {
      guildCode: targetGuild,
      webhookType: type,
      logDelivery: logDiscordWebhookDelivery
    })

    if (!postResult.ok) {
      logger.error(
        {
          status: postResult.status,
          error: postResult.error?.message,
          guild: profile.guild_code,
          type,
          season
        },
        'Discord webhook rejected leaderboard'
      )

      if (postResult.error?.type === 'rate_limited') {
        throw Errors.rateLimit()
      }

      if (postResult.error?.type === 'invalid_webhook') {
        throw Errors.discordWebhookInvalid(
          'Discord webhook is invalid. Please check the webhook URL.',
          {
            endpoint: '/api/discord-webhooks/leaderboard'
          }
        )
      }

      throw Errors.external(
        `Discord API error (${postResult.status ?? 'unknown'}): ${postResult.error?.message || 'Unknown error'}`,
        postResult.status ?? 502,
        {
          endpoint: '/api/discord-webhooks/leaderboard'
        }
      )
    }

    logger.info(
      {
        type,
        season,
        targetGuild: targetGuild,
        userGuild: profile.guild_code,
        user_id: user.id,
        role: profile.role,
        dataCount: data.length,
        webhookUsed: 'leaderboard-specific'
      },
      'Leaderboard posted successfully'
    )

    return NextResponse.json({
      success: true,
      data: {
        type,
        season,
        targetGuild: targetGuild,
        userGuild: profile.guild_code,
        posted_at: new Date().toISOString()
      },
      message: 'Leaderboard posted successfully'
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error posting leaderboard:')
    throw Errors.notificationSendFailed(
      'Failed to post leaderboard to Discord.',
      {
        endpoint: '/api/discord-webhooks/leaderboard',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    )
  }
})
