import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.discord-webhooks.new-member')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { requireHeaderSecret } from '@/app/lib/auth/require-header-secret'
import { getClientIp } from '@/app/lib/middleware/rate-limit'
import { postDiscordWebhookWithTimeout } from '@/app/lib/discord/webhook-fetch'
import { sleep as delay } from '@/app/lib/utils/async-timeout'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities
} from '@/app/lib/auth/verified-player-authority'

const RATE_LIMIT_WINDOW_MS = 60_000
const RATE_LIMIT_MAX_REQUESTS = 12
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504])
const DISABLE_WEBHOOK =
  process.env.DISABLE_DISCORD_NEW_MEMBER_WEBHOOK === 'true'
const WEBHOOK_SECRET = process.env.DISCORD_WEBHOOK_SECRET?.trim()

type RateLimitEntry = {
  count: number
  resetAt: number
}

const rateLimitStore = new Map<string, RateLimitEntry>()

const sanitizeForDiscord = (value: string | undefined | null) => {
  if (!value) return ''
  // Prevents mass pings and markdown edge cases.
  return value
    .replace(/@(everyone|here)/gi, '@$1 (blocked)')
    .replace(/<@&\d+>/g, '@role (blocked)')
    .replace(/\r?\n/g, ' ')
    .trim()
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sendDiscordWithRetry = async (webhookUrl: string, payload: any) => {
  const attempt = async () => {
    return postDiscordWebhookWithTimeout(webhookUrl, payload)
  }

  let response: Response
  try {
    response = await attempt()
  } catch {
    await delay(600 + Math.floor(Math.random() * 400))
    return attempt()
  }

  if (response.ok || !RETRYABLE_STATUS.has(response.status)) {
    return response
  }

  await delay(600 + Math.floor(Math.random() * 400)) // jitter to avoid thundering herd
  return attempt()
}

export const GET = withErrorHandler(async () => {
  try {
    const supabase = serviceDb()

    const { data: configs, error } = await supabase
      .from('webhook_config')
      .select('id, webhook_url, enabled, guild_code, cluster_id')
      .eq('webhook_type', 'new_member')

    if (error) {
      throw Errors.internal('Failed to load webhook configuration', {
        endpoint: '/api/discord-webhooks/new-member'
      })
    }

    const rows = configs || []
    const total = rows.length
    const enabled = rows.filter((r) => r.enabled).length
    const invalidUrl = rows.filter(
      (r) => !r.webhook_url || !r.webhook_url.startsWith('http')
    ).length

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        disabled_by_flag: DISABLE_WEBHOOK,
        total,
        enabled,
        invalid_url: invalidUrl
      },
      message: 'New member webhook health check'
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, '[New Member] Health check failed')
    throw Errors.internal('Health check failed', {
      endpoint: '/api/discord-webhooks/new-member'
    })
  }
})

type NewMemberPayload = {
  playerData: {
    displayName?: string
    guildCode?: string
    tacticusUserId?: string
  }
}

