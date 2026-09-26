import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.discord-webhooks.event-notification')
import { formatNumber } from '@tacticus/app-core/formatters'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { formatGuildCodeFallback } from '@/app/lib/format/guild'
import { requireCronSecret } from '@/app/lib/scheduler/require-cron-secret'
import { postDiscordWebhookWithTimeout } from '@/app/lib/discord/webhook-fetch'
import { throwDiscordWebhookError } from '@/app/lib/discord/webhook-error-mapping'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

type NewMemberEvent = {
  display_name?: string
  guild_code?: string
  joined_at?: string
}

type SeasonSummaryStats = {
  total_damage?: number
  total_battles?: number
  active_players?: number
  bosses_defeated?: number
  avg_damage?: number
  top_performer?: string
}

type SeasonSummaryEvent = {
  season: string | number
  stats: SeasonSummaryStats
}

type TechnicalSummaryEvent = {
  type?: string
  status: 'success' | 'warning' | 'error' | string
  details?: string
  metrics?: Record<string, string | number | boolean>
}

type EventNotificationPayload =
  | { type: 'new_member'; data: NewMemberEvent }
  | { type: 'season_summary'; data: SeasonSummaryEvent }
  | { type: 'technical_summary'; data: TechnicalSummaryEvent }

type WebhookConfig = {
  webhook_url: string | null
  enabled: boolean | null
  cluster_id: number | null
}

const isEventNotificationPayload = (
  value: unknown
): value is EventNotificationPayload => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const payload = value as Record<string, unknown>
  if (
    payload.type !== 'new_member' &&
    payload.type !== 'season_summary' &&
    payload.type !== 'technical_summary'
  ) {
    return false
  }

  if (typeof payload.data !== 'object' || payload.data === null) {
    return false
  }

  return true
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  try {
    // Machine route for pg_cron with CRON_SECRET; fails closed so no caller can fan out notifications.
    requireCronSecret(req)

    const supabase = serviceDb()

    let body: unknown
    try {
      body = await req.json()
    } catch (error) {
      rethrowIfAppError(error)
      logger.error(
        { error },
        '[Event Notification] Failed to parse request body'
      )
      throw Errors.invalidRequest('Invalid request body - expected JSON', {
        endpoint: '/api/discord-webhooks/event-notification'
      })
    }

    if (!isEventNotificationPayload(body)) {
      throw Errors.invalidRequest(
        'Invalid event notification payload. Please provide type and data.',
        { endpoint: '/api/discord-webhooks/event-notification' }
      )
    }

    const { type, data } = body

    if (!type || !data) {
      throw Errors.invalidRequest(
        'Missing required fields: type and data are required',
        { endpoint: '/api/discord-webhooks/event-notification' }
      )
    }

    let webhookConfig: WebhookConfig | null = null

    const { data: specificWebhook } = await supabase
      .from('webhook_config')
      .select('webhook_url, enabled, cluster_id')
      .eq('webhook_type', type)
      .eq('enabled', true)
      .limit(1)
      .maybeSingle()

    if (
      specificWebhook?.webhook_url &&
      !specificWebhook.webhook_url.includes('YOUR_WEBHOOK')
    ) {
      webhookConfig = specificWebhook as WebhookConfig
    } else {
      const { data: eventWebhook } = await supabase
        .from('webhook_config')
        .select('webhook_url, enabled, cluster_id')
        .eq('webhook_type', 'event_notification')
        .eq('enabled', true)
        .limit(1)
        .maybeSingle()

      if (
        eventWebhook?.webhook_url &&
        !eventWebhook.webhook_url.includes('YOUR_WEBHOOK')
      ) {
        webhookConfig = eventWebhook as WebhookConfig
      }
    }

    logger.info(
      {
        requestedType: type,
        foundConfig: !!webhookConfig,
        isEnabled: webhookConfig?.enabled,
        hasValidUrl:
          webhookConfig?.webhook_url &&
          !webhookConfig.webhook_url.includes('YOUR_WEBHOOK')
      },
      'Webhook discovery for event notifications'
    )

    if (
      !webhookConfig?.enabled ||
      !webhookConfig.webhook_url ||
      webhookConfig.webhook_url.includes('YOUR_WEBHOOK')
    ) {
      if (
        !webhookConfig ||
        !webhookConfig.webhook_url ||
        webhookConfig.webhook_url.includes('YOUR_WEBHOOK')
      ) {
        throw Errors.webhookNotConfigured('system', type)
      } else {
        throw Errors.webhookDisabled('system', type)
      }
    }

    let message: { embeds: unknown[] }

    // Labels for the embed only; the raw display value stays the join key.
    const memberLabels = await getMemberLabelMap()

    switch (type) {
      case 'new_member':
        message = formatNewMemberNotification({
          ...data,
          display_name: resolveMemberLabel(data.display_name, memberLabels)
        })
        break
      case 'season_summary':
        message = formatSeasonSummary({
          ...data,
          stats: {
            ...data.stats,
            top_performer: resolveMemberLabel(
              data.stats.top_performer,
              memberLabels
            )
          }
        })
        break
      case 'technical_summary':
        message = formatTechnicalSummary(data)
        break
      default:
        throw Errors.invalidRequest(`Invalid event type: ${type}`, {
          endpoint: '/api/discord-webhooks/event-notification',
          details:
            'Supported event types: new_member, season_summary, technical_summary'
        })
    }

    const response = await postDiscordWebhookWithTimeout(
      webhookConfig.webhook_url,
      message
    )

    if (!response.ok) {
      await throwDiscordWebhookError(response, {
        endpoint: '/api/discord-webhooks/event-notification',
        logger,
        logMessage: 'Discord API error for event notification',
        logContext: { eventType: type },
        genericStatus: 502
      })
    }

    await supabase
      .from('webhook_config')
      .update({ last_tested: new Date().toISOString() })
      .eq('webhook_type', type)

    logger.info({ eventType: type }, 'Event notification sent successfully')
    return NextResponse.json({
      success: true,
      data: { success: true },
      message: `Event notification for ${type} sent successfully to Discord`
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: '/api/discord-webhooks/event-notification'
      },
      'Error sending event notification:'
    )

    throw Errors.notificationSendFailed(
      'Failed to send event notification to Discord',
      {
        endpoint: '/api/discord-webhooks/event-notification',
        details: error instanceof Error ? error.message : 'Unknown error',
        retryable: true
      }
    )
  }
})

