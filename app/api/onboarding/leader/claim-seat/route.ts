import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  checkRateLimit,
  getClientId,
  getClientIp
} from '@/app/lib/middleware/rate-limit'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { tacticusUpstreamHealthy } from '@/app/lib/onboarding/guild-authority'
import {
  SYNC_STALE_MS,
  isWitnessStale,
  rosterWitnessAt
} from '@/app/lib/onboarding/roster-freshness'
import { createComponentLogger } from '@/app/lib/logging'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  MINT_ERROR_CODES,
  ROUTE_ERROR_CODES,
  type RouteErrorCode
} from './error-codes'

const logger = createComponentLogger('api.onboarding.leader.claim-seat')

/**
 * Lets a new guild's registrar prove their own leader/officer seat. Requires H1 a service-only registration
 * receipt, H2 a unique unclaimed roster name match, H3 an invite-capable role, H4 fresh sync and roster.
 */

const INVITE_CAPABLE_STORED_ROLES = new Set(['leader', 'officer'])

// getPlayer() returns null for scope refusal and outages; the circuit probe tells them apart.

const WITNESS_SOURCE_PATH = 'onboarding/leader-seat/witness'
const REGISTRATION_AUTHORITY_SOURCE_PATH =
  'onboarding/guild-registration/bootstrap-authority'
const WITNESS_OUTCOMES: Record<RouteErrorCode, string> = {
  ALREADY_LINKED: 'rejected_invalid_input',
  REGISTRATION_AUTHORITY_REQUIRED: 'rejected_invalid_input',
  GUILD_NOT_FOUND: 'rejected_invalid_input',
  PLAYER_SCOPE_REQUIRED: 'rejected_invalid_input',
  TACTICUS_UNAVAILABLE: 'rejected_invalid_input',
  PLAYER_LOOKUP_FAILED: 'rejected_invalid_input',
  GUILD_SYNC_STALE: 'rejected_invalid_input',
  NO_SYNCED_ACTIVITY: 'rejected_invalid_input',
  POSSESSION_NAME_MISMATCH: 'rejected_user_mismatch',
  NAME_NOT_UNIQUE: 'rejected_invalid_input',
  TARGET_NOT_INVITE_CAPABLE: 'rejected_user_mismatch'
}

interface ClaimSeatRequest {
  apiKey?: unknown
}

type RosterRow = {
  id: number
  player_id: string
  display_name: string
  original_display_name: string | null
  has_duplicate_name: boolean | null
  user_id: string | null
  ownership_attestation_id: string | null
  role: string | null
  is_app_admin: boolean | null
  updated_at: string | null
  protected: boolean | null
}

function rejection(
  code: RouteErrorCode,
  extra?: Record<string, unknown>
): NextResponse {
  const mapping = ROUTE_ERROR_CODES[code]
  return NextResponse.json(
    { error: { code, message: mapping.copy, ...(extra ?? {}) } },
    { status: mapping.status }
  )
}

