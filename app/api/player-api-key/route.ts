import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.player-api-key')
import { persistPlayerApiKey } from '@/app/lib/profile/persist-player-api-key'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import {
  validateApiKeyWithTacticus,
  logApiKeyOperation
} from '@tacticus/app-core/api-key-validation'
import { sanitizeErrorForLog } from '@tacticus/app-core/logging-sanitizer'

interface TacticusPlayerInfo {
  details?: {
    name?: string
    powerLevel?: number
  }
}

const normalizePlayerPower = (value: number | undefined): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null
  }
  return Math.trunc(value)
}

export const GET = withErrorHandler(async () => {
  const supabase = await db()

  const user = await requireSessionUser(supabase, () =>
    Errors.unauthorized(
      'Authentication required to access API key information',
      {
        endpoint: '/api/player-api-key'
      }
    )
  )

  // tacticus_api_key_encrypted is not readable by `authenticated`.
  const { data: player, error } = await serviceDb()
    .from('player_mapping')
    .select(
      'tacticus_api_key_encrypted, api_key_is_valid, api_key_last_verified'
    )
    .eq('user_id', user.id)
    .eq('is_current', true)
    .single()

  if (error) {
    logger.error({ err: sanitizeErrorForLog(error) }, 'Player API key error:')
    throw Errors.internal('Failed to fetch API key status', {
      endpoint: '/api/player-api-key',
      details: error.message
    })
  }

  const hasKey = !!player?.tacticus_api_key_encrypted

  return NextResponse.json({
    hasApiKey: hasKey,
    isValid: player?.api_key_is_valid || false,
    lastVerified: player?.api_key_last_verified || null
  })
})

