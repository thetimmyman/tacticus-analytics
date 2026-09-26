import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  checkRateLimit,
  getClientId,
  getClientIp
} from '@/app/lib/middleware/rate-limit'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { persistPlayerApiKey } from '@/app/lib/profile/persist-player-api-key'
import { createComponentLogger } from '@/app/lib/logging'
import type { Json, TypedSupabaseClient } from '@tacticus/app-core/types'
import { RPC_ERROR_CODES, ROUTE_ERROR_CODES } from './error-codes'
import type { RejectionMapping } from './error-codes'

// The fallback only satisfies noUncheckedIndexedAccess.
function knownMapping(
  map: Record<string, RejectionMapping>,
  code: string
): RejectionMapping {
  return (
    map[code] ?? {
      status: 500,
      copy: 'An unexpected error occurred. Please try again.'
    }
  )
}

const logger = createComponentLogger('api.profile.change-player-id')

/** Self-service player-ID change. Witnesses: the key's guild is the target's (H1), the target
 * is on that roster once and the caller's player is not (H2), and /player name = synced raw
 * username. Authority stays in the DB corridor (single-use service-minted proof + session bind). */

interface ChangePlayerIdRequest {
  newPlayerId?: unknown
  apiKey?: unknown
}

const MINT_CAP_LIMIT = 5
const MINT_CAP_WINDOW_MS = 24 * 60 * 60 * 1000
const SUCCESS_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000
const SYNC_STALE_MS = 30 * 24 * 60 * 60 * 1000

// errorHandler envelope, so normalizeErrorResponse passes it through.
function rejectionResponse(
  code: string,
  mapping: { status: number; copy: string },
  extra?: Record<string, unknown>
): NextResponse {
  return NextResponse.json(
    { error: { code, message: mapping.copy, ...(extra ?? {}) } },
    { status: mapping.status }
  )
}

// Unknown codes become a generic 500 that does not echo the code.
function rpcRejection(code: string | null | undefined): NextResponse {
  const mapping = code ? RPC_ERROR_CODES[code] : undefined
  if (!code || !mapping) {
    logger.error(
      { rpcErrorCode: code ?? null },
      'WI-6240: unmapped machine code from the transfer corridor'
    )
    return NextResponse.json(
      {
        error: {
          code: 'INTERNAL_ERROR',
          message: 'An unexpected error occurred. Please try again.'
        }
      },
      { status: 500 }
    )
  }
  return rejectionResponse(code, mapping)
}

function routeRejection(code: keyof typeof ROUTE_ERROR_CODES): NextResponse {
  return rejectionResponse(code, knownMapping(ROUTE_ERROR_CODES, code))
}

// Witness rejections are audited so probing is visible; outcomes must be in the table's CHECK list.
const WITNESS_SOURCE_PATH = 'profile/change-player-id/witness'
const WITNESS_OUTCOMES: Record<keyof typeof ROUTE_ERROR_CODES, string> = {
  GUILD_SCOPE_REQUIRED: 'rejected_invalid_input',
  KEY_NOT_IN_TARGET_GUILD: 'rejected_user_mismatch',
  TARGET_NOT_IN_KEY_GUILD: 'rejected_user_mismatch',
  AMBIGUOUS_KEY_OWNERSHIP: 'rejected_user_mismatch',
  NO_SYNCED_ACTIVITY: 'rejected_invalid_input',
  NAME_NOT_UNIQUE: 'rejected_invalid_input',
  GUILD_SYNC_STALE: 'rejected_invalid_input',
  POSSESSION_NAME_MISMATCH: 'rejected_user_mismatch'
}

/** Best-effort: never fails the request. `details` must never carry the API key or a derivative. */
async function auditWitnessRejection(params: {
  service: TypedSupabaseClient
  request: NextRequest
  userId: string
  code: keyof typeof ROUTE_ERROR_CODES
  targetPlayerId: string
  guildCode: string | null
  keyPlayerName?: string
}): Promise<void> {
  try {
    // request_ip is inet: a malformed forwarded IP would fail the INSERT and let a caller
    // suppress their own audit row, so validate strictly and fall back to null.
    const clientIp = getClientIp(params.request)
    const auditIp = isIP(clientIp) !== 0 ? clientIp : null
    const { error } = await params.service.from('player_claim_audit').insert({
      user_id: params.userId,
      player_id: params.targetPlayerId,
      guild_code: params.guildCode,
      source_path: WITNESS_SOURCE_PATH,
      request_ip: auditIp,
      user_agent: params.request.headers.get('user-agent'),
      outcome: WITNESS_OUTCOMES[params.code] ?? 'rejected_invalid_input',
      details: {
        code: params.code,
        targetPlayerId: params.targetPlayerId,
        ...(params.keyPlayerName !== undefined
          ? { keyPlayerName: params.keyPlayerName }
          : {})
      }
    })
    if (error) {
      logger.error(
        { userId: params.userId, code: params.code, dbError: error.message },
        'WI-6240: witness-rejection audit write failed'
      )
    }
  } catch (auditError) {
    logger.error(
      {
        userId: params.userId,
        code: params.code,
        err:
          auditError instanceof Error ? auditError.message : String(auditError)
      },
      'WI-6240: witness-rejection audit write threw'
    )
  }
}

