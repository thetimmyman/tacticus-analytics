import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { readFile } from 'fs/promises'
import path from 'path'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.discord-webhooks.version-update')
import {
  DISCORD_WEBHOOK_CONFIG,
  getWebhookUrlWithThread,
  getEmbedColor
} from '@/config/discord-webhooks'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireHeaderSecret } from '@/app/lib/auth/require-header-secret'
import { postDiscordWebhookWithTimeout } from '@/app/lib/discord/webhook-fetch'
import { throwDiscordWebhookError } from '@/app/lib/discord/webhook-error-mapping'

const DISABLE_VERSION_WEBHOOK =
  process.env.DISABLE_DISCORD_VERSION_WEBHOOK === 'true'
const WEBHOOK_SECRET = process.env.DISCORD_WEBHOOK_SECRET?.trim()

type VersionUpdatePayload = {
  previousVersion?: string
  commitMessage?: string
  commitHash?: string
  deploymentUrl?: string
  changes?: string[]
}

type WebhookConfigRow = {
  webhook_url: string | null
  enabled: boolean | null
}

const isVersionUpdatePayload = (
  value: unknown
): value is VersionUpdatePayload => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const payload = value as Record<string, unknown>
  if ('changes' in payload && !Array.isArray(payload.changes)) {
    return false
  }

  return true
}

export const GET = withErrorHandler(async () => {
  try {
    const supabase = serviceDb()
    const { data: webhookConfig } = await supabase
      .from('webhook_config')
      .select('webhook_url, enabled')
      .eq('webhook_type', 'version_update')
      .is('cluster_id', null)
      .is('guild_code', null)
      .maybeSingle()

    const configRow = webhookConfig as WebhookConfigRow | null
    const invalidUrl =
      configRow?.webhook_url && !configRow.webhook_url.startsWith('http')

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        disabled_by_flag: DISABLE_VERSION_WEBHOOK,
        configured: !!configRow?.webhook_url,
        enabled: !!configRow?.enabled,
        invalid_url: Boolean(invalidUrl)
      },
      message: 'Version update webhook health check'
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, '[Version Update] Health check failed')
    throw Errors.internal('Health check failed', {
      endpoint: '/api/discord-webhooks/version-update'
    })
  }
})

