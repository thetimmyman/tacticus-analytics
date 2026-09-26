import { NextRequest, NextResponse } from 'next/server'
import { requireRoleForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
import { serviceDb } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { getApiKey } from '@tacticus/app-core/api-key-helper'
import {
  validateApiKeyWithTacticus,
  type ApiKeyValidationResult
} from '@tacticus/app-core/api-key-validation'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { sanitizeErrorForLog } from '@tacticus/app-core/logging-sanitizer'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

const logger = createComponentLogger('api.guild.validate-api-key')

function safeError(error: unknown) {
  return sanitizeErrorForLog(error)
}

function isResolvedValidationTimeout(
  validationResult: ApiKeyValidationResult
): boolean {
  const errorMessage = validationResult.error?.toLowerCase() ?? ''
  return (
    validationResult.statusCode === 408 ||
    errorMessage.includes('timed out') ||
    errorMessage.includes('timeout')
  )
}

export const dynamic = 'force-dynamic'

export const POST = withErrorHandler(async (request: NextRequest) => {
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: true,
    requiredRole: ['officer', 'Officer', 'leader', 'Leader', 'admin'],
    skipRateLimit: false
  })

  if (securityResult) return securityResult

  try {
    const { profile } = await requireRoleForApi('officer')
    const { guild_code } = await request.json()

    if (typeof guild_code !== 'string' || !guild_code.trim()) {
      throw Errors.validation('Missing guild_code')
    }

    const normalizedGuildCode = GuildConfigService.normalizeCode(guild_code)

    if (
      !profile.guild_code ||
      GuildConfigService.normalizeCode(profile.guild_code) !==
        normalizedGuildCode
    ) {
      throw Errors.fromResponse(403, { error: 'Access denied for this guild' })
    }

    const supabase = serviceDb()

    const guildConfig = await GuildConfigService.getFullWithSecrets(
      supabase,
      normalizedGuildCode
    )

    if (!guildConfig) {
      throw Errors.fromResponse(404, { error: 'Guild not found' })
    }

    logger.info(
      {
        guild_code: normalizedGuildCode,
        has_encrypted_key: !!guildConfig.api_key_encrypted,
        current_status: guildConfig.api_key_is_valid ?? null,
        consecutive_failures: guildConfig.consecutive_sync_failures ?? 0
      },
      'Starting guild API key validation'
    )

    let apiKey: string | null
    try {
      apiKey = await getApiKey(guildConfig)
    } catch (validationError) {
      logger.error(
        {
          guild_code: normalizedGuildCode,
          error: safeError(validationError)
        },
        'API key decryption failed'
      )

      return NextResponse.json({
        valid: false,
        message: 'Failed to decrypt API key - please re-enter your API key'
      })
    }

    if (!apiKey) {
      logger.warn(
        {
          guild_code: normalizedGuildCode,
          has_encrypted_field: !!guildConfig.api_key_encrypted
        },
        'No API key found after decryption'
      )

      return NextResponse.json({
        valid: false,
        message: 'No API key configured for this guild'
      })
    }

    logger.info(
      {
        guild_code: normalizedGuildCode
      },
      'API key decrypted successfully, testing with shared Tacticus validator'
    )

    const recordValidationFailure = async (
      message: string,
      context: Record<string, unknown> = {}
    ) => {
      const newFailures = (guildConfig.consecutive_sync_failures || 0) + 1
      const { error: updateError } = await supabase
        .from('guild_config')
        .update({
          api_key_is_valid: false,
          api_key_last_validated: new Date().toISOString(),
          consecutive_sync_failures: newFailures,
          auto_sync_enabled: newFailures < 3
        })
        .eq('guild_code', normalizedGuildCode)

      if (updateError) {
        logger.error(
          {
            guild_code: normalizedGuildCode,
            error: safeError(updateError)
          },
          'Failed to update database after failed validation'
        )
      }

      logger.warn(
        {
          guild_code: normalizedGuildCode,
          failures: newFailures,
          ...context
        },
        'API key validation failed'
      )

      return NextResponse.json({
        valid: false,
        message
      })
    }

    let validationResult: ApiKeyValidationResult
    try {
      validationResult = await validateApiKeyWithTacticus(apiKey, false)
    } catch (validationError) {
      const errorName =
        validationError instanceof Error ? validationError.name : ''

      if (errorName === 'AbortError' || errorName === 'TimeoutError') {
        logger.warn(
          { guild_code: normalizedGuildCode },
          'API key validation timed out'
        )

        return NextResponse.json({
          valid: false,
          message: 'API key validation timed out - please try again'
        })
      }

      logger.error(
        {
          guild_code: normalizedGuildCode,
          error: safeError(validationError)
        },
        'Shared API key validation failed unexpectedly'
      )

      return NextResponse.json({
        valid: false,
        message: 'API key validation failed - please try again'
      })
    }

    if (isResolvedValidationTimeout(validationResult)) {
      logger.warn(
        {
          guild_code: normalizedGuildCode,
          status: validationResult.statusCode ?? null
        },
        'API key validation timed out'
      )

      return NextResponse.json({
        valid: false,
        message: 'API key validation timed out - please try again'
      })
    }

    if (
      !validationResult.isValid ||
      !validationResult.canAccessGuild ||
      !validationResult.canAccessRaidData
    ) {
      return recordValidationFailure(
        validationResult.error || 'API key validation failed',
        {
          status: validationResult.statusCode ?? null,
          canAccessGuild: validationResult.canAccessGuild,
          canAccessRaidData: validationResult.canAccessRaidData
        }
      )
    }

    if (!validationResult.guildInfo?.guildId) {
      return recordValidationFailure('Could not determine guild from API key', {
        guildInfo: validationResult.guildInfo ?? null
      })
    }

    const storedGuildId =
      typeof guildConfig.guild_id === 'string' ? guildConfig.guild_id : null

    if (!storedGuildId) {
      return recordValidationFailure(
        'Could not verify stored guild identity before enabling sync',
        {
          apiKeyGuildId: validationResult.guildInfo.guildId,
          apiKeyGuildName: validationResult.guildInfo.guildName ?? null
        }
      )
    }

    if (validationResult.guildInfo.guildId !== storedGuildId) {
      return recordValidationFailure('API key belongs to a different guild', {
        storedGuildId,
        apiKeyGuildId: validationResult.guildInfo.guildId,
        apiKeyGuildName: validationResult.guildInfo.guildName ?? null
      })
    }

    const { error: updateError } = await supabase
      .from('guild_config')
      .update({
        api_key_is_valid: true,
        api_key_last_validated: new Date().toISOString(),
        consecutive_sync_failures: 0,
        auto_sync_enabled: true
      })
      .eq('guild_code', normalizedGuildCode)

    if (updateError) {
      logger.error(
        {
          guild_code: normalizedGuildCode,
          error: safeError(updateError)
        },
        'Failed to update database after successful validation'
      )
    }

    logger.info(
      { guild_code: normalizedGuildCode },
      'API key validation successful'
    )

    return NextResponse.json({
      valid: true,
      message: 'API key is valid and working'
    })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ err: safeError(error) }, 'API key validation error:')
    throw Errors.internal('Failed to validate API key')
  }
})
