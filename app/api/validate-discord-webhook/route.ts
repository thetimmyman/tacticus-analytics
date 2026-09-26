import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { validateDiscordWebhookUrl } from '@/app/lib/webhooks/validate-url'

const logger = createComponentLogger('api.validate-discord-webhook')

interface DiscordWebhookInfo {
  channel_id?: string
  guild_id?: string
  name?: string
}

const DISCORD_API_TIMEOUT_MS = 10000

export const POST = withErrorHandler(async (request: NextRequest) => {
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: true,
    requiredRole: ['officer', 'Officer', 'leader', 'Leader', 'admin'],
    skipRateLimit: false
  })

  if (securityResult) return securityResult

  try {
    const { webhookUrl } = await request.json()

    const urlValidation = validateDiscordWebhookUrl(webhookUrl)
    if (!urlValidation.ok) {
      return NextResponse.json({
        valid: false,
        error: urlValidation.message,
        ...('hint' in urlValidation ? { hint: urlValidation.hint } : {})
      })
    }

    try {
      const response = await fetch(urlValidation.url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(DISCORD_API_TIMEOUT_MS)
      })

      if (response.ok) {
        const webhookInfo = (await response.json()) as DiscordWebhookInfo
        return NextResponse.json({
          valid: true,
          channel_id: webhookInfo.channel_id,
          guild_id: webhookInfo.guild_id,
          name: webhookInfo.name
        })
      } else if (response.status === 401 || response.status === 404) {
        return NextResponse.json({
          valid: false,
          error: 'Invalid or deleted webhook'
        })
      } else {
        return NextResponse.json({
          valid: false,
          error: 'Failed to validate webhook'
        })
      }
    } catch (fetchError) {
      if (fetchError instanceof Error && fetchError.name === 'TimeoutError') {
        logger.warn(
          { webhookHost: new URL(urlValidation.url).hostname },
          'Discord webhook validation timed out'
        )
        return NextResponse.json({
          valid: false,
          error: 'Discord API timed out. Please try again.'
        })
      }
      const errorMessage =
        fetchError instanceof Error ? fetchError.message : 'Unknown error'
      logger.error({ err: errorMessage }, 'Error fetching webhook:')
      return NextResponse.json({
        valid: false,
        error: 'Failed to connect to Discord'
      })
    }
  } catch (error: unknown) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    logger.error({ err: errorMessage }, 'Error validating webhook:')
    throw Errors.internal('Internal server error')
  }
})
