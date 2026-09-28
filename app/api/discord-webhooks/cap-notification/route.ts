import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { formatTokenCapAlert } from '@/app/lib/discord/formatters'
import {
  logDiscordWebhookDelivery,
  postToWebhook
} from '@/app/lib/discord/webhook-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.discord-webhooks.cap-notification')
import { validateWebhookManagementAccess } from '@/app/lib/utils/cluster-validation'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { loadWebhookCallerProfile } from '@/app/api/discord-webhooks/_shared/caller-profile'
import type { PlayerMapping } from '@tacticus/app-core/types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { loadGuildTokenStatuses } from '@/app/api/guild-tokens/token-service'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'
import { loadWebhookUrlById } from '@/app/lib/webhooks/webhook-url-lookup'

type CapNotificationPayload = {
  guild_code?: string
  manual?: boolean
}

const isCapNotificationPayload = (
  value: unknown
): value is CapNotificationPayload => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  return true
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      logger.warn({ authError }, '[Cap Notification] Unauthorized request')
      throw Errors.authenticationRequired(
        'Authentication required to send cap notifications',
        { endpoint: '/api/discord-webhooks/cap-notification' }
      )
    }
    await assertUnbannedAuthUser(user)

    const profile = await loadWebhookCallerProfile(
      supabase,
      user.id,
      '/api/discord-webhooks/cap-notification'
    )

    if (!profile || !canManageHeraldRole(profile.role)) {
      logger.warn(
        {
          user_id: user.id,
          role: profile?.role,
          guild: profile?.guild_code
        },
        'Insufficient permissions for cap notification'
      )
      throw Errors.insufficientPermissions(
        'Only officers and leaders can send cap notifications',
        {
          endpoint: '/api/discord-webhooks/cap-notification',
          user_id: user.id,
          guild_code: profile?.guild_code ?? undefined
        }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      rethrowIfAppError(error)
      logger.error({ error }, '[Cap Notification] Failed to parse request body')
      throw Errors.invalidRequest('Invalid request body - expected JSON', {
        endpoint: '/api/discord-webhooks/cap-notification'
      })
    }

    if (!isCapNotificationPayload(body)) {
      throw Errors.invalidRequest('Invalid cap notification payload.', {
        endpoint: '/api/discord-webhooks/cap-notification'
      })
    }

    const { guild_code, manual = false } = body

    const targetGuild = guild_code || profile.guild_code
    if (!targetGuild) {
      throw Errors.validation('Guild code is required', {
        endpoint: '/api/discord-webhooks/cap-notification'
      })
    }

    if (targetGuild !== profile.guild_code) {
      const accessValidation = await validateWebhookManagementAccess(
        profile as PlayerMapping,
        targetGuild ?? ''
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
          'Access denied for cap notification webhook management'
        )
        throw Errors.insufficientPermissions(
          `Access denied: ${accessValidation.error}`,
          {
            endpoint: '/api/discord-webhooks/cap-notification',
            user_id: user.id,
            guild_code: profile?.guild_code ?? undefined,
            target_guild: targetGuild ?? undefined,
            suggestion:
              'You can only manage webhooks for guilds in your cluster'
          }
        )
      }
    }
    // "Season" is TEXT, so ORDER BY desc sorts lexically ("9" > "83").
    const { data: rpcSeason } = await supabase.rpc(
      'get_latest_season_for_guild',
      { p_guild: targetGuild }
    )
    const currentSeason = rpcSeason ? String(rpcSeason) : '83'
    const serviceSupabase = serviceDb()
    const guildInfo = await GuildConfigService.getBasic(
      serviceSupabase,
      targetGuild
    )
    const clusterCode = guildInfo?.cluster_code || null
    const { players: tokenPlayers } = await loadGuildTokenStatuses(
      serviceSupabase,
      {
        guildCode: targetGuild,
        season: currentSeason,
        clusterCode,
        verifyLiveRoster: false
      }
    )

    if (tokenPlayers.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          message: 'No token data found for this guild in current season',
          capped_players: [],
          guild_code: targetGuild,
          season: currentSeason
        },
        message: 'No token data found - no cap notification needed'
      })
    }

    const cappedPlayers = tokenPlayers
      .filter((player) => player.tokens_available >= 3)
      .map((player) => ({
        name: player.display_name,
        tokens: player.tokens_available,
        lastBattle: player.last_battle_time
      }))
    if (cappedPlayers.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          message: 'No players are currently at token cap',
          capped_players: [],
          guild_code: targetGuild
        },
        message: 'No capped players - no notification needed'
      })
    }
    const { data: webhookConfig } = await supabase
      .from('webhook_config')
      .select('id')
      .eq('guild_code', targetGuild)
      .eq('webhook_type', 'token_cap_notification')
      .eq('enabled', true)
      .single()
    const webhookUrl = webhookConfig?.id
      ? await loadWebhookUrlById(webhookConfig.id)
      : null
    if (!webhookUrl) {
      throw Errors.webhookNotConfigured(targetGuild, 'token_cap_notification')
    }

    // Labels for the Discord text only; `capped_players` keeps the suffixed display_name.
    const memberLabels = await getMemberLabelMap()
    const payload = formatTokenCapAlert(
      cappedPlayers.map((player) => ({
        name: resolveMemberLabel(player.name, memberLabels),
        tokens: player.tokens
      })),
      {
        guildName: guildInfo?.display_name,
        guildCode: targetGuild,
        manual
      }
    )

    const postResult = await postToWebhook(
      webhookUrl,
      { ...payload, username: 'Token Cap Alert' },
      {
        guildCode: targetGuild,
        webhookType: 'token_cap_notification',
        logDelivery: logDiscordWebhookDelivery
      }
    )

    if (!postResult.ok) {
      logger.error(
        {
          status: postResult.status,
          error: postResult.error?.message,
          guild_code: targetGuild
        },
        'Discord API error for cap notification'
      )

      if (postResult.error?.type === 'rate_limited') {
        throw Errors.rateLimit()
      }

      if (postResult.error?.type === 'invalid_webhook') {
        if (postResult.status === 404) {
          throw Errors.discordWebhookInvalid(
            'Discord webhook not found. Please check the webhook URL is correct.',
            {
              endpoint: '/api/discord-webhooks/cap-notification',
              guild_code: targetGuild,
              details:
                'Webhook URL may be incorrect or webhook may have been deleted'
            }
          )
        }

        if (postResult.status === 401 || postResult.status === 403) {
          throw Errors.discordWebhookInvalid(
            'Discord webhook authentication failed. The webhook may have been deleted or regenerated.',
            {
              endpoint: '/api/discord-webhooks/cap-notification',
              guild_code: targetGuild,
              details: 'Webhook authentication failed'
            }
          )
        }

        if (postResult.status === 400) {
          throw Errors.external(
            `Discord rejected the message: ${postResult.error.message}`,
            400,
            {
              endpoint: '/api/discord-webhooks/cap-notification',
              guild_code: targetGuild,
              details: 'Discord API rejected the message format'
            }
          )
        }
      }

      throw Errors.external(
        `Discord API error (${postResult.status ?? 'unknown'}): ${postResult.error?.message || 'Unknown error'}`,
        502,
        {
          endpoint: '/api/discord-webhooks/cap-notification',
          guild_code: targetGuild,
          details: postResult.responseBody || 'Discord API request failed'
        }
      )
    }
    logger.info(
      {
        guild_code: targetGuild,
        cappedPlayersCount: cappedPlayers.length,
        manual
      },
      'Cap notification sent successfully'
    )

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        message: `Notification sent for ${cappedPlayers.length} capped players`,
        capped_players: cappedPlayers,
        guild_code: targetGuild
      },
      message: `Token cap notification sent successfully for ${cappedPlayers.length} players`
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: '/api/discord-webhooks/cap-notification'
      },
      'Error in cap notification:'
    )

    throw Errors.notificationSendFailed(
      'Failed to send token cap notification',
      {
        endpoint: '/api/discord-webhooks/cap-notification',
        details: error instanceof Error ? error.message : 'Unknown error',
        retryable: true
      }
    )
  }
})
