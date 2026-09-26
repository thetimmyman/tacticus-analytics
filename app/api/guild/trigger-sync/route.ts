import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { requireRoleForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild.trigger-sync')
import { appCache } from '@tacticus/app-core/app-cache'
import {
  expectedErrorResponse,
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { RetryTimeoutError, withRetry } from '@/app/lib/resilience/with-retry'
import { RetryConditions } from '@/app/lib/resilience/retry-policy'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { SERVICE_TIMEOUTS } from '@/app/lib/utils/async-timeout'

const RATE_LIMIT_WINDOW_SECONDS = 30
const RATE_LIMIT_KEY_PREFIX = 'guild-sync:rate:'
const shouldRetryInvokeError = RetryConditions.any(
  RetryConditions.networkErrors,
  RetryConditions.serverErrors,
  RetryConditions.timeoutErrors
)

async function checkRateLimit(
  guildCode: string
): Promise<{ allowed: boolean; remainingTime?: number }> {
  const windowSeconds = RATE_LIMIT_WINDOW_SECONDS
  const windowMs = windowSeconds * 1000
  const key = `${RATE_LIMIT_KEY_PREFIX}${guildCode}`
  const now = Date.now()
  const lastInvocation = await appCache.get<number>(key)

  if (typeof lastInvocation === 'number') {
    const elapsed = now - lastInvocation
    if (elapsed < windowMs) {
      const remainingTime = Math.ceil((windowMs - elapsed) / 1000)
      return { allowed: false, remainingTime }
    }
  }

  await appCache.set(key, now, windowSeconds)
  return { allowed: true }
}

// Server-side proxy to avoid CORS.
export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const { profile } = await requireRoleForApi('member')
    const { guild_code } = await request.json()

    if (typeof guild_code !== 'string' || !guild_code.trim()) {
      throw Errors.fromResponse(400, { error: 'Missing guild_code' })
    }

    const supabase = serviceDb()
    const resolvedGuild = await GuildConfigService.findByCodeOrTag(
      supabase,
      guild_code
    )
    const normalizedGuildCode =
      resolvedGuild?.guild_code ?? GuildConfigService.normalizeCode(guild_code)

    if (
      !profile.guild_code ||
      GuildConfigService.normalizeCode(profile.guild_code) !==
        normalizedGuildCode
    ) {
      throw Errors.fromResponse(403, { error: 'Access denied for this guild' })
    }

    const rateLimit = await checkRateLimit(normalizedGuildCode)
    if (!rateLimit.allowed) {
      const retryAfter = rateLimit.remainingTime ?? RATE_LIMIT_WINDOW_SECONDS
      throw Errors.fromResponse(429, {
        error: `Please wait ${retryAfter} seconds before syncing again`,
        rateLimited: true,
        retryAfter
      })
    }

    // Do not stamp `last_sync`: freshness, the 5-minute skip and the incremental watermark read it,
    // so a premature stamp fakes health and can skip unimported battles.
    const { error: statusError } = await supabase
      .from('guild_sync_status')
      .upsert(
        {
          guild_code: normalizedGuildCode,
          status: 'pending',
          records_synced: 0
        },
        {
          onConflict: 'guild_code',
          ignoreDuplicates: true
        }
      )

    if (statusError) {
      logger.error({ err: statusError }, 'Error creating sync status:')
    }

    try {
      const { data, error: _error } = await withRetry(
        async () => {
          const result = await supabase.functions.invoke(
            'sync-modular-workflow',
            {
              body: {
                guild_code: normalizedGuildCode
              }
            }
          )
          if (result.error) {
            // FunctionsHttpError.message is generic; details are in the context body.
            let detailedMessage = result.error.message || 'Edge function error'
            try {
              if (
                result.error.context &&
                typeof result.error.context.json === 'function'
              ) {
                const body = await result.error.context.json()
                detailedMessage =
                  body?.error || body?.message || detailedMessage
              } else if (
                typeof result.error.context === 'object' &&
                result.error.context !== null
              ) {
                const ctx = result.error.context as Record<string, unknown>
                detailedMessage =
                  (ctx.error as string) ||
                  (ctx.message as string) ||
                  detailedMessage
              }
            } catch {
              // Unparseable context: keep the generic message.
            }
            const err = new Error(detailedMessage)
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
          context: { operationName: 'sync-modular-workflow' }
        }
      )

      // A 2xx can still report partial ingestion or upstream failure.
      if (data?.success !== true || data?.partial === true) {
        return expectedErrorResponse(
          Errors.fromResponse(502, {
            error: 'Guild sync did not complete; please retry',
            partial: data?.partial === true,
            guild_code: normalizedGuildCode,
            stats: data?.stats
          }),
          request
        )
      }
      if (data.skipped === 'sync_in_progress') {
        return NextResponse.json(
          {
            success: true,
            skipped: 'sync_in_progress',
            message: 'A guild sync is already running. Check again shortly.',
            guild_code: normalizedGuildCode
          },
          { status: 202 }
        )
      }

      logger.info({ data: data }, 'Guild sync successful:')

      const finalEntries = data?.stats?.finalValidEntries || 0
      return NextResponse.json({
        success: true,
        message:
          finalEntries > 0
            ? `Successfully synced ${finalEntries} battle entries`
            : data?.message || 'Guild sync completed - no new battles found',
        battles_synced: finalEntries,
        battlesSynced: finalEntries, // Legacy compatibility for UI
        battles_inserted: data?.battles_inserted || 0,
        battles_updated: data?.battles_updated || 0,
        battles_failed: data?.battles_failed || 0,
        season: data?.season,
        unmapped_players: data?.unmapped_players || 0,
        processing_time_ms: data?.processing_time_ms,
        timestamp: data?.timestamp || new Date().toISOString(),
        guild_code: normalizedGuildCode,
        stats: data?.stats
      })
    } catch (err: unknown) {
      rethrowIfAppError(err)
      const errorMessage =
        err instanceof Error ? err.message : 'Unknown error occurred'
      // Expected upstream conditions: warn rather than report to Sentry.
      logger.warn(
        {
          guild_code: normalizedGuildCode,
          error: errorMessage
        },
        'Failed to invoke sync edge function:'
      )

      if (errorMessage.includes('decrypt')) {
        return expectedErrorResponse(
          Errors.fromResponse(500, {
            error: 'Failed to sync guild data',
            details:
              'Unable to decrypt the stored API key. Please re-enter your API key in settings.',
            requiresNewKey: true
          }),
          request
        )
      }

      if (errorMessage.includes('not found')) {
        return expectedErrorResponse(
          Errors.fromResponse(500, {
            error: 'Failed to sync guild data',
            details:
              'Guild configuration not found. Please complete the onboarding process.',
            requiresOnboarding: true
          }),
          request
        )
      }

      return expectedErrorResponse(
        Errors.fromResponse(500, {
          error: 'Failed to sync guild data',
          details: errorMessage,
          guild_code: normalizedGuildCode
        }),
        request
      )
    }
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    logger.error({ error, message: errorMessage }, 'Trigger sync error:')
    throw Errors.fromResponse(500, {
      error: `Failed to trigger sync: ${errorMessage}`
    })
  }
})