export const POST = withErrorHandler(async (req: NextRequest) => {
  try {
    if (DISABLE_VERSION_WEBHOOK) {
      return NextResponse.json({
        success: true,
        data: {
          message: 'Version update webhook disabled by configuration',
          webhook_sent: false
        },
        message: 'Version update webhook disabled'
      })
    }

    requireHeaderSecret(req, {
      secret: WEBHOOK_SECRET,
      headerName: 'x-webhook-secret',
      endpoint: '/api/discord-webhooks/version-update'
    })

    const supabase = serviceDb()

    const packagePath = path.join(process.cwd(), 'package.json')
    const packageData = await readFile(packagePath, 'utf-8')
    const packageJson = JSON.parse(packageData)
    const currentVersion = packageJson.version

    let payload: VersionUpdatePayload = {}
    try {
      const parsedBody = await req.json()
      if (isVersionUpdatePayload(parsedBody)) {
        payload = parsedBody
      } else {
        logger.warn(
          '[Version Update] Invalid payload provided, falling back to defaults'
        )
      }
    } catch {
      logger.info('[Version Update] No JSON body provided - using defaults')
    }
    const {
      previousVersion,
      commitMessage,
      commitHash,
      deploymentUrl,
      changes = []
    } = payload

    // The global row has NULL cluster_id and guild_code.
    const { data: webhookConfig } = await supabase
      .from('webhook_config')
      .select('webhook_url, enabled')
      .eq('webhook_type', 'version_update')
      .is('cluster_id', null)
      .is('guild_code', null)
      .single()

    const configRow = webhookConfig as WebhookConfigRow | null

    if (!configRow?.enabled || !configRow.webhook_url) {
      logger.warn('Version update webhook not configured or disabled')
      return NextResponse.json({
        success: true,
        data: {
          message:
            'Version update webhook not configured - no notification sent',
          version: currentVersion,
          webhook_configured: false
        },
        message: 'Version update processed but no webhook notification sent'
      })
    }

    if (!configRow.webhook_url.startsWith('http')) {
      logger.warn('Version update webhook URL invalid, skipping send')
      return NextResponse.json({
        success: true,
        data: {
          message: 'Invalid version update webhook URL - no notification sent',
          version: currentVersion,
          webhook_configured: false
        },
        message: 'Version update processed but webhook URL invalid'
      })
    }

    let versionType: 'major' | 'minor' | 'patch' = 'patch'
    if (previousVersion && currentVersion) {
      const [prevMajor = 0, prevMinor = 0] = previousVersion
        .split('.')
        .map(Number)
      const [currMajor = 0, currMinor = 0] = currentVersion
        .split('.')
        .map(Number)

      if (currMajor > prevMajor) {
        versionType = 'major'
      } else if (currMinor > prevMinor) {
        versionType = 'minor'
      }
    }

    const embedColor = getEmbedColor(versionType)

    const embedFields: Array<{ name: string; value: string; inline: boolean }> =
      [
        {
          name: '📦 Version',
          value: `${previousVersion || 'Unknown'} → ${currentVersion}`,
          inline: true
        },
        {
          name: '🔧 Update Type',
          value: versionType.charAt(0).toUpperCase() + versionType.slice(1),
          inline: true
        },
        {
          name: '🌐 Environment',
          value:
            process.env.NODE_ENV === 'production'
              ? 'Production'
              : 'Development',
          inline: true
        }
      ]

    const embed = {
      title: `🚀 Version ${currentVersion} Deployed!`,
      description:
        commitMessage ||
        `Tacticus Analytics has been updated to version ${currentVersion}`,
      color: embedColor,
      fields: embedFields,
      timestamp: new Date().toISOString(),
      footer: {
        text: 'Tacticus Analytics'
      }
    }

    if (commitHash) {
      embedFields.push({
        name: '🔗 Commit',
        value: `\`${commitHash.substring(0, 7)}\``,
        inline: true
      })
    }

    if (deploymentUrl) {
      embedFields.push({
        name: '🌍 Deployment',
        value: `[View Deployment](${deploymentUrl})`,
        inline: true
      })
    }

    if (Array.isArray(changes) && changes.length > 0) {
      const sanitizedChanges = changes
        .filter((change): change is string => typeof change === 'string')
        .slice(0, 5)
        .map((change) => `• ${change}`)
        .join('\n')

      if (sanitizedChanges) {
        embedFields.push({
          name: '📝 Changes',
          value: sanitizedChanges.substring(0, 1024), // Discord field limit
          inline: false
        })
      }
    }

    const webhookUrl = getWebhookUrlWithThread(
      configRow.webhook_url,
      versionType
    )

    if (versionType === 'major') {
      logger.info(
        `Posting major version update to thread ${DISCORD_WEBHOOK_CONFIG.threads.majorVersionUpdates}`
      )
    }

    const response = await postDiscordWebhookWithTimeout(webhookUrl, {
      embeds: [embed],
      username: DISCORD_WEBHOOK_CONFIG.bot.username,
      avatar_url: DISCORD_WEBHOOK_CONFIG.bot.avatarUrl
    })

    if (!response.ok) {
      await throwDiscordWebhookError(response, {
        endpoint: '/api/discord-webhooks/version-update',
        logger,
        logMessage: 'Discord API error for version update',
        logContext: { version: currentVersion }
      })
    }

    await supabase
      .from('webhook_config')
      .update({ last_tested: new Date().toISOString() })
      .eq('webhook_type', 'version_update')

    logger.info(
      {
        version: currentVersion,
        versionType,
        commitHash: commitHash?.substring(0, 7)
      },
      'Version update notification sent successfully'
    )

    return NextResponse.json({
      success: true,
      data: {
        success: true,
        version: currentVersion,
        previousVersion,
        versionType,
        webhook_configured: true
      },
      message: `Version update notification for ${currentVersion} sent successfully to Discord`
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: '/api/discord-webhooks/version-update'
      },
      'Error sending version update notification:'
    )

    throw Errors.notificationSendFailed(
      'Failed to send version update notification',
      {
        endpoint: '/api/discord-webhooks/version-update',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    )
  }
})