const isNewMemberPayload = (value: unknown): value is NewMemberPayload => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const payload = value as Record<string, unknown>
  if (typeof payload.playerData !== 'object' || payload.playerData === null) {
    return false
  }

  return true
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    if (DISABLE_WEBHOOK) {
      return NextResponse.json({
        success: true,
        data: {
          success: true,
          webhook_sent: false,
          reason: 'New member webhook temporarily disabled'
        },
        message: 'New member webhook is disabled by configuration'
      })
    }

    requireHeaderSecret(request, {
      secret: WEBHOOK_SECRET,
      headerName: 'x-webhook-secret',
      endpoint: '/api/discord-webhooks/new-member'
    })

    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      rethrowIfAppError(error)
      logger.error({ error }, '[New Member] Failed to parse request body')
      throw Errors.invalidRequest('Invalid request body - expected JSON', {
        endpoint: '/api/discord-webhooks/new-member'
      })
    }

    if (!isNewMemberPayload(body)) {
      throw Errors.invalidRequest('Invalid payload: playerData is required.', {
        endpoint: '/api/discord-webhooks/new-member'
      })
    }

    const { playerData } = body

    if (!playerData) {
      throw Errors.invalidRequest(
        'Missing required field: playerData is required',
        { endpoint: '/api/discord-webhooks/new-member' }
      )
    }

    // cf-connecting-ip first; never trust the caller-controlled first x-forwarded-for hop.
    const requesterIp = getClientIp(request)
    const now = Date.now()
    const existingEntry = rateLimitStore.get(requesterIp)
    if (!existingEntry || existingEntry.resetAt <= now) {
      rateLimitStore.set(requesterIp, {
        count: 1,
        resetAt: now + RATE_LIMIT_WINDOW_MS
      })
    } else if (existingEntry.count >= RATE_LIMIT_MAX_REQUESTS) {
      throw Errors.rateLimit()
    } else {
      rateLimitStore.set(requesterIp, {
        ...existingEntry,
        count: existingEntry.count + 1
      })
    }

    const supabase = serviceDb()

    const { data: player } = await supabase
      .from('player_mapping')
      .select(
        'id, player_id, guild_code, display_name, user_id, discord_user_id'
      )
      .eq('player_id', playerData.tacticusUserId || '')
      .eq('is_current', true)
      .maybeSingle()

    // Signup may still be in progress.
    const guildCode = player?.guild_code || playerData.guildCode
    const displayName =
      player?.display_name || playerData.displayName || 'New member'
    // Friendly label for the Discord text only.
    const memberLabels = await getMemberLabelMap()
    const safeDisplayName = sanitizeForDiscord(
      resolveMemberLabel(displayName, memberLabels)
    )
    const tacticusUserId = playerData.tacticusUserId

    if (!guildCode || !tacticusUserId) {
      logger.info(
        'Incomplete data for new member notification, skipping webhook'
      )
      return NextResponse.json({
        success: true,
        data: {
          success: true,
          message: 'Skipping webhook - incomplete player data',
          webhook_sent: false,
          reason: 'Missing guild code or user ID'
        },
        message: 'New member notification skipped due to incomplete data'
      })
    }

    const guild = await GuildConfigService.getBasic(supabase, guildCode)
    const guildLabel = formatGuildDisplayLabel(guild, guildCode)

    let webhookUrl = null

    let webhookSourceId: string | null = null
    const { data: guildWebhook } = await supabase
      .from('webhook_config')
      .select('id, webhook_url, enabled')
      .eq('webhook_type', 'new_member')
      .eq('guild_code', guildCode)
      .eq('enabled', true)
      .maybeSingle()

    if (guildWebhook?.webhook_url) {
      webhookUrl = guildWebhook.webhook_url
      webhookSourceId = guildWebhook.id
    } else if (guild?.cluster_code) {
      const { data: cluster } = await supabase
        .from('clusters')
        .select('id')
        .eq('cluster_code', guild.cluster_code)
        .maybeSingle()

      if (cluster) {
        const { data: clusterWebhook } = await supabase
          .from('webhook_config')
          .select('id, webhook_url, enabled')
          .eq('webhook_type', 'new_member')
          .eq('cluster_id', cluster.id)
          .eq('enabled', true)
          .maybeSingle()

        if (clusterWebhook?.webhook_url) {
          webhookUrl = clusterWebhook.webhook_url
          webhookSourceId = clusterWebhook.id
        }
      }
    }

    if (!webhookUrl) {
      logger.info(
        { guildCode: guildCode },
        'No new_member webhook configured for guild:'
      )
      return NextResponse.json({
        success: true,
        data: {
          success: true,
          message: 'No new member webhook configured for this guild',
          webhook_sent: false,
          guild_code: guildCode,
          reason: 'No webhook configured'
        },
        message: 'New member notification skipped - no webhook configured'
      })
    }

    if (typeof webhookUrl !== 'string' || !webhookUrl.startsWith('http')) {
      logger.warn(
        { guild_code: guildCode },
        'Invalid webhook URL for new_member, skipping send'
      )
      return NextResponse.json({
        success: true,
        data: {
          success: true,
          message: 'Invalid webhook configuration for this guild',
          webhook_sent: false,
          guild_code: guildCode,
          reason: 'Webhook URL invalid'
        },
        message: 'New member notification skipped - invalid webhook URL'
      })
    }

    let discordMention: string | null = null
    if (player?.user_id && player.discord_user_id) {
      const verified = await resolveVerifiedDiscordIdentities(supabase, [
        player.discord_user_id
      ])
      const identity = findVerifiedDiscordForMapping(verified, {
        mappingId: player.id,
        playerId: player.player_id,
        userId: player.user_id,
        guildCode: player.guild_code,
        discordUserId: player.discord_user_id
      })
      if (identity) {
        discordMention = `<@${identity.discordUserId}>`
      }
    }

    const embed = {
      title: '🎉 New Member Joined!',
      color: 0x00ff00, // Green
      timestamp: new Date().toISOString(),
      fields: [
        {
          name: 'Player',
          value: discordMention || `**${safeDisplayName}**`,
          inline: false
        },
        {
          name: 'Guild',
          value: guildLabel,
          inline: true
        },
        {
          name: 'Join Date',
          value: new Date().toLocaleDateString(),
          inline: true
        },
        {
          name: 'Account Status',
          value: '✅ Dashboard Access Granted',
          inline: true
        }
      ],
      footer: {
        text: `${guildLabel} Member System`
      }
    }

    const response = await sendDiscordWithRetry(webhookUrl, {
      content: discordMention
        ? `Welcome to ${guildLabel}, ${discordMention}! 🎊`
        : `Welcome to ${guildLabel}, **${safeDisplayName}**! 🎊`,
      embeds: [embed]
    })

    if (!response.ok) {
      let errorText = ''
      try {
        errorText = await response.text()
      } catch {
        errorText = 'Could not parse error response'
      }

      if (webhookSourceId && [401, 403, 404].includes(response.status)) {
        const { error: disableError } = await supabase
          .from('webhook_config')
          .update({ enabled: false })
          .eq('id', webhookSourceId)

        if (disableError) {
          logger.warn(
            {
              webhook_id: webhookSourceId,
              status: response.status,
              error: disableError
            },
            'Failed to disable invalid webhook after Discord error'
          )
        } else {
          logger.warn(
            {
              webhook_id: webhookSourceId,
              status: response.status
            },
            'Disabled invalid webhook after Discord error'
          )
        }
      }

      logger.error(
        {
          status: response.status,
          statusText: response.statusText,
          error: errorText,
          guild_code: guildCode,
          player: displayName
        },
        'Discord webhook failed for new member:'
      )

      return NextResponse.json({
        success: true,
        data: {
          success: true,
          warning:
            'Webhook notification failed but member was added successfully',
          webhook_sent: false,
          guild_code: guildCode,
          discord_error: `${response.status}: ${errorText}`,
          reason: 'Discord API error'
        },
        message: 'Member added successfully but Discord notification failed'
      })
    }

    logger.info(
      {
        guild_code: guildCode,
        player_id: tacticusUserId,
        player_name: displayName,
        mentioned: !!discordMention
      },
      'New member notification sent successfully'
    )

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        message: 'New member notification sent to Discord',
        webhook_sent: true,
        guild_code: guildCode,
        player_name: displayName
      },
      message: 'New member notification sent successfully to Discord'
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: '/api/discord-webhooks/new-member'
      },
      'Error sending new member notification:'
    )

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        warning: 'Could not send Discord notification but member was added',
        webhook_sent: false,
        reason: 'Internal error',
        error_details: error instanceof Error ? error.message : 'Unknown error'
      },
      message:
        'Member added successfully but notification failed due to internal error'
    })
  }
})
