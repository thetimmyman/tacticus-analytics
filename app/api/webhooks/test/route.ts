import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.webhooks.test')
import { throwUserFacingError } from '@/app/lib/errors/user-facing'
import type { DiscordWebhookPayload } from '@tacticus/app-core/common.types'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import { isClusterLeaderRole } from '@/app/lib/auth/role-predicates'
import {
  WEBHOOK_METADATA_COLUMNS,
  loadWebhookUrlById
} from '@/app/lib/webhooks/webhook-url-lookup'
import {
  DIAGNOSTIC_WEBHOOK_TYPE,
  isProactiveTokenManagementWebhookType,
  normalizeProactiveTokenManagementWebhookType,
  requireProactiveTokenManagementAccess,
  validateDiscordWebhookUrl
} from '@/app/lib/webhooks'
import { postDiscordWebhookWithTimeout } from '@/app/lib/discord/webhook-fetch'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'

interface WebhookTestConfig {
  id?: string
  webhook_type: string
  webhook_url: string | null
  enabled?: boolean | null
  guild_code?: string | null
}
type WebhookTestMessageFactory = (name: string) => DiscordWebhookPayload

const isDiagnosticMessagesGloballyDisabled = (): boolean =>
  process.env.DISABLE_DIAGNOSTIC_MESSAGES === 'true'

const TEST_MESSAGES: Record<string, WebhookTestMessageFactory> = {
  leaderboard: (name: string) => ({
    embeds: [
      {
        title: `🏆 ${name} Leaderboard Test`,
        description:
          'This is a test message for leaderboard webhook integration.',
        color: 0x5865f2,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          { name: 'Type', value: 'Leaderboard Updates', inline: true }
        ],
        footer: { text: 'Tacticus Analytics' },
        timestamp: new Date().toISOString()
      }
    ]
  }),

  sync_status: (name: string) => ({
    embeds: [
      {
        title: `✅ ${name} Sync Status Test`,
        description:
          'This is a test message for sync status webhook integration.',
        color: 0x57f287,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          { name: 'Type', value: 'Sync Status Updates', inline: true }
        ],
        footer: { text: 'Tacticus Analytics' },
        timestamp: new Date().toISOString()
      }
    ]
  }),

  gr_availability: (name: string) => ({
    embeds: [
      {
        title: `🎮 ${name} GR Availability Test`,
        description: 'This is a test message for GR availability webhook.',
        color: 0x57f287,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          { name: 'Type', value: 'Token Availability', inline: true }
        ],
        footer: { text: 'Tacticus Analytics' },
        timestamp: new Date().toISOString()
      }
    ]
  }),

  version_update: (name: string) => ({
    embeds: [
      {
        title: `🚀 ${name} Version Update Test`,
        description: 'This is a test message for version updates.',
        color: 0x5865f2,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          { name: 'Type', value: 'Version Updates', inline: true }
        ],
        footer: { text: 'Tacticus Analytics' },
        timestamp: new Date().toISOString()
      }
    ]
  }),

  event_notification: (name: string) => ({
    embeds: [
      {
        title: `📢 ${name} Event Test`,
        description: 'This is a test message for event notifications.',
        color: 0xeb459e,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          { name: 'Type', value: 'General Events', inline: true }
        ],
        footer: { text: 'Tacticus Analytics' },
        timestamp: new Date().toISOString()
      }
    ]
  }),

  boss_assignments: (name: string) => ({
    embeds: [
      {
        title: `📋 ${name} Boss Assignments Test`,
        description:
          'This is a test message for boss assignment notifications.',
        color: 0x57f287,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          { name: 'Type', value: 'Boss Assignments', inline: true },
          {
            name: 'Note',
            value:
              'When configured, upcoming season boss assignments will be posted here',
            inline: false
          }
        ],
        footer: { text: 'Tacticus Analytics' },
        timestamp: new Date().toISOString()
      }
    ]
  }),

  diagnostic_messages: (name: string) => ({
    embeds: [
      {
        title: `🧪 ${name} Diagnostic Messages Test`,
        description:
          'This is a test message for webhook diagnostic notifications.',
        color: 0x00b0f4,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          { name: 'Type', value: 'Diagnostic Messages', inline: true },
          {
            name: 'Note',
            value:
              'Automated diagnostic test posts will only be sent here when explicitly enabled',
            inline: false
          }
        ],
        footer: { text: 'Tacticus Analytics' },
        timestamp: new Date().toISOString()
      }
    ]
  }),

  herald: (name: string) => ({
    content:
      '🏆 **Example Boss** has been defeated!\nSlain by **Example Player** • Tier 5 • Set 2',
    embeds: [
      {
        title: `⚔️ ${name} Herald Test`,
        description:
          'Preview of Herald boss-defeat notifications. Actual posts will match the text above — real boss name, killer, tier, and set.',
        color: 0xffd700,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          { name: 'Type', value: 'Boss Defeat Alerts', inline: true },
          {
            name: 'Trigger',
            value: 'When a Legendary guild boss reaches 0 HP during sync',
            inline: false
          }
        ],
        footer: { text: 'Tacticus Analytics · Herald' },
        timestamp: new Date().toISOString()
      }
    ]
  }),

  token_cap_notification: (name: string) => ({
    embeds: [
      {
        title: `⚠️ ${name} Proactive Token Management Test`,
        description:
          'This is an alpha test message for proactive token notifications.',
        color: 0xffa500,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          {
            name: 'Type',
            value: 'Proactive Token Management (Alpha)',
            inline: true
          },
          {
            name: 'Note',
            value:
              'When configured, you will receive reminders for capped and near-cap players',
            inline: false
          }
        ],
        footer: {
          text: 'Automatic Detection - Checks every 30 minutes (Alpha)'
        },
        timestamp: new Date().toISOString()
      }
    ],
    username: 'Proactive Token Management'
  }),

  token_cap_alerts: (name: string) => ({
    embeds: [
      {
        title: `⚠️ ${name} Proactive Token Management Test`,
        description:
          'This is an alpha test message for proactive token notifications.',
        color: 0xffa500,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          {
            name: 'Type',
            value: 'Proactive Token Management (Alpha)',
            inline: true
          },
          {
            name: 'Note',
            value:
              'When configured, you will receive reminders for capped and near-cap players',
            inline: false
          }
        ],
        footer: {
          text: 'Automatic Detection - Checks every 30 minutes (Alpha)'
        },
        timestamp: new Date().toISOString()
      }
    ],
    username: 'Proactive Token Management'
  }),

  season_summary: (name: string) => ({
    embeds: [
      {
        title: `📊 ${name} Season Summary Test`,
        description: 'This is a test message for season summary notifications.',
        color: 0x5865f2,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          { name: 'Type', value: 'Season Summary', inline: true },
          {
            name: 'Note',
            value:
              'When configured, you will receive a summary at the end of each season',
            inline: false
          }
        ],
        footer: { text: 'Tacticus Analytics' },
        timestamp: new Date().toISOString()
      }
    ]
  }),

  daily_summary: (name: string) => ({
    embeds: [
      {
        title: `📅 ${name} Daily Summary Test`,
        description: 'This is a test message for daily summary notifications.',
        color: 0x57f287,
        fields: [
          { name: 'Status', value: '✅ Webhook Connected', inline: true },
          { name: 'Type', value: 'Daily Summary', inline: true },
          {
            name: 'Note',
            value: 'When configured, you will receive daily activity summaries',
            inline: false
          }
        ],
        footer: { text: 'Tacticus Analytics' },
        timestamp: new Date().toISOString()
      }
    ]
  })
}

