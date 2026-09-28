import { NextResponse } from 'next/server'
import { requireAuthForApi } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.webhooks.post-assignments')
import { WEBHOOK_CONFIG } from '@tacticus/app-core/api-constants'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import { postDiscordWebhookWithTimeout } from '@/app/lib/discord/webhook-fetch'
import { loadWebhookUrlById } from '@/app/lib/webhooks/webhook-url-lookup'

interface WebhookConfig {
  id: string
  enabled: boolean | null
}

const DISCORD_POST_FAILURE_MESSAGE =
  'Failed to post to Discord. Please check your webhook configuration.'

const postDiscordAssignment = async (
  webhookUrl: string,
  content: string
): Promise<Response> => {
  try {
    return await postDiscordWebhookWithTimeout(webhookUrl, {
      content,
      username: 'Boss Assignment Manager',
      avatar_url: WEBHOOK_CONFIG.AVATAR_URLS.APP_LOGO
    })
  } catch (error) {
    logger.error({ err: error }, 'Discord webhook request failed:')
    throw Errors.fromResponse(500, {
      message: DISCORD_POST_FAILURE_MESSAGE
    })
  }
}

export const POST = withErrorHandler(async (request: Request) => {
  try {
    const { user } = await requireAuthForApi()

    if (!user) {
      throw Errors.fromResponse(401, { message: 'Unauthorized' })
    }

    const { guild_code, content } = await request.json()

    if (!guild_code || !content) {
      throw Errors.fromResponse(400, { message: 'Missing required fields' })
    }

    const supabase = await db()
    await requireGuildOfficerOrClusterLeader(
      supabase,
      user.id,
      guild_code,
      '/api/webhooks/post-assignments'
    )

    const { data: webhookData, error: webhookError } = await supabase
      .from('webhook_config')
      .select('id, enabled')
      .eq('guild_code', guild_code)
      .eq('webhook_type', 'boss_assignments')
      .single<WebhookConfig>()

    const webhookUrl =
      !webhookError && webhookData?.enabled
        ? await loadWebhookUrlById(webhookData.id)
        : null

    if (!webhookUrl) {
      throw Errors.fromResponse(404, {
        message:
          'No Discord webhook configured for boss assignments. Please configure it in Guild Settings > Integrations.'
      })
    }

    const discordResponse = await postDiscordAssignment(webhookUrl, content)

    if (!discordResponse.ok) {
      const errorText = await discordResponse.text()
      logger.error({ err: errorText }, 'Discord webhook error:')
      throw Errors.fromResponse(500, {
        message: DISCORD_POST_FAILURE_MESSAGE
      })
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ err: error }, 'Error posting assignments to Discord:')
    throw Errors.fromResponse(500, { message: 'Internal server error' })
  }
})
