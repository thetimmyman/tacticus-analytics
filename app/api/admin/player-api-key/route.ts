import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.admin.player-api-key')
import { encryptApiKey } from '@tacticus/app-core/encryption'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'
import {
  validateApiKeyWithTacticus,
  logApiKeyOperation
} from '@tacticus/app-core/api-key-validation'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'

export const dynamic = 'force-dynamic'

interface PlayerApiKeyRpcResult {
  success: boolean
  message?: string
  error?: string
  code?: string
  player_id?: string
  display_name?: string
}

interface CallerProfile {
  role: string | null
  guild_code: string | null
}

/** The RPC re-checks; this gives clear 403s instead of RPC errors. */
async function requireOfficerOrLeader(
  supabase: Awaited<ReturnType<typeof db>>,
  userId: string
): Promise<CallerProfile> {
  const { data, error } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('role, guild_code')
    .eq('user_id', userId)
    .eq('is_current', true)
    .maybeSingle()

  if (error) {
    logger.error({ err: error, userId }, 'Failed to load caller profile')
    throw Errors.fromResponse(500, {
      error: 'Failed to verify permissions',
      code: 'PROFILE_LOOKUP_FAILED'
    })
  }
  if (!data || !data.role) {
    throw Errors.fromResponse(403, {
      error: 'No active guild membership',
      code: 'NO_MEMBERSHIP'
    })
  }
  if (!canManageHeraldRole(data.role)) {
    throw Errors.fromResponse(403, {
      error: 'Only officers and leaders can manage API keys',
      code: 'INSUFFICIENT_PERMISSIONS'
    })
  }
  return { role: data.role, guild_code: data.guild_code }
}

async function authorizePlayerApiKeyAdmin() {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.fromResponse(401, {
      error: 'You must be logged in',
      code: 'AUTH_REQUIRED'
    })
  )
  await requireOfficerOrLeader(supabase, user.id)
  return { supabase, user }
}

function requireSuccessfulPlayerApiKeyRpc(
  action: 'remove' | 'update',
  playerId: string,
  rpcData: unknown,
  rpcError: { message?: string } | null
): PlayerApiKeyRpcResult {
  const rpcResult = rpcData as PlayerApiKeyRpcResult | null
  if (rpcError) {
    logger.error({ error: rpcError, playerId }, 'RPC function failed:')
    throw Errors.fromResponse(500, {
      error: `Failed to ${action} API key via RPC`,
      code: 'RPC_ERROR',
      details: rpcError.message || 'Unknown RPC error'
    })
  }
  if (!rpcResult?.success) {
    logger.error(
      { result: rpcResult, playerId },
      'RPC function returned error:'
    )
    throw Errors.fromResponse(400, {
      error: rpcResult?.error || `Failed to ${action} API key`,
      code: rpcResult?.code || 'RPC_FUNCTION_ERROR',
      details: rpcResult?.message || 'RPC function returned unsuccessful result'
    })
  }
  return rpcResult
}

function throwUnexpectedPlayerApiKeyError(
  method: 'DELETE' | 'POST',
  error: unknown
): never {
  rethrowIfAppError(error)
  logger.error(
    { err: error },
    `Unexpected error in ${method} /api/admin/player-api-key:`
  )
  throw Errors.fromResponse(500, {
    error: 'An unexpected error occurred',
    code: 'UNEXPECTED_ERROR'
  })
}

// Not app-admin: own-guild rank; `in-handler` because it needs the handler's RLS-bound client.
const PLAYER_API_KEY_GUARD = {
  guard: 'in-handler',
  reason:
    'Guild-scoped: officers/leaders manage keys for players in their own guild, re-checked by the SECURITY DEFINER RPC against auth.uid().'
} as const

export const POST = withAdminGuards(
  PLAYER_API_KEY_GUARD,
  async (request: NextRequest) => {
    try {
      const { supabase, user } = await authorizePlayerApiKeyAdmin()

      let playerId: string
      let apiKey: string
      try {
        const body = await request.json()
        playerId = body.playerId
        apiKey = body.apiKey
      } catch {
        throw Errors.fromResponse(400, {
          error: 'Invalid request format',
          code: 'INVALID_REQUEST'
        })
      }

      if (
        !playerId ||
        !apiKey ||
        typeof apiKey !== 'string' ||
        apiKey.trim().length === 0
      ) {
        throw Errors.fromResponse(400, {
          error: 'Player ID and API key are required',
          code: 'MISSING_FIELDS'
        })
      }

      logger.info(
        'Validating admin-managed player API key with Tacticus API before saving...'
      )
      const validationResult = await validateApiKeyWithTacticus(
        apiKey.trim(),
        true
      )

      logApiKeyOperation(
        'update',
        `ADMIN_PLAYER_${playerId}`,
        validationResult,
        user.id
      )

      if (!validationResult.isValid) {
        throw Errors.fromResponse(400, {
          error: 'API key validation failed',
          details: validationResult.error,
          code: 'INVALID_API_KEY',
          recommendation: validationResult.error?.includes('Guild Raid')
            ? 'Please generate a new API key with both "Guild" and "Guild Raid" permissions selected'
            : 'Please check your API key and try again'
        })
      }

      let encryptedApiKey: string
      try {
        encryptedApiKey = await encryptApiKey(apiKey.trim())
      } catch (encryptionError) {
        logger.error({ err: encryptionError }, 'Failed to encrypt API key:')
        throw Errors.fromResponse(500, {
          error: 'Failed to encrypt API key',
          code: 'ENCRYPTION_FAILED'
        })
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'update_player_api_key_admin',
        {
          p_player_id: playerId,
          p_encrypted_api_key: encryptedApiKey
        }
      )
      const rpcResult = requireSuccessfulPlayerApiKeyRpc(
        'update',
        playerId,
        rpcData,
        rpcError
      )

      return NextResponse.json({
        success: true,
        message:
          rpcResult.message || `API key successfully validated and saved`,
        details: {
          validated: true,
          guildInfo: validationResult.guildInfo,
          permissions: {
            canAccessGuild: validationResult.canAccessGuild,
            canAccessRaidData: validationResult.canAccessRaidData
          },
          player_id: rpcResult.player_id,
          display_name: rpcResult.display_name
        },
        timestamp: new Date().toISOString()
      })
    } catch (unexpectedError) {
      throwUnexpectedPlayerApiKeyError('POST', unexpectedError)
    }
  }
)

export const DELETE = withAdminGuards(
  PLAYER_API_KEY_GUARD,
  async (request: NextRequest) => {
    try {
      const { supabase } = await authorizePlayerApiKeyAdmin()

      const { searchParams } = new URL(request.url)
      const playerId = searchParams.get('playerId')

      if (!playerId) {
        throw Errors.fromResponse(400, {
          error: 'Player ID is required',
          code: 'MISSING_PLAYER_ID'
        })
      }

      const { data: rpcData, error: rpcError } = await supabase.rpc(
        'remove_player_api_key_admin',
        {
          p_player_id: playerId
        }
      )
      const rpcResult = requireSuccessfulPlayerApiKeyRpc(
        'remove',
        playerId,
        rpcData,
        rpcError
      )

      return NextResponse.json({
        success: true,
        message: rpcResult.message || `API key successfully removed`,
        details: {
          player_id: rpcResult.player_id,
          display_name: rpcResult.display_name
        }
      })
    } catch (unexpectedError) {
      throwUnexpectedPlayerApiKeyError('DELETE', unexpectedError)
    }
  }
)
