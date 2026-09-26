import { NextRequest, NextResponse } from 'next/server'
import { requireRoleForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.discord.leaderboard-refresh')
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { RetryTimeoutError, withRetry } from '@/app/lib/resilience/with-retry'
import { RetryConditions } from '@/app/lib/resilience/retry-policy'
import { SERVICE_TIMEOUTS } from '@/app/lib/utils/async-timeout'

interface RefreshRequestBody {
  guild_code?: string
}

const shouldRetryInvokeError = RetryConditions.any(
  RetryConditions.networkErrors,
  RetryConditions.serverErrors,
  RetryConditions.timeoutErrors
)

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const { profile } = await requireRoleForApi('leader')

    let body: RefreshRequestBody = {}
    try {
      body = (await request.json()) as RefreshRequestBody
    } catch (error) {
      rethrowIfAppError(error)
      throw Errors.validation('Invalid request body', {
        endpoint: '/api/discord/leaderboard-refresh'
      })
    }
    const guildCode = GuildConfigService.normalizeCode(
      body.guild_code || profile.guild_code || ''
    )

    if (!guildCode) {
      throw Errors.fromResponse(400, { error: 'Missing guild_code' })
    }

    // No cross-tenant access.
    if (
      body.guild_code &&
      profile.guild_code &&
      GuildConfigService.normalizeCode(body.guild_code) !==
        GuildConfigService.normalizeCode(profile.guild_code)
    ) {
      logger.warn(
        {
          callerGuild: profile.guild_code,
          requestedGuild: body.guild_code
        },
        'Leaderboard refresh attempted for non-owned guild'
      )
      throw Errors.fromResponse(403, {
        error: 'You can only refresh leaderboards for your own guild'
      })
    }

    const supabase = serviceDb()

    const guildConfig = await GuildConfigService.getBasic(supabase, guildCode)

    if (!guildConfig) {
      logger.warn(
        {
          guildCode
        },
        'Leaderboard refresh attempted for missing guild'
      )

      throw Errors.fromResponse(404, { error: `Guild ${guildCode} not found.` })
    }

    if (!guildConfig.enabled) {
      throw Errors.fromResponse(409, {
        error:
          'Guild is disabled. Enable it before pushing leaderboard updates.'
      })
    }

    const functionName = `update-discord-leaderboards?guild=${encodeURIComponent(guildCode)}`
    const requestBody =
      guildConfig.cluster_code && guildConfig.cluster_code.trim().length > 0
        ? { cluster_code: guildConfig.cluster_code.trim() }
        : { process_all: true }

    logger.info(
      {
        guildCode,
        clusterCode: guildConfig.cluster_code || null
      },
      'Manual leaderboard refresh requested'
    )

    const { data, error: invokeError } = await withRetry(
      async () => {
        const result = await supabase.functions.invoke(functionName, {
          body: requestBody
        })
        if (result.error) {
          const err = new Error(result.error.message || 'Edge function error')
          ;(err as Error & { edgeFunctionError: unknown }).edgeFunctionError =
            result.error
          throw err
        }
        return result
      },
      {
        maxAttempts: 3,
        strategy: 'exponential',
        baseDelayMs: 1000,
        maxDelayMs: 5000,
        attemptTimeout: SERVICE_TIMEOUTS.EXTERNAL_API,
        retryOn: (error, attempt) =>
          error instanceof RetryTimeoutError
            ? false
            : shouldRetryInvokeError(error, attempt),
        context: { operationName: 'update-discord-leaderboards' }
      }
    )

    if (invokeError) {
      logger.error(
        {
          guildCode,
          error: invokeError.message,
          details: invokeError
        },
        'Leaderboard refresh failed'
      )

      throw Errors.fromResponse(502, {
        error: 'Failed to trigger leaderboard refresh',
        details: invokeError.message || 'Edge function returned an error'
      })
    }

    logger.info(
      {
        guildCode,
        response: data
      },
      'Leaderboard refresh completed'
    )

    return NextResponse.json({
      success: true,
      guild_code: guildCode,
      cluster_code: guildConfig.cluster_code,
      triggered_at: new Date().toISOString(),
      response: data
    })
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    logger.error(
      { error, message: errorMessage },
      'Unhandled error in leaderboard-refresh route'
    )

    throw Errors.fromResponse(500, {
      error: `Unexpected error triggering leaderboard refresh: ${errorMessage}`
    })
  }
})
