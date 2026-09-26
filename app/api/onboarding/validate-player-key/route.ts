import { NextRequest, NextResponse } from 'next/server'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.onboarding.validate-player-key')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

interface ValidationRequestBody {
  apiKey?: string
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: false,
    skipSecurityChecks: true
  })
  if (securityResult) return securityResult

  try {
    // Deliberately unauthenticated: onboarding validates a key before a session exists. No DB writes.
    const body = (await request.json()) as ValidationRequestBody
    const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''

    if (!apiKey) {
      throw Errors.fromResponse(400, {
        success: false,
        error: 'Player API key is required'
      })
    }

    const player = await tacticusAPI.getPlayer(apiKey)

    if (!player) {
      throw Errors.fromResponse(400, {
        success: false,
        error:
          'Invalid API key or unable to fetch player data. Please check your key and try again.'
      })
    }

    return NextResponse.json({
      success: true,
      playerName: player.details?.name || 'Unknown',
      powerLevel: player.details?.powerLevel || 0
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, '[ONBOARDING] Player API key validation failed')
    throw Errors.fromResponse(500, {
      success: false,
      error: 'Failed to validate API key. Please try again.'
    })
  }
})