function stableStringify(payload: Record<string, unknown>): string {
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(payload).sort()) {
    sorted[key] = payload[key]
  }
  return JSON.stringify(sorted)
}

interface BindResult {
  success?: boolean
  idempotent?: boolean
  player_id?: string
  guild_code?: string
  error?: string | null
  error_code?: string | null
}

function parseBindResult(data: Json | null): BindResult | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null
  return data as BindResult
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.fromResponse(401, { error: 'Authentication required' })
  )

  const body = (await request.json().catch(() => ({}))) as ChangePlayerIdRequest
  const newPlayerId =
    typeof body.newPlayerId === 'string' ? body.newPlayerId.trim() : ''
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''

  if (!newPlayerId || newPlayerId.length < 3) {
    throw Errors.fromResponse(400, { error: 'Valid Player ID is required' })
  }

  const { data: currentMapping, error: currentMappingError } = await supabase
    .from(CURRENT_USER_PLAYER_MAPPING)
    .select('player_id')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .maybeSingle()

  if (currentMappingError) {
    throw Errors.fromResponse(503, {
      error: 'Unable to verify the current Player ID. Please try again.'
    })
  }

  if (currentMapping?.player_id === newPlayerId) {
    return NextResponse.json({
      success: true,
      message: 'Player ID unchanged',
      status: 'unchanged'
    })
  }

  if (!apiKey) {
    throw Errors.fromResponse(400, {
      error:
        'An API key for the new account is required (create it with Guild scope on the new account).'
    })
  }

  const service = serviceDb()

  const witnessRejection = async (
    code: keyof typeof ROUTE_ERROR_CODES,
    context?: { guildCode?: string | null; keyPlayerName?: string }
  ): Promise<NextResponse> => {
    await auditWitnessRejection({
      service,
      request,
      userId: user.id,
      code,
      targetPlayerId: newPlayerId,
      guildCode: context?.guildCode ?? null,
      keyPlayerName: context?.keyPlayerName
    })
    return routeRejection(code)
  }

  // Every rate-limit layer runs before any upstream call.
  const rateLimitResult = await checkRateLimit(
    getClientId(request, user.id),
    request.nextUrl.pathname
  )
  if (!rateLimitResult.allowed) {
    request.rateLimitHeaders = rateLimitResult.headers
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many requests. Please slow down and try again.'
        }
      },
      { status: 429, headers: rateLimitResult.headers }
    )
  }

  // Mint cap filters on claimed_at (covered by idx_player_claim_audit_user_at).
  const mintWindowStart = new Date(
    Date.now() - MINT_CAP_WINDOW_MS
  ).toISOString()
  const { count: mintCount, error: mintCountError } = await service
    .from('player_claim_audit')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', user.id)
    .eq('source_path', 'profile/change-player-id/mint')
    .gte('claimed_at', mintWindowStart)
  if (mintCountError) {
    throw Errors.fromResponse(503, {
      error: 'Unable to verify recent change attempts. Please try again.'
    })
  }
  if ((mintCount ?? 0) >= MINT_CAP_LIMIT) {
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message:
            'Too many verification attempts today. Please try again tomorrow.'
        }
      },
      { status: 429 }
    )
  }

  // A recent success answers 429 before burning a mint; the bind RPC enforces the real limit.
  const cooldownStart = new Date(Date.now() - SUCCESS_COOLDOWN_MS).toISOString()
  const { data: recentSuccesses, error: recentSuccessError } = await service
    .from('player_claim_audit')
    .select('id, details')
    .eq('user_id', user.id)
    .eq('source_path', 'profile/change-player-id')
    .eq('outcome', 'success')
    .gte('claimed_at', cooldownStart)
    .order('claimed_at', { ascending: false })
    .limit(10)
  if (recentSuccessError) {
    throw Errors.fromResponse(503, {
      error: 'Unable to verify recent account changes. Please try again.'
    })
  }
  const hasRecentTransfer = (recentSuccesses ?? []).some((row) => {
    const details = row.details
    if (!details || typeof details !== 'object' || Array.isArray(details)) {
      return true
    }
    return (details as { idempotent?: unknown }).idempotent !== true
  })
  if (hasRecentTransfer) {
    return rejectionResponse(
      'RATE_LIMITED',
      knownMapping(RPC_ERROR_CODES, 'RATE_LIMITED')
    )
  }

  const { data: sourceMapping, error: sourceError } = await service
    .from('player_mapping')
    .select('player_id, guild_code')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .maybeSingle()
  if (sourceError) {
    throw Errors.fromResponse(503, {
      error: 'Unable to read your current profile. Please try again.'
    })
  }
  if (!sourceMapping) {
    return rejectionResponse(
      'NO_ATTESTED_SOURCE',
      knownMapping(RPC_ERROR_CODES, 'NO_ATTESTED_SOURCE')
    )
  }
  const sourcePlayerId = sourceMapping.player_id

  const { data: targetMapping, error: targetError } = await service
    .from('player_mapping')
    .select(
      'id, player_id, guild_code, user_id, ownership_attestation_id, display_name, original_display_name, has_duplicate_name, updated_at'
    )
    .eq('player_id', newPlayerId)
    .eq('is_current', true)
    .maybeSingle()
  if (targetError) {
    throw Errors.fromResponse(503, {
      error: 'Unable to read the target profile. Please try again.'
    })
  }
  if (!targetMapping) {
    return rejectionResponse(
      'PLAYER_NOT_ON_TRACKED_ROSTER',
      knownMapping(RPC_ERROR_CODES, 'PLAYER_NOT_ON_TRACKED_ROSTER')
    )
  }
  if (
    targetMapping.user_id !== null ||
    targetMapping.ownership_attestation_id !== null
  ) {
    return rejectionResponse(
      'TARGET_ALREADY_CLAIMED',
      knownMapping(RPC_ERROR_CODES, 'TARGET_ALREADY_CLAIMED')
    )
  }
  const targetGuildCode = targetMapping.guild_code
  if (!targetGuildCode) {
    return witnessRejection('NO_SYNCED_ACTIVITY')
  }

  const guild = await tacticusAPI.getGuild(apiKey)
  if (!guild || !guild.guildId) {
    return witnessRejection('GUILD_SCOPE_REQUIRED', {
      guildCode: targetGuildCode
    })
  }

  // H1: the key's guildId must resolve via guild_config to the target's guild_code.
  const { data: guildRows, error: guildLookupError } = await service.rpc(
    'get_guild_config_by_guild_id',
    { p_guild_id: guild.guildId }
  )
  if (guildLookupError) {
    throw Errors.fromResponse(503, {
      error: 'Unable to resolve the guild for that API key. Please try again.'
    })
  }
  const keyGuild =
    Array.isArray(guildRows) && guildRows.length > 0 ? guildRows[0] : null
  if (!keyGuild || keyGuild.guild_code !== targetGuildCode) {
    return witnessRejection('KEY_NOT_IN_TARGET_GUILD', {
      guildCode: targetGuildCode
    })
  }

  const members = Array.isArray(guild.members) ? guild.members : []
  const targetMemberCount = members.filter(
    (member) => member.userId === newPlayerId
  ).length
  if (targetMemberCount !== 1) {
    return witnessRejection('TARGET_NOT_IN_KEY_GUILD', {
      guildCode: targetGuildCode
    })
  }

  // H2: membership proves nothing when the caller's current account is on the same roster.
  if (members.some((member) => member.userId === sourcePlayerId)) {
    return witnessRejection('AMBIGUOUS_KEY_OWNERSHIP', {
      guildCode: targetGuildCode
    })
  }

  const player = await tacticusAPI.getPlayer(apiKey)
  const keyPlayerName = player?.details?.name
  if (!keyPlayerName) {
    throw Errors.fromResponse(502, {
      error:
        'Tacticus did not return the player profile for that key. Please try again.'
    })
  }

  // Never use display_name when has_duplicate_name is true, never suffix-strip, never read EOT_GR_data.
  const hasDuplicateName = targetMapping.has_duplicate_name === true
  const rawUsername = hasDuplicateName
    ? targetMapping.original_display_name
    : targetMapping.display_name
  if (!rawUsername || rawUsername.trim().length === 0) {
    return witnessRejection('NO_SYNCED_ACTIVITY', {
      guildCode: targetGuildCode
    })
  }
  if (hasDuplicateName) {
    return witnessRejection('NAME_NOT_UNIQUE', { guildCode: targetGuildCode })
  }

  const { data: guildConfig, error: guildConfigError } = await service
    .from('guild_config')
    .select('last_successful_sync')
    .eq('guild_code', targetGuildCode)
    .maybeSingle()
  if (guildConfigError) {
    throw Errors.fromResponse(503, {
      error: "Unable to verify the guild's sync freshness. Please try again."
    })
  }
  const lastSuccessfulSync = guildConfig?.last_successful_sync ?? null
  if (
    !lastSuccessfulSync ||
    Date.now() - new Date(lastSuccessfulSync).getTime() > SYNC_STALE_MS
  ) {
    return witnessRejection('GUILD_SYNC_STALE', { guildCode: targetGuildCode })
  }

  // Case-sensitive, trim-only: has_duplicate_name is case-sensitive, so casefolding would
  // let same-guild case variants bypass NAME_NOT_UNIQUE.
  if (keyPlayerName.trim() !== rawUsername.trim()) {
    if (
      keyPlayerName.trim().toLowerCase() === rawUsername.trim().toLowerCase()
    ) {
      // Case-only mismatch signals upstream casing skew; logged, same rejection code.
      logger.warn(
        {
          userId: user.id,
          targetPlayerId: newPlayerId,
          caseOnlyMismatch: true
        },
        'WI-6240: possession name mismatch differs only by case'
      )
    }
    return witnessRejection('POSSESSION_NAME_MISMATCH', {
      guildCode: targetGuildCode,
      keyPlayerName
    })
  }

  // The digest must not contain the API key or any derivative of it.
  const digest = createHash('sha256')
    .update(
      stableStringify({
        v: 1,
        targetPlayerId: newPlayerId,
        targetGuildCode,
        sourcePlayerId,
        keyGuildId: guild.guildId,
        keyPlayerName,
        syncedUsername: rawUsername,
        syncedUsernameObservedAt: lastSuccessfulSync,
        hasDuplicateName: false,
        mappingUpdatedAt: targetMapping.updated_at,
        verifiedAt: new Date().toISOString()
      })
    )
    .digest('hex')

  // Mint with the service client, bind with the session client (the corridor rejects service_role).
  const { data: mintData, error: mintError } = await service.rpc(
    'mint_player_possession_invite',
    {
      p_subject: user.id,
      p_player_id: newPlayerId,
      p_upstream_digest: digest
    }
  )
  if (mintError) {
    // RAISE puts the machine code in DETAIL, surfaced by PostgREST as `details`.
    const detail = (mintError as { details?: unknown }).details
    return rpcRejection(typeof detail === 'string' ? detail : null)
  }
  if (typeof mintData !== 'string' || mintData.length === 0) {
    logger.error(
      { userId: user.id },
      'WI-6240: mint returned no invite id despite a null error'
    )
    return rpcRejection(null)
  }
  const proofInviteId = mintData

  const { data: bindData, error: bindError } = await supabase.rpc(
    'change_own_player_account',
    { p_proof_invite_id: proofInviteId }
  )
  if (bindError) {
    // Rejections return success=false as data; a non-null error is a preamble fault.
    logger.error(
      { userId: user.id, code: bindError.code, message: bindError.message },
      'WI-6240: bind RPC transport error'
    )
    if (bindError.code === '42501') {
      throw Errors.fromResponse(401, {
        error: 'Authentication required to change your player account'
      })
    }
    throw Errors.fromResponse(500, {
      error: 'The account change failed unexpectedly. Please contact support.'
    })
  }
  const bind = parseBindResult(bindData)
  if (!bind || bind.success !== true) {
    // No bind retry: post-custody rejections burn the proof by design.
    return rpcRejection(bind?.error_code ?? null)
  }

  const persistResult = await persistPlayerApiKey(service, user.id, apiKey)
  if (!persistResult.ok) {
    // The transfer is committed; a 500 would strand a keyless account, so log and report success.

    logger.error(
      {
        userId: user.id,
        playerId: bind.player_id ?? newPlayerId,
        reason: persistResult.reason,
        detail: persistResult.detail
      },
      'WI-6240: player-ID transfer committed but the API key could not be stored — the user must re-add it in API key settings'
    )
    return NextResponse.json({
      success: true,
      apiKeyStored: false,
      playerId: bind.player_id ?? newPlayerId,
      guildCode: bind.guild_code ?? targetGuildCode,
      idempotent: bind.idempotent === true,
      message:
        'Your Player ID was changed, but the API key could not be stored. Please re-add it in the API key section of your profile settings.'
    })
  }

  return NextResponse.json({
    success: true,
    apiKeyStored: true,
    playerId: bind.player_id ?? newPlayerId,
    guildCode: bind.guild_code ?? targetGuildCode,
    idempotent: bind.idempotent === true,
    message: 'Player ID changed successfully.'
  })
})
