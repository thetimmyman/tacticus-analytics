import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import {
  requireGuildCredentialAuthority,
  requireGuildCredentialMember
} from '@/app/lib/auth/guild-permissions'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild.update-api-key')
import { encryptApiKey } from '@tacticus/app-core/encryption'
import {
  createError,
  formatErrorForUser,
  getVersionInfo
} from '@tacticus/app-core/error-handler'
import { throwUserFacingError } from '@/app/lib/errors/user-facing'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  validateApiKeyWithTacticus,
  generateApiKeyUpdatePayload,
  logApiKeyOperation
} from '@tacticus/app-core/api-key-validation'
import {
  maskSensitive,
  sanitizeErrorForLog
} from '@tacticus/app-core/logging-sanitizer'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { SERVICE_TIMEOUTS } from '@/app/lib/utils/async-timeout'
import { assertUnbannedAuthUser } from '@/app/lib/api/session-user'
import { serverEnv } from '@tacticus/app-core/server-env'

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()

    const {
      data: { user },
      error: authError
    } = await supabase.auth.getUser()

    if (authError || !user) {
      throwUserFacingError(
        'AUTH_REQUIRED',
        'Authentication required to update API key',
        401,
        { component: 'update-api-key', action: 'verify_auth' },
        { cause: authError }
      )
    }
    await assertUnbannedAuthUser(user)

    const body = await request.json()
    // `api_owner` comes from the caller's profile, never the body (members could forge it).
    const { guild_code, api_key, remove } = body

    // A merely-missing api_key still 400s.
    if (remove === true) {
      if (!guild_code) {
        throwUserFacingError(
          'VALIDATION_ERROR',
          'Guild code is required',
          400,
          {
            component: 'update-api-key',
            action: 'validate_input'
          }
        )
      }

      const { data: removeTarget, error: removeCheckError } = await supabase
        .from('guild_config')
        .select('guild_code')
        .eq('guild_code', guild_code)
        .single()

      if (removeCheckError || !removeTarget) {
        throw Errors.fromResponse(404, {
          error: 'Guild not found',
          details: `Guild ${guild_code} does not exist in the database`
        })
      }

      // Removal is officer+ (it disables auto_sync); updates are member-level, validated against this guild.
      await requireGuildCredentialAuthority(
        supabase,
        user.id,
        removeTarget.guild_code,
        'guild/update-api-key:remove'
      )

      // Service role: prevent_guild_config_authority_rewrite blocks other writers.
      const { data: removedRows, error: removeError } = await serviceDb()
        .from('guild_config')
        .update({
          api_key_encrypted: null,
          api_key_is_valid: null,
          api_key_last_validated: null,
          auto_sync_enabled: false
        })
        .eq('guild_code', removeTarget.guild_code)
        .select('guild_code')

      if (removeError) {
        logger.error(
          { error: sanitizeErrorForLog(removeError), guild_code },
          'API key removal failed:'
        )
        throw Errors.fromResponse(500, {
          error: 'Failed to remove API key'
        })
      }

      if (!removedRows || removedRows.length === 0) {
        logger.error(
          { guild_code, userId: user.id },
          'API key removal updated no rows:'
        )
        throw Errors.fromResponse(404, {
          error:
            'No rows updated - guild may not exist or you lack permissions',
          details: 'The removal operation completed but no guild was modified'
        })
      }

      logger.info({ guild_code, userId: user.id }, 'API key removed')
      return NextResponse.json({ success: true, removed: true })
    }

    logger.info(
      {
        guild_code,
        api_key_length: api_key?.length,
        has_encryption_key: !!process.env.ENCRYPTION_KEY
      },
      'API key update request:'
    )

    if (!guild_code || !api_key) {
      throwUserFacingError(
        'VALIDATION_ERROR',
        'Guild code and API key are required',
        400,
        { component: 'update-api-key', action: 'validate_input' }
      )
    }

    logger.info(
      {
        userId: user.id,
        guild_code,
        api_key_length: api_key?.length
      },
      'API key update request'
    )

    // API_Owner is not readable by `authenticated`.
    const { data: guildExists, error: checkError } = await supabase
      .from('guild_config')
      .select('guild_code')
      .eq('guild_code', guild_code)
      .single()

    if (checkError || !guildExists) {
      logger.error(
        { guild_code, error: sanitizeErrorForLog(checkError) },
        'Guild not found:'
      )
      throw Errors.fromResponse(404, {
        error: 'Guild not found',
        details: `Guild ${guild_code} does not exist in the database`
      })
    }

    // The only authorization: the write below is service role. Any attested current member may update.
    // Runs before the Tacticus call so the endpoint is not a key-probing oracle.
    const memberProfile = await requireGuildCredentialMember(
      supabase,
      user.id,
      guildExists.guild_code,
      'guild/update-api-key'
    )

    logger.info('Validating API key with Tacticus API before saving...')
    const validationResult = await validateApiKeyWithTacticus(api_key.trim())

    logApiKeyOperation('update', guild_code, validationResult, user.id)

    if (!validationResult.isValid) {
      throwUserFacingError(
        'API_VALIDATION_FAILED',
        'API key validation failed',
        400,
        {
          component: 'update-api-key',
          action: 'validate_key',
          guildCode: guild_code
        },
        {
          extraBody: {
            details: validationResult.error,
            recommendation: validationResult.error?.includes('Guild Raid')
              ? 'Please generate a new API key with both "Guild" and "Guild Raid" permissions selected'
              : 'Please check your API key and try again'
          }
        }
      )
    }

    // Fail closed unless the key belongs to this guild; compare by guildId (Tacticus returns its guildTag).
    if (!validationResult.guildInfo?.guildId) {
      logger.warn(
        {
          targetGuild: guild_code,
          guildInfo: validationResult.guildInfo
        },
        'API key validated but guild identity could not be determined'
      )
      throw Errors.fromResponse(400, {
        error: 'Could not determine guild from API key',
        details:
          'The API key is valid but did not return guild information. Please try a different key.',
        recommendation:
          'Generate a new API key from Tacticus with Guild permissions enabled'
      })
    }

    const { data: targetGuild } = await supabase
      .from('guild_config')
      .select('guild_id')
      .eq('guild_code', guild_code)
      .single()

    // Without a stored guild_id, a valid key for ANY guild would be accepted.
    if (!targetGuild?.guild_id) {
      logger.error(
        { targetGuild: guild_code },
        'guild_config.guild_id missing — cannot verify key ownership'
      )
      throw Errors.fromResponse(400, {
        error: 'Guild identity not linked',
        details: `Guild ${guild_code} has no Tacticus guild id on record, so key ownership cannot be verified. The key has not been changed.`,
        code: 'GUILD_IDENTITY_UNLINKED',
        recommendation:
          'Contact support to link this guild before updating its API key'
      })
    }

    if (validationResult.guildInfo.guildId !== targetGuild.guild_id) {
      logger.warn(
        {
          targetGuild: guild_code,
          targetGuildId: targetGuild.guild_id,
          apiKeyGuildId: validationResult.guildInfo.guildId,
          apiKeyGuildName: validationResult.guildInfo.guildName
        },
        'API key guild mismatch'
      )
      throw Errors.fromResponse(400, {
        error: 'API key belongs to a different guild',
        details: `This API key is for guild "${validationResult.guildInfo.guildName}", not ${guild_code}`,
        recommendation:
          'Please use an API key from a player in the target guild'
      })
    }

    let encryptedApiKey: string
    try {
      encryptedApiKey = await encryptApiKey(api_key.trim())
    } catch (encryptError: unknown) {
      logger.error(
        { err: sanitizeErrorForLog(encryptError) },
        'Failed to encrypt API key:'
      )
      throw Errors.fromResponse(500, {
        error:
          'Failed to encrypt API key - please check ENCRYPTION_KEY is configured',
        details:
          encryptError instanceof Error
            ? encryptError.message
            : 'Encryption failed'
      })
    }

    logger.info(
      {
        guild_code,
        validationPassed: true,
        canAccessGuild: validationResult.canAccessGuild,
        canAccessRaidData: validationResult.canAccessRaidData
      },
      'Attempting database update for guild:'
    )

    // Undefined leaves the stored API_Owner untouched.
    const ownerLabel = memberProfile.display_name ?? undefined
    const updatePayload = generateApiKeyUpdatePayload(
      encryptedApiKey,
      validationResult,
      ownerLabel
    )
    if (!ownerLabel) {
      delete (updatePayload as Partial<typeof updatePayload>).API_Owner
    }

    // Never log updatePayload: api_key_encrypted is a credential artifact.
    logger.info(
      {
        fields_updated: Object.keys(updatePayload),
        guild_code
      },
      'Update payload prepared'
    )

    // Service role is required (42501 otherwise); the filter is pinned to the checked guild_code.
    const { data: updateData, error: updateError } = await serviceDb()
      .from('guild_config')
      .update(updatePayload)
      .eq('guild_code', guildExists.guild_code)
      .select('guild_code, api_key_is_valid, updated_at')

    const firstUpdateRow = updateData?.[0]
    if (firstUpdateRow) {
      logger.info(
        {
          guild_code: firstUpdateRow.guild_code,
          api_key_is_valid: firstUpdateRow.api_key_is_valid,
          updated_at: firstUpdateRow.updated_at
        },
        'Update successful - returned data:'
      )
    }

    if (updateError) {
      logger.error(
        {
          error: sanitizeErrorForLog(updateError),
          errorCode: updateError.code,
          errorDetails: maskSensitive(updateError.details || ''),
          errorHint: updateError.hint,
          errorMessage: maskSensitive(updateError.message || ''),
          guild_code,
          user_id: user.id,
          encrypted_key_length: encryptedApiKey?.length,
          update_attempted: true,
          field_updated: 'api_key_encrypted and API_Owner'
        },
        'Database update failed - Full error details:'
      )

      let errorMessage = 'Database update failed'
      if (updateError.code === '42501') {
        errorMessage =
          'Permission denied - you may not have access to update this guild'
      } else if (updateError.code === '23505') {
        errorMessage =
          'Duplicate key error - this API key may already be in use'
      } else if (updateError.code === '23503') {
        errorMessage = 'Foreign key constraint - guild not found'
      } else if (updateError.message?.includes('RLS')) {
        errorMessage = 'Row Level Security policy violation - check permissions'
      }

      throw Errors.fromResponse(500, {
        error: errorMessage,
        details: maskSensitive(
          updateError.message || 'Failed to update guild configuration'
        ),
        code: updateError.code
      })
    }

    if (!updateData || updateData.length === 0) {
      logger.error(
        {
          guild_code,
          user_id: user.id
        },
        'No rows updated:'
      )

      throw Errors.fromResponse(404, {
        error: 'No rows updated - guild may not exist or you lack permissions',
        details: 'The update operation completed but no guild was modified'
      })
    }

    logger.info(
      { guildCode: guild_code, userId: user.id },
      'API key updated for guild'
    )

    let syncTriggered = false
    try {
      // Server-side call: prefer the internal URL so a split browser/server
      // Supabase host (e.g. Docker Compose's host.docker.internal) still
      // reaches the edge function from inside this container.
      const supabaseUrl = serverEnv.SUPABASE_INTERNAL_URL
      const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

      if (supabaseUrl && serviceKey) {
        const controller = new AbortController()
        const timeoutId = setTimeout(
          () => controller.abort(),
          SERVICE_TIMEOUTS.EXTERNAL_API
        )
        let syncResponse: Response

        try {
          syncResponse = await fetch(
            `${supabaseUrl}/functions/v1/sync-modular-workflow`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${serviceKey}`,
                'Content-Type': 'application/json',
                apikey: serviceKey
              },
              body: JSON.stringify({ guild_code }),
              signal: controller.signal
            }
          )
        } finally {
          clearTimeout(timeoutId)
        }

        if (syncResponse.ok) {
          const syncResult = await syncResponse.json()
          syncTriggered = syncResult.success === true
          logger.info(
            { guildCode: guild_code, syncTriggered },
            'Post-credential-update sync trigger completed'
          )
        }
      }
    } catch (syncError) {
      logger.warn(
        { guild_code, error: syncError },
        'Failed to trigger sync after API key update'
      )
    }

    const versionInfo = getVersionInfo()
    return NextResponse.json({
      success: true,
      message: syncTriggered
        ? 'API key updated and guild sync triggered successfully'
        : 'API key updated and validated successfully',
      details: {
        validated: true,
        autoSyncEnabled: true,
        syncTriggered,
        guildInfo: validationResult.guildInfo,
        permissions: {
          canAccessGuild: validationResult.canAccessGuild,
          canAccessRaidData: validationResult.canAccessRaidData
        }
      },
      version: versionInfo.version,
      timestamp: new Date().toISOString()
    })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    const enhancedError = createError(
      'API_KEY_SAVE_FAILED',
      'An unexpected error occurred while updating guild API key',
      {
        action: 'update_guild_api_key',
        component: 'guild-api-key-route'
      },
      error
    )
    throw Errors.fromResponse(500, formatErrorForUser(enhancedError))
  }
})