function formatNewMemberNotification(data: NewMemberEvent) {
  return {
    embeds: [
      {
        title: '👋 New Member Joined!',
        description: `Welcome to the guild!`,
        color: 0x00ff00, // Green color
        fields: [
          {
            name: 'Player Name',
            value: data.display_name || 'Unknown',
            inline: true
          },
          {
            name: 'Guild',
            value: data.guild_code
              ? formatGuildCodeFallback(data.guild_code)
              : 'Unknown',
            inline: true
          },
          {
            name: 'Joined At',
            value: new Date(data.joined_at || Date.now()).toLocaleString(),
            inline: true
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Tacticus Analytics'
        }
      }
    ]
  }
}

function formatSeasonSummary(data: SeasonSummaryEvent) {
  const { season, stats } = data

  return {
    embeds: [
      {
        title: `📊 Season ${season} Summary`,
        description: 'Season has ended! Here are the final statistics:',
        color: 0x4b0082, // Indigo color
        fields: [
          {
            name: '🏆 Total Damage',
            value: formatNumber(stats.total_damage),
            inline: true
          },
          {
            name: '⚔️ Total Battles',
            value: formatNumber(stats.total_battles),
            inline: true
          },
          {
            name: '👥 Active Players',
            value: formatNumber(stats.active_players),
            inline: true
          },
          {
            name: '🎯 Bosses Defeated',
            value: formatNumber(stats.bosses_defeated),
            inline: true
          },
          {
            name: '💎 Average Damage/Battle',
            value: formatNumber(stats.avg_damage),
            inline: true
          },
          {
            name: '🌟 Top Performer',
            value: stats.top_performer || 'N/A',
            inline: true
          }
        ],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Tacticus Analytics'
        }
      }
    ]
  }
}

function formatTechnicalSummary(data: TechnicalSummaryEvent) {
  const { type: summaryType, status, details, metrics } = data

  let color = 0x808080 // Gray default
  if (status === 'success')
    color = 0x00ff00 // Green
  else if (status === 'warning')
    color = 0xffff00 // Yellow
  else if (status === 'error') color = 0xff0000 // Red

  const fields = []

  fields.push({
    name: '📊 Status',
    value: status.toUpperCase(),
    inline: true
  })

  if (summaryType) {
    fields.push({
      name: '🔧 Function Type',
      value: summaryType,
      inline: true
    })
  }

  if (metrics) {
    Object.entries(metrics).forEach(([key, value]) => {
      const formattedValue =
        typeof value === 'number' ? formatNumber(value) : String(value)
      fields.push({
        name: key.replace(/_/g, ' ').replace(/\b\w/g, (l) => l.toUpperCase()),
        value: formattedValue,
        inline: true
      })
    })
  }

  if (details) {
    fields.push({
      name: '📝 Details',
      value: details.substring(0, 1024), // Discord limit
      inline: false
    })
  }

  return {
    embeds: [
      {
        title: '🔧 Technical Summary',
        description: 'System function execution report',
        color,
        fields,
        timestamp: new Date().toISOString(),
        footer: {
          text: 'Tacticus Analytics - Technical Report'
        }
      }
    ]
  }
}
