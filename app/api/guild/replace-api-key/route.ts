/** Unlike update-api-key: no remove path, stamps `api_key_last_validated`, no sync. Failure keeps the old key. */

import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { requireGuildCredentialMember } from '@/app/lib/auth/guild-permissions'
import { createComponentLogger } from '@/app/lib/logging'
import { encryptApiKey } from '@tacticus/app-core/encryption'
import { validateApiKeyWithTacticus } from '@tacticus/app-core/api-key-validation'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'

const logger = createComponentLogger('api.guild.replace-api-key')

interface ReplaceRequestBody {
  guild_code?: string
  api_key?: string
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const supabase = await db()

    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, {
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      })
    )

    const body = (await request.json()) as ReplaceRequestBody
    const guildCode = body.guild_code?.trim()
    const apiKey = body.api_key?.trim()

    if (!guildCode || !apiKey) {
      throw Errors.fromResponse(400, {
        error: 'Both guild_code and api_key are required',
        code: 'VALIDATION_ERROR',
        details:
          'F13 Replace + Verify cannot be used to remove a key — use Save / Remove for that.'
      })
    }

    const { data: targetGuild, error: lookupError } = await supabase
      .from('guild_config')
      .select('guild_code, guild_id')
      .eq('guild_code', guildCode)
      .single()

    if (lookupError || !targetGuild) {
      throw Errors.fromResponse(404, {
        error: 'Guild not found',
        details: `Guild ${guildCode} does not exist in the database`,
        code: 'GUILD_NOT_FOUND'
      })
    }

    // Only barrier before a service-role write: any-rank own-guild membership (roster rank lags the game).
    // Runs before the Tacticus call so this is not a key oracle.
    await requireGuildCredentialMember(
      supabase,
      user.id,
      targetGuild.guild_code,
      'guild/replace-api-key'
    )

    const validation = await validateApiKeyWithTacticus(apiKey)

    if (!validation.isValid) {
      throw Errors.fromResponse(400, {
        error: 'API key validation failed',
        details: validation.error,
        code: 'API_VALIDATION_FAILED',
        recommendation: validation.error?.includes('Guild Raid')
          ? 'Generate a new API key with both "Guild" and "Guild Raid" permissions enabled.'
          : 'Check the key value and try again. The previous key has not been changed.'
      })
    }

    if (!validation.guildInfo?.guildId) {
      throw Errors.fromResponse(400, {
        error: 'Could not determine guild from API key',
        details:
          'The key is valid but did not return guild information. The previous key has not been changed.',
        code: 'GUILD_IDENTITY_MISSING'
      })
    }

    // Without a stored guild_id any guild's valid key would pass.
    if (!targetGuild.guild_id) {
      logger.error(
        { targetGuild: guildCode },
        'WI-692 F13: guild_config.guild_id missing — cannot verify key ownership'
      )
      throw Errors.fromResponse(400, {
        error: 'Guild identity not linked',
        details: `Guild ${guildCode} has no Tacticus guild id on record, so key ownership cannot be verified. The previous key has not been changed.`,
        code: 'GUILD_IDENTITY_UNLINKED'
      })
    }

    if (validation.guildInfo.guildId !== targetGuild.guild_id) {
      logger.warn(
        {
          targetGuild: guildCode,
          targetGuildId: targetGuild.guild_id,
          apiKeyGuildId: validation.guildInfo.guildId,
          apiKeyGuildName: validation.guildInfo.guildName
        },
        'WI-692 F13: API key guild mismatch — replace rejected'
      )
      throw Errors.fromResponse(400, {
        error: 'API key belongs to a different guild',
        details: `This key is for "${validation.guildInfo.guildName}", not ${guildCode}. The previous key has not been changed.`,
        code: 'GUILD_MISMATCH'
      })
    }

    let encryptedApiKey: string
    try {
      encryptedApiKey = await encryptApiKey(apiKey)
    } catch (encryptError) {
      logger.error(
        { err: encryptError },
        'WI-692 F13: failed to encrypt replacement API key'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to encrypt API key',
        details:
          encryptError instanceof Error
            ? encryptError.message
            : 'Encryption failed — check ENCRYPTION_KEY is configured.',
        code: 'ENCRYPTION_ERROR'
      })
    }

    // `prevent_guild_config_authority_rewrite` rejects this write from any other role.
    const verifiedAt = new Date().toISOString()
    const { error: updateError } = await serviceDb()
      .from('guild_config')
      .update({
        api_key_encrypted: encryptedApiKey,
        api_key_is_valid: true,
        api_key_last_validated: verifiedAt,
        updated_at: verifiedAt
      })
      .eq('guild_code', targetGuild.guild_code)

    if (updateError) {
      logger.error(
        {
          error: updateError.message,
          code: updateError.code,
          guildCode,
          userId: user.id
        },
        'WI-692 F13: replace-api-key DB update failed'
      )
      throw Errors.fromResponse(500, {
        error: 'Failed to persist replacement key',
        details: updateError.message,
        code: 'DB_UPDATE_FAILED'
      })
    }

    logger.info(
      { guildCode, userId: user.id },
      'WI-692 F13: API key replaced and verified'
    )

    return NextResponse.json({
      success: true,
      verified_at: verifiedAt,
      guild_info: validation.guildInfo,
      permissions: {
        canAccessGuild: validation.canAccessGuild,
        canAccessRaidData: validation.canAccessRaidData
      }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      { err: error },
      'WI-692 F13: unexpected error in replace-api-key'
    )
    throw Errors.fromResponse(500, {
      error: 'Unexpected error during key replacement',
      code: 'INTERNAL_ERROR'
    })
  }
})
