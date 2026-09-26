import { NextRequest, NextResponse } from 'next/server'
import { validateApiKeyWithTacticus } from '@tacticus/app-core/api-key-validation'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.player.test-api-key')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

interface ValidationRequestBody {
  api_key?: string
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: false,
    skipSecurityChecks: true
  })
  if (securityResult) return securityResult

  const start = Date.now()

  try {
    const body = (await request.json()) as ValidationRequestBody
    const apiKeyInput = body.api_key ?? ''
    const apiKey = typeof apiKeyInput === 'string' ? apiKeyInput.trim() : ''

    if (!apiKey) {
      throw Errors.fromResponse(400, {
        success: false,
        error: 'API key is required for validation',
        summary: {
          apiKeyValid: false,
          recommendation:
            'Please paste your Tacticus API key before running validation.',
          processingTimeMs: Date.now() - start
        }
      })
    }

    const validation = await validateApiKeyWithTacticus(apiKey, true)
    const processingTimeMs = Date.now() - start

    if (!validation.isValid) {
      throw Errors.fromResponse(validation.statusCode ?? 400, {
        success: false,
        error: validation.error ?? 'Player API key validation failed',
        metrics: {
          apiKeyValid: false,
          canAccessGuildData: validation.canAccessGuild,
          canAccessRaidData: false,
          timeElapsed: processingTimeMs
        },
        autoDiscovered: validation.guildInfo ?? {},
        summary: {
          apiKeyValid: false,
          recommendation:
            validation.error ??
            '❌ Validation failed for player API key. Please confirm the key is active and try again.',
          processingTimeMs
        }
      })
    }

    return NextResponse.json({
      success: true,
      metrics: {
        apiKeyValid: true,
        canAccessGuildData: validation.canAccessGuild,
        canAccessRaidData: false,
        timeElapsed: processingTimeMs
      },
      autoDiscovered: validation.guildInfo ?? {},
      summary: {
        apiKeyValid: true,
        recommendation: '✅ Player API key validated successfully!',
        processingTimeMs
      }
    })
  } catch (error) {
    rethrowIfAppError(error)
    const processingTimeMs = Date.now() - start
    const message =
      error instanceof Error ? error.message : 'Unknown validation error'

    logger.error(
      {
        error: message
      },
      '[PLAYER-TEST-API-KEY] Validation failed'
    )

    throw Errors.fromResponse(500, {
      success: false,
      error: 'Failed to validate API key. Please try again later.',
      summary: {
        apiKeyValid: false,
        recommendation:
          'Validation failed due to an unexpected error. Please try again or contact support.',
        processingTimeMs
      }
    })
  }
})
