import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.discord-webhooks.post-availability')
import { findWebhookForGuild } from '@/app/lib/webhooks/webhook-helper'
import { validateWebhookManagementAccess } from '@/app/lib/utils/cluster-validation'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { postDiscordWebhookWithTimeout } from '@/app/lib/discord/webhook-fetch'
import { throwDiscordWebhookError } from '@/app/lib/discord/webhook-error-mapping'
import type { PlayerMapping } from '@tacticus/app-core/types'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'
import { loadWebhookCallerProfile } from '@/app/api/discord-webhooks/_shared/caller-profile'

type PostAvailabilityPayload = {
  guild?: string
  content: string
}

const isPostAvailabilityPayload = (
  value: unknown
): value is PostAvailabilityPayload => {
  if (typeof value !== 'object' || value === null) {
    return false
  }

  const payload = value as Record<string, unknown>
  return typeof payload.content === 'string'
}

export const GET = withErrorHandler(async () => {
  return NextResponse.json({
    success: true,
    data: {
      status: 'Discord post-availability endpoint is active',
      method: 'POST',
      timestamp: new Date().toISOString(),
      version: '1.39.103'
    },
    message: 'Discord post-availability endpoint is operational'
  })
})

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    logger.info(
      {
        url: request.nextUrl.pathname,
        method: request.method
      },
      '[Discord Post] Request received'
    )

    const supabase = await db()
    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      logger.warn({ authError }, '[Discord Post] Unauthorized request')
      throw Errors.authenticationRequired(
        'Authentication required to post availability messages',
        { endpoint: '/api/discord-webhooks/post-availability' }
      )
    }
    await assertUnbannedAuthUser(user)

    const profile = await loadWebhookCallerProfile(
      supabase,
      user.id,
      '/api/discord-webhooks/post-availability'
    )

    if (!profile || !canManageHeraldRole(profile.role)) {
      logger.warn(
        {
          user_id: user.id,
          role: profile?.role,
          guild: profile?.guild_code
        },
        'Insufficient permissions for post-availability'
      )
      throw Errors.insufficientPermissions(
        'Only officers and leaders can post availability messages',
        {
          endpoint: '/api/discord-webhooks/post-availability',
          user_id: user.id,
          guild_code: profile?.guild_code || undefined
        }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch (error) {
      rethrowIfAppError(error)
      logger.error({ error }, '[Discord Post] Failed to parse request body')
      throw Errors.invalidRequest('Invalid request body - expected JSON', {
        endpoint: '/api/discord-webhooks/post-availability'
      })
    }

    if (!isPostAvailabilityPayload(body)) {
      throw Errors.invalidRequest('Invalid payload: content is required.', {
        endpoint: '/api/discord-webhooks/post-availability'
      })
    }

    const { guild, content: initialContent } = body
    let content = initialContent

    if (!content) {
      throw Errors.invalidRequest(
        'Missing required field: content is required',
        { endpoint: '/api/discord-webhooks/post-availability' }
      )
    }

    const targetGuild = guild || profile.guild_code

    if (targetGuild !== profile.guild_code) {
      const accessValidation = await validateWebhookManagementAccess(
        profile as PlayerMapping,
        targetGuild || ''
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
          'Access denied for webhook management'
        )
        throw Errors.insufficientPermissions(
          `Access denied: ${accessValidation.error}`,
          {
            endpoint: '/api/discord-webhooks/post-availability',
            user_id: user.id,
            guild_code: profile?.guild_code || undefined,
            target_guild: targetGuild || undefined,
            suggestion:
              'You can only manage webhooks for guilds in your cluster'
          }
        )
      }
    }

    const webhookUrl = await findWebhookForGuild(
      targetGuild || '',
      'gr_availability'
    )

    if (!webhookUrl) {
      logger.info({ guildCode: targetGuild }, '[Discord Post] No webhook found')
      throw Errors.webhookNotConfigured(targetGuild || '', 'gr_availability')
    }

    if (content.length > 2000) {
      logger.warn(
        { guild },
        `Message too long for Discord: ${content.length} characters`
      )
      const truncated = content.substring(0, 1950) + '\n... [Message truncated]'
      content = truncated
    }

    logger.info(
      {
        guild,
        messageLength: content.length,
        webhookUrl: webhookUrl.substring(0, 50) + '...',
        user: user.id
      },
      '[Discord Post] Attempting to post to Discord'
    )

    const discordResponse = await postDiscordWebhookWithTimeout(webhookUrl, {
      content: content,
      username: 'Tacticus Analytics Bot',
      avatar_url: 'https://www.tacticusanalytics.com/images/logo-no-words.png'
    })

    if (!discordResponse.ok) {
      await throwDiscordWebhookError(discordResponse, {
        endpoint: '/api/discord-webhooks/post-availability',
        logger,
        logMessage: 'Discord webhook error:',
        logContext: {
          webhookUrl: webhookUrl.substring(0, 50) + '...',
          guild,
          messageLength: content.length,
          messageSample: content.substring(0, 200)
        },
        notFoundMessage:
          'Discord webhook not found. Please check the webhook URL is correct in Guild Settings.',
        extraMeta: { guild_code: guild }
      })
    }

    logger.info(
      {
        guild,
        messageLength: content.length,
        user: user.id
      },
      '[Discord Post] Successfully posted to Discord'
    )

    return NextResponse.json({
      success: true,
      data: { success: true },
      message: 'Availability message posted successfully to Discord'
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
        url: request.nextUrl.pathname
      },
      '[Discord Post] Unexpected error:'
    )

    // An HTML body means an auth redirect.
    if (
      error instanceof Error &&
      (error.message.includes('<!DOCTYPE') || error.message.includes('<html'))
    ) {
      throw Errors.authenticationRequired(
        'Authentication required. Please refresh the page and try again.',
        {
          endpoint: '/api/discord-webhooks/post-availability',
          suggestion: 'Please refresh the page and try again'
        }
      )
    }

    throw Errors.internal(
      'Internal server error. Please try again or contact support if the issue persists.',
      {
        endpoint: '/api/discord-webhooks/post-availability',
        details: error instanceof Error ? error.message : 'Unknown error'
      }
    )
  }
})