export const POST = withErrorHandler(async (request: NextRequest) => {
  const supabase = await db()

  const user = await requireSessionUser(supabase, () =>
    Errors.unauthorized('You must be logged in to add an API key', {
      action: 'save_player_api_key',
      component: 'player-api-key-route'
    })
  )

  let apiKey: string
  try {
    const body = await request.json()
    apiKey = body.apiKey
  } catch (error) {
    logger.warn(
      {
        error: sanitizeErrorForLog(error)
      },
      'Invalid JSON body for player API key request'
    )
    throw Errors.validation('Invalid request format', {
      code: 'INVALID_REQUEST'
    })
  }

  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
    throw Errors.validation('API key is required', { code: 'API_KEY_REQUIRED' })
  }

  logger.info({ userId: user.id }, 'Validating player API key before saving')
  const validationResult = await validateApiKeyWithTacticus(apiKey.trim(), true)

  logApiKeyOperation('update', 'PLAYER_API_KEY', validationResult, user.id)

  if (!validationResult.isValid) {
    const recommendation = validationResult.error?.includes('Guild Raid')
      ? 'Please generate a new API key with both "Guild" and "Guild Raid" permissions selected'
      : 'Please check your API key and try again'

    throw Errors.validation('Player API key validation failed', {
      code: 'API_VALIDATION_FAILED',
      details: validationResult.error,
      recommendation
    })
  }

  // Resolve the account the key opens, or a member could bind another account's key. Fail closed.
  let playerInfo: TacticusPlayerInfo | null = null
  try {
    playerInfo = (await tacticusAPI.getPlayer(
      apiKey.trim()
    )) as TacticusPlayerInfo | null
  } catch (error) {
    logger.error(
      { err: sanitizeErrorForLog(error) },
      'Failed to fetch player info:'
    )
    playerInfo = null
  }

  // The name columns are the identity the possession check compares against.
  const { data: existingMapping, error: checkError } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('id, player_id, original_display_name, has_duplicate_name')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .single()

  if (checkError && checkError.code !== 'PGRST116') {
    logger.error(
      { err: sanitizeErrorForLog(checkError) },
      'Failed to check existing mapping:'
    )
    throw Errors.internal('Database error while checking player mapping', {
      code: 'DB_CHECK_ERROR',
      details: checkError.message
    })
  }

  if (existingMapping) {
    // The key must open the caller's own account. The witness must be caller-unwritable, so never
    // display_name; the primary witness is the sync-owned EOT_GR_data."displayName" (newest row).
    const keyPlayerName = playerInfo?.details?.name?.trim()

    // A duplicated raw name identifies nobody.
    if (existingMapping.has_duplicate_name) {
      logger.warn(
        { userId: user.id },
        'Rejecting API key: roster name is duplicated, so it cannot witness ownership'
      )
      throw Errors.forbidden(
        'Your roster name is shared with another member, so we cannot confirm this key is yours. Ask an officer to add it for you.',
        { code: 'POSSESSION_NAME_AMBIGUOUS' }
      )
    }

    const { data: syncedName } = await serviceDb()
      .from('EOT_GR_data')
      .select('displayName')
      .eq('userId', existingMapping.player_id)
      .order('startedOn', { ascending: false })
      .limit(1)
      .maybeSingle()

    const rosterName = (
      syncedName?.displayName ??
      existingMapping.original_display_name ??
      ''
    ).trim()

    if (!keyPlayerName) {
      logger.warn(
        { userId: user.id },
        'Rejecting API key: Tacticus returned no player name to verify ownership against'
      )
      throw Errors.external(
        'Tacticus did not return a player name for that key. Please try again.',
        502,
        { code: 'PLAYER_LOOKUP_FAILED' }
      )
    }

    if (!rosterName) {
      // No fallback to display_name: it is caller-controlled.
      logger.warn(
        { userId: user.id },
        'Rejecting API key: no sync-owned name exists yet to verify ownership against'
      )
      throw Errors.external(
        'We have no synced roster data for you yet, so we cannot confirm this key is yours. Sync your guild once, then add the key.',
        502,
        { code: 'PLAYER_LOOKUP_FAILED' }
      )
    }

    if (rosterName !== keyPlayerName) {
      // keyPlayerName is logged but not returned. Accounts shown only as `Player#XXXXXX` cannot match by
      // name, so only they get the raid-evidence fallback.
      const boundAlias =
        'Player#' +
        existingMapping.player_id.replace(/-/g, '').slice(0, 6).toUpperCase()
      const aliasCase = rosterName === boundAlias
      let raidEvidenced = false
      if (aliasCase) {
        // A raid entry pairing the bound player id with the key's name; null falls through to 403.
        const raid = await (async () => {
          try {
            return await tacticusAPI.getCurrentGuildRaid(apiKey.trim())
          } catch {
            return null
          }
        })()
        raidEvidenced = !!raid?.entries?.find(
          (e) =>
            e.userId === existingMapping.player_id &&
            e.username === keyPlayerName
        )
      }
      if (!raidEvidenced) {
        logger.warn(
          { userId: user.id, rosterName, keyPlayerName, aliasCase },
          'Rejecting API key: key belongs to a different Tacticus account'
        )
        throw Errors.forbidden(
          'This API key returns a Tacticus name that does not match the name bound to your profile. Ask your CURRENT guild leader to run a Tacticus Analytics sync so your roster entry is up to date, then try again. If your account here is bound to a different Tacticus account, use "Change player account" on your Profile page to re-bind it first.',
          { code: 'POSSESSION_NAME_MISMATCH' }
        )
      }
      logger.info(
        { userId: user.id, rosterName, keyPlayerName },
        'API key possession accepted via raid-entry user-id corroboration'
      )
    }

    const playerPower = normalizePlayerPower(playerInfo?.details?.powerLevel)
    const persistResult = await persistPlayerApiKey(
      serviceDb(),
      user.id,
      apiKey,
      { playerPower }
    )

    if (!persistResult.ok) {
      if (persistResult.reason === 'encrypt_failed') {
        logger.error('Failed to encrypt API key')
        throw Errors.internal('Failed to encrypt API key', {
          action: 'update_player_api_key',
          component: 'player-api-key-route',
          userId: user.id
        })
      }
      throw Errors.internal('Failed to save API key to database', {
        action: 'update_player_api_key',
        component: 'player-api-key-route',
        userId: user.id,
        details: persistResult.detail
      })
    }
  } else {
    throw Errors.validation(
      'No player profile found. Please complete onboarding first.',
      {
        code: 'NO_PLAYER_PROFILE'
      }
    )
  }

  return NextResponse.json({
    success: true,
    playerName:
      playerInfo?.details?.name ||
      validationResult.guildInfo?.guildName ||
      'Unknown',
    powerLevel: playerInfo?.details?.powerLevel || 0,
    message: `API key successfully validated and saved for ${playerInfo?.details?.name || 'player'}`,
    details: {
      validated: true,
      guildInfo: validationResult.guildInfo,
      permissions: {
        canAccessGuild: validationResult.canAccessGuild,
        canAccessRaidData: validationResult.canAccessRaidData
      }
    },
    timestamp: new Date().toISOString()
  })
})
export const DELETE = withErrorHandler(async () => {
  const supabase = await db()

  const user = await requireSessionUser(supabase, () =>
    Errors.unauthorized('You must be logged in to remove an API key', {
      action: 'delete_player_api_key',
      component: 'player-api-key-route'
    })
  )

  // The encrypted key column is service-role-only.
  const { data: existingMapping, error: checkError } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('id')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .single()

  if (checkError || !existingMapping) {
    logger.error(
      { userId: user.id, error: sanitizeErrorForLog(checkError) },
      'No player mapping found for user:'
    )
    throw Errors.notFound('Player profile', 'Player profile not found')
  }

  const { error: updateError } = await serviceDb()
    .from('player_mapping')
    .update({
      tacticus_api_key_encrypted: null,
      api_key_is_valid: false,
      api_key_last_verified: null,
      updated_at: new Date().toISOString()
    })
    .eq('user_id', user.id)
    .eq('is_current', true)

  if (updateError) {
    logger.error(
      {
        error: sanitizeErrorForLog(updateError),
        userId: user.id,
        mappingId: existingMapping.id
      },
      'Failed to remove API key:'
    )

    throw Errors.internal('Failed to remove API key from database', {
      action: 'delete_player_api_key',
      component: 'player-api-key-route',
      userId: user.id,
      details: updateError.message
    })
  }

  logger.info({ userId: user.id }, 'API key removed successfully')
  return NextResponse.json({
    success: true,
    message: 'API key removed successfully'
  })
})