export const POST = withErrorHandler(async (req: NextRequest) => {
  try {
    const supabase = await db()

    const {
      data: { user }
    } = await supabase.auth.getUser()
    if (!user) {
      throwUserFacingError(
        'AUTH_REQUIRED',
        'Authentication required to test webhook',
        401,
        { component: 'webhook-test', action: 'verify_auth' }
      )
    }
    await assertUnbannedAuthUser(user)

    const { webhook_id, webhook_type, webhook_url, custom_message, test_only } =
      await req.json()
    const normalizedInputType =
      typeof webhook_type === 'string'
        ? normalizeProactiveTokenManagementWebhookType(webhook_type)
        : webhook_type

    let webhookConfig: WebhookTestConfig | null = null
    let displayName = 'Test'

    if (webhook_id) {
      const { data, error } = await supabase
        .from('webhook_config')
        .select(WEBHOOK_METADATA_COLUMNS)
        .eq('id', webhook_id)
        .single()

      if (error || !data) {
        throw Errors.fromResponse(404, {
          error: 'Webhook configuration not found'
        })
      }

      if (data.guild_code) {
        await requireGuildOfficerOrClusterLeader(
          supabase,
          user.id,
          data.guild_code,
          '/api/webhooks/test'
        )
      } else if (data.cluster_id) {
        const { data: profile } = await supabase
          .from(CURRENT_USER_PLAYER_MAPPING)
          .select('role, guild_code')
          .eq('user_id', user.id)
          .eq('is_current', true)
          .single()

        if (
          !profile ||
          !isClusterLeaderRole(profile.role) ||
          !profile.guild_code
        ) {
          throw Errors.fromResponse(403, {
            error: 'Only leaders can test cluster webhooks'
          })
        }

        const userGuild = await GuildConfigService.getBasic(
          supabase,
          profile.guild_code
        )
        const { data: cluster } = await supabase
          .from('clusters')
          .select('cluster_code')
          .eq('id', data.cluster_id)
          .single()

        if (
          !userGuild ||
          !cluster ||
          userGuild.cluster_code !== cluster.cluster_code
        ) {
          throw Errors.fromResponse(403, {
            error: 'You can only test webhooks for your own cluster'
          })
        }
      } else {
        throw Errors.fromResponse(403, {
          error: 'Webhook scope is not configured'
        })
      }

      if (
        isProactiveTokenManagementWebhookType(
          normalizeProactiveTokenManagementWebhookType(data.webhook_type)
        )
      ) {
        await requireProactiveTokenManagementAccess(
          supabase,
          user.id,
          '/api/webhooks/test'
        )
      }

      webhookConfig = {
        ...data,
        webhook_url: await loadWebhookUrlById(data.id),
        webhook_type: normalizeProactiveTokenManagementWebhookType(
          data.webhook_type
        )
      }

      if (data.guild_code) {
        const guild = await GuildConfigService.getBasic(
          supabase,
          data.guild_code
        )
        displayName = guild?.display_name || data.guild_code
      } else if (data.cluster_id) {
        const { data: cluster } = await supabase
          .from('clusters')
          .select('display_name')
          .eq('id', data.cluster_id)
          .single()
        displayName = cluster?.display_name || 'Cluster'
      }
    } else if (normalizedInputType && webhook_url) {
      webhookConfig = {
        webhook_type: normalizedInputType,
        webhook_url
      }
    } else {
      throw Errors.fromResponse(400, {
        error: 'Either webhook_id or both webhook_type and webhook_url required'
      })
    }

    if (!webhookConfig) {
      throw Errors.fromResponse(500, {
        error: 'Webhook configuration could not be determined'
      })
    }

    if (!webhookConfig.webhook_url) {
      throw Errors.fromResponse(400, {
        error: 'Webhook URL is not configured'
      })
    }

    if (
      !webhook_id &&
      isProactiveTokenManagementWebhookType(webhookConfig.webhook_type)
    ) {
      await requireProactiveTokenManagementAccess(
        supabase,
        user.id,
        '/api/webhooks/test'
      )
    }

    // Validate first: a Discord channel URL returns 2xx from the SPA.
    const urlValidation = validateDiscordWebhookUrl(webhookConfig.webhook_url)
    if (!urlValidation.ok) {
      const body: Record<string, unknown> = {
        success: false,
        error: urlValidation.message,
        error_kind: urlValidation.kind
      }
      if ('hint' in urlValidation) body.hint = urlValidation.hint
      throw Errors.fromResponse(400, body)
    }

    if (test_only) {
      return NextResponse.json({
        success: true,
        message: 'Webhook URL is valid'
      })
    }

    const isDiagnosticWebhook =
      webhookConfig.webhook_type === DIAGNOSTIC_WEBHOOK_TYPE

    if (isDiagnosticWebhook && isDiagnosticMessagesGloballyDisabled()) {
      logger.warn(
        {
          webhook_type: webhookConfig.webhook_type,
          webhook_id: webhook_id ?? null,
          user_id: user.id
        },
        'Diagnostic webhook test blocked by global kill switch'
      )

      throw Errors.fromResponse(503, {
        success: false,
        error:
          'Diagnostic messages are globally disabled by system configuration'
      })
    }

    if (isDiagnosticWebhook) {
      if (!webhook_id) {
        throw Errors.fromResponse(400, {
          success: false,
          error:
            'Diagnostic messages tests require a saved guild webhook configuration'
        })
      }

      const isGuildDiagnosticOptedIn =
        webhookConfig.enabled === true &&
        typeof webhookConfig.guild_code === 'string' &&
        webhookConfig.guild_code.trim().length > 0

      if (!isGuildDiagnosticOptedIn) {
        logger.warn(
          {
            webhook_type: webhookConfig.webhook_type,
            webhook_id,
            guild_code: webhookConfig.guild_code ?? null,
            enabled: webhookConfig.enabled ?? null,
            user_id: user.id
          },
          'Diagnostic webhook test blocked: guild opt-in not enabled'
        )

        throw Errors.fromResponse(403, {
          success: false,
          error:
            'Enable guild Diagnostic Messages webhook before sending diagnostic tests'
        })
      }
    }

    let message: DiscordWebhookPayload
    if (custom_message) {
      message = { content: custom_message }
    } else {
      const messageGenerator = TEST_MESSAGES[webhookConfig.webhook_type]
      if (!messageGenerator) {
        message = {
          content: `Test message for ${webhookConfig.webhook_type} webhook - ${displayName}`
        }
      } else {
        message = messageGenerator(displayName)
      }
    }

    const response = await postDiscordWebhookWithTimeout(
      webhookConfig.webhook_url,
      message
    )

    if (!response.ok) {
      const errorText = await response.text()
      logger.error(
        {
          status: response.status,
          error: errorText,
          webhook_type: webhookConfig.webhook_type
        },
        'Discord webhook test failed:'
      )

      throw Errors.fromResponse(400, {
        error: `Discord returned error: ${response.status} - ${errorText}`,
        success: false
      })
    }

    if (webhook_id) {
      await supabase
        .from('webhook_config')
        .update({
          last_tested: new Date().toISOString(),
          updated_by: user.id
        })
        .eq('id', webhook_id)
    }

    logger.info(
      {
        webhook_type: webhookConfig.webhook_type,
        user_id: user.id
      },
      'Webhook test successful'
    )

    return NextResponse.json({
      success: true,
      message: 'Test message sent successfully!'
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error testing webhook:')
    throw Errors.fromResponse(500, { error: 'Failed to test webhook' })
  }
})