// Unknown DB codes become a generic 500 that does not echo the code.
function mintRejection(code: string | null | undefined): NextResponse {
  const mapping = code ? MINT_ERROR_CODES[code] : undefined
  if (!code || !mapping) {
    logger.error(
      { mintErrorCode: code ?? null },
      'Unmapped machine code from the seat-bootstrap corridor'
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
  return NextResponse.json(
    { error: { code, message: mapping.copy } },
    { status: mapping.status }
  )
}

/** Best-effort: never fails the request. `details` must never carry the API key or a derivative. */
async function auditRejection(params: {
  service: TypedSupabaseClient
  request: NextRequest
  userId: string
  code: RouteErrorCode
  guildCode: string | null
  targetPlayerId?: string | null
  keyPlayerName?: string
}): Promise<void> {
  try {
    // request_ip is inet: a malformed header would fail the INSERT and let a caller suppress their row.
    const clientIp = getClientIp(params.request)
    const auditIp = isIP(clientIp) !== 0 ? clientIp : null
    const { error } = await params.service.from('player_claim_audit').insert({
      user_id: params.userId,
      player_id: params.targetPlayerId ?? null,
      guild_code: params.guildCode,
      source_path: WITNESS_SOURCE_PATH,
      request_ip: auditIp,
      user_agent: params.request.headers.get('user-agent'),
      outcome: WITNESS_OUTCOMES[params.code] ?? 'rejected_invalid_input',
      details: {
        code: params.code,
        ...(params.keyPlayerName !== undefined
          ? { keyPlayerName: params.keyPlayerName }
          : {})
      }
    })
    if (error) {
      logger.error(
        { userId: params.userId, code: params.code, dbError: error.message },
        'Seat-bootstrap rejection audit write failed'
      )
    }
  } catch (auditError) {
    logger.error(
      { userId: params.userId, code: params.code, err: auditError },
      'Seat-bootstrap rejection audit write threw'
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

export const POST = withErrorHandler(async (request: NextRequest) => {
  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.fromResponse(401, { error: 'Unauthorized' })
  )
  const service = serviceDb()

  const rate = await checkRateLimit(
    getClientId(request, user.id),
    request.nextUrl.pathname
  )
  if (!rate.allowed) {
    request.rateLimitHeaders = rate.headers
    return NextResponse.json(
      {
        error: {
          code: 'RATE_LIMITED',
          message: 'Too many verification attempts. Please wait and try again.'
        }
      },
      { status: 429 }
    )
  }

  const body = (await request.json().catch(() => ({}))) as ClaimSeatRequest
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
  if (!apiKey) {
    throw Errors.fromResponse(400, { error: 'A Tacticus API key is required' })
  }

  const { data: heldRows, error: heldError } = await service
    .from('player_mapping')
    .select('id')
    .eq('user_id', user.id)
    .eq('is_current', true)
  if (heldError) {
    throw Errors.fromResponse(503, {
      error: 'Unable to read your current profile. Please try again.'
    })
  }
  if ((heldRows ?? []).length > 0) return rejection('ALREADY_LINKED')

  // H1: onboarding_progress is browser-writable, so only the server receipt counts.
  const { data: authorityRow, error: authorityError } = await service
    .from('player_claim_audit')
    .select('id, guild_code, claimed_at, details')
    .eq('user_id', user.id)
    .eq('source_path', REGISTRATION_AUTHORITY_SOURCE_PATH)
    .eq('outcome', 'success')
    .order('claimed_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (authorityError) {
    throw Errors.fromResponse(503, {
      error: 'Unable to verify your guild registration. Please try again.'
    })
  }
  const authority = authorityRow as {
    id?: number | null
    guild_code?: string | null
    claimed_at?: string | null
  } | null
  const targetGuildCode = authority?.guild_code ?? null
  if (!targetGuildCode) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'REGISTRATION_AUTHORITY_REQUIRED',
      guildCode: null
    })
    return rejection('REGISTRATION_AUTHORITY_REQUIRED')
  }

  const { data: guildRow, error: guildRowError } = await service
    .from('guild_config')
    .select('guild_code, display_name, last_successful_sync')
    .eq('guild_code', targetGuildCode)
    .maybeSingle()
  if (guildRowError) {
    throw Errors.fromResponse(503, {
      error: 'Unable to resolve the guild for that API key. Please try again.'
    })
  }
  const guildConfig = guildRow as {
    guild_code?: string | null
    display_name?: string | null
    last_successful_sync?: string | null
  } | null
  if (!guildConfig?.guild_code) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'GUILD_NOT_FOUND',
      guildCode: null
    })
    return rejection('GUILD_NOT_FOUND')
  }

  const player = await tacticusAPI.getPlayer(apiKey)
  if (!player) {
    if (!tacticusUpstreamHealthy()) {
      await auditRejection({
        service,
        request,
        userId: user.id,
        code: 'TACTICUS_UNAVAILABLE',
        guildCode: targetGuildCode
      })
      return rejection('TACTICUS_UNAVAILABLE')
    }
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'PLAYER_SCOPE_REQUIRED',
      guildCode: targetGuildCode
    })
    return rejection('PLAYER_SCOPE_REQUIRED')
  }
  const keyPlayerName = player.details?.name
  if (!keyPlayerName) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'PLAYER_LOOKUP_FAILED',
      guildCode: targetGuildCode
    })
    return rejection('PLAYER_LOOKUP_FAILED')
  }

  const lastSync = guildConfig?.last_successful_sync ?? null
  if (!lastSync || Date.now() - new Date(lastSync).getTime() > SYNC_STALE_MS) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'GUILD_SYNC_STALE',
      guildCode: targetGuildCode,
      keyPlayerName
    })
    return rejection('GUILD_SYNC_STALE')
  }

  const { data: rosterRows, error: rosterError } = await guildRosterQuery(
    service,
    targetGuildCode,
    'id, player_id, display_name, original_display_name, has_duplicate_name, user_id, ownership_attestation_id, role, is_app_admin, updated_at, protected'
  )
  if (rosterError) {
    throw Errors.fromResponse(503, {
      error: 'Unable to read the guild roster. Please try again.'
    })
  }
  const roster = (rosterRows ?? []) as RosterRow[]

  // Raid sync success does not prove roster freshness, so check the roster rows too.
  const rosterObservedAt = rosterWitnessAt(roster)
  if (rosterObservedAt === null || isWitnessStale(rosterObservedAt)) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'GUILD_SYNC_STALE',
      guildCode: targetGuildCode,
      keyPlayerName
    })
    return rejection('GUILD_SYNC_STALE')
  }

  if (roster.length === 0) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'NO_SYNCED_ACTIVITY',
      guildCode: targetGuildCode,
      keyPlayerName
    })
    return rejection('NO_SYNCED_ACTIVITY')
  }

  // Never use display_name when has_duplicate_name; trim-only, case-sensitive like roster sync.
  const rawName = (row: RosterRow): string | null =>
    row.has_duplicate_name === true
      ? row.original_display_name
      : row.display_name

  const nameMatches = roster.filter(
    (row) => (rawName(row) ?? '').trim() === keyPlayerName.trim()
  )

  // Decide ambiguity before filtering unclaimed, or a duplicate becomes "unique" once the other claims.
  if (nameMatches.length > 1 || nameMatches.some((r) => r.has_duplicate_name)) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'NAME_NOT_UNIQUE',
      guildCode: targetGuildCode,
      keyPlayerName
    })
    return rejection('NAME_NOT_UNIQUE')
  }

  const candidate = nameMatches[0]
  if (
    !candidate ||
    candidate.user_id !== null ||
    candidate.ownership_attestation_id !== null
  ) {
    // Do not distinguish "no match" from "already claimed".
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'POSSESSION_NAME_MISMATCH',
      guildCode: targetGuildCode,
      targetPlayerId: candidate?.player_id ?? null,
      keyPlayerName
    })
    return rejection('POSSESSION_NAME_MISMATCH')
  }

  // H3: the mint RPC re-checks this under its locks.
  if (
    !INVITE_CAPABLE_STORED_ROLES.has((candidate.role ?? '').toLowerCase()) &&
    candidate.is_app_admin !== true
  ) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'TARGET_NOT_INVITE_CAPABLE',
      guildCode: targetGuildCode,
      targetPlayerId: candidate.player_id,
      keyPlayerName
    })
    return rejection('TARGET_NOT_INVITE_CAPABLE')
  }

  // The digest must not contain the key or anything derived from it.
  const digest = createHash('sha256')
    .update(
      stableStringify({
        v: 2,
        corridor: 'onboarding/leader-seat',
        targetPlayerId: candidate.player_id,
        targetGuildCode,
        registrationAuthorityReceiptId: authority?.id ?? null,
        registrationAuthorityObservedAt: authority?.claimed_at ?? null,
        keyPlayerName,
        syncedUsername: rawName(candidate),
        syncedUsernameObservedAt: new Date(rosterObservedAt).toISOString(),
        hasDuplicateName: false,
        subject: user.id,
        verifiedAt: new Date().toISOString()
      })
    )
    .digest('hex')

  // The DB re-checks eligibility under an advisory lock, so a concurrent claim cannot slip in.
  const { data: mintData, error: mintError } = await service.rpc(
    'mint_registrar_seat_invite',
    {
      p_subject: user.id,
      p_player_id: candidate.player_id,
      p_upstream_digest: digest
    }
  )
  if (mintError) {
    const detail = (mintError as { details?: unknown }).details
    return mintRejection(typeof detail === 'string' ? detail : null)
  }
  if (typeof mintData !== 'string' || mintData.length === 0) {
    logger.error(
      { userId: user.id },
      'Seat bootstrap returned no code despite a null error'
    )
    return mintRejection(null)
  }

  logger.info(
    { userId: user.id, guildCode: targetGuildCode },
    'Minted a first-leader seat invite from a verified possession proof'
  )

  return NextResponse.json({
    success: true,
    code: mintData,
    playerName: keyPlayerName,
    guildCode: targetGuildCode,
    guildName: guildConfig?.display_name ?? targetGuildCode
  })
})
