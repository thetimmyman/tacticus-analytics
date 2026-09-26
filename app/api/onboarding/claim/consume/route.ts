import { guildRosterQuery } from '@/app/lib/data/guild-roster'
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
import { resolveGuildFromApiKey } from '@/app/lib/onboarding/guild-authority'
import { normalizeInviteCode } from '@/app/lib/onboarding/invite-code-normalization'
import {
  SYNC_STALE_MS,
  isRosterWitnessStale
} from '@/app/lib/onboarding/roster-freshness'
import { createComponentLogger } from '@/app/lib/logging'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  CLAIM_AUDIT_OUTCOMES,
  CLAIM_ERROR_CODES,
  type ClaimErrorCode
} from './error-codes'

const logger = createComponentLogger('api.onboarding.claim.consume')

/**
 * Consumes an invite only for the code's target (the RPC binds the caller, not the target). Proof: H1 key's
 * guild = invite's guild; H2 /player name = target's unique raw roster name; H3 target once on /guild; H4 fresh roster.
 */

// Transfer proofs; the claim RPC excludes them and so must we.
const TRANSFER_PROOF_PREFIX = 'PP6240-'

const WITNESS_SOURCE_PATH = 'onboarding/invite-claim/witness'

interface ConsumeRequest {
  code?: unknown
  apiKey?: unknown
}

type InviteRow = {
  id: string
  code: string
  player_id: string
  guild_code: string
  display_name: string
  expires_at: string
  used_at: string | null
  revoked_at: string | null
}

type TargetRosterRow = {
  player_id: string
  display_name: string
  original_display_name: string | null
  has_duplicate_name: boolean | null
  user_id: string | null
  updated_at: string | null
  protected: boolean | null
}

/** `original_display_name` when set (display_name then has a dedup suffix); never suffix-strips. */
function rawRosterName(row: TargetRosterRow): string {
  return (row.original_display_name ?? row.display_name ?? '').trim()
}

function rejection(code: ClaimErrorCode): NextResponse {
  const mapping = CLAIM_ERROR_CODES[code]
  return NextResponse.json(
    { error: { code, message: mapping.copy } },
    { status: mapping.status }
  )
}

/** Best-effort audit; `details` must never carry the API key or anything derived from it. */
async function auditRejection(params: {
  service: TypedSupabaseClient
  request: NextRequest
  userId: string
  code: ClaimErrorCode
  guildCode: string | null
  targetPlayerId?: string | null
  keyPlayerName?: string
}): Promise<void> {
  try {
    // request_ip is inet: a malformed forwarded IP would fail the INSERT and let a caller suppress their row.
    const clientIp = getClientIp(params.request)
    const auditIp = isIP(clientIp) !== 0 ? clientIp : null
    const { error } = await params.service.from('player_claim_audit').insert({
      user_id: params.userId,
      player_id: params.targetPlayerId ?? null,
      guild_code: params.guildCode,
      source_path: WITNESS_SOURCE_PATH,
      request_ip: auditIp,
      user_agent: params.request.headers.get('user-agent'),
      outcome: CLAIM_AUDIT_OUTCOMES[params.code] ?? 'rejected_invalid_input',
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
        'Invite-claim rejection audit write failed'
      )
    }
  } catch (auditError) {
    logger.error(
      { userId: params.userId, code: params.code, err: auditError },
      'Invite-claim rejection audit write threw'
    )
  }
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
          message: 'Too many claim attempts. Please wait and try again.'
        }
      },
      { status: 429 }
    )
  }

  const body = (await request.json().catch(() => ({}))) as ConsumeRequest
  const code =
    typeof body.code === 'string' ? normalizeInviteCode(body.code) : ''
  const apiKey = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''

  if (!code) return rejection('INVALID_CODE')
  if (!apiKey) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'API_KEY_REQUIRED',
      guildCode: null
    })
    return rejection('API_KEY_REQUIRED')
  }

  // Invite tables are readable only via a service_role-only SECURITY DEFINER function.
  const { data: inviteRows, error: inviteError } = await service.rpc(
    'claim_consume_read_invite',
    { p_code: code }
  )

  if (inviteError) {
    logger.error({ dbError: inviteError.message }, 'Invite lookup failed')
    return rejection('AUTHORITY_LOOKUP_FAILED')
  }

  const invite = ((inviteRows as InviteRow[] | null)?.[0] ??
    null) as InviteRow | null
  const inviteUnusable =
    !invite ||
    invite.used_at !== null ||
    invite.revoked_at !== null ||
    new Date(invite.expires_at).getTime() <= Date.now() ||
    invite.code.startsWith(TRANSFER_PROOF_PREFIX)

  if (inviteUnusable || !invite) {
    // One indistinguishable answer for every unusable state, so live codes cannot be enumerated.
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'INVALID_CODE',
      guildCode: invite?.guild_code ?? null,
      targetPlayerId: invite?.player_id ?? null
    })
    return rejection('INVALID_CODE')
  }

  // Member keys get 403 from /guild, so GUILD_SCOPE_REQUIRED falls back to the synced roster. Accepted
  // residual: a leaked live code plus an account renamed to the target's unique name skips membership proof.
  const authority = await resolveGuildFromApiKey(service, apiKey)
  const memberFallback =
    !authority.ok && authority.code === 'GUILD_SCOPE_REQUIRED'
  if (!authority.ok && !memberFallback) {
    const code: ClaimErrorCode =
      authority.code === 'TACTICUS_UNAVAILABLE'
        ? 'TACTICUS_UNAVAILABLE'
        : authority.code === 'GUILD_NOT_REGISTERED'
          ? 'GUILD_NOT_REGISTERED'
          : 'AUTHORITY_LOOKUP_FAILED'
    await auditRejection({
      service,
      request,
      userId: user.id,
      code,
      guildCode: invite.guild_code,
      targetPlayerId: invite.player_id
    })
    return rejection(code)
  }

  if (authority.ok && authority.guildCode !== invite.guild_code) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'KEY_NOT_IN_TARGET_GUILD',
      guildCode: invite.guild_code,
      targetPlayerId: invite.player_id
    })
    return rejection('KEY_NOT_IN_TARGET_GUILD')
  }

  const { data: guildRow, error: guildRowError } = await service
    .from('guild_config')
    .select('last_successful_sync')
    .eq('guild_code', invite.guild_code)
    .maybeSingle()

  if (guildRowError) {
    logger.error(
      { dbError: guildRowError.message },
      'Guild freshness lookup failed'
    )
    return rejection('AUTHORITY_LOOKUP_FAILED')
  }

  const lastSync =
    (guildRow as { last_successful_sync?: string | null } | null)
      ?.last_successful_sync ?? null
  if (!lastSync || Date.now() - new Date(lastSync).getTime() > SYNC_STALE_MS) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'GUILD_SYNC_STALE',
      guildCode: invite.guild_code,
      targetPlayerId: invite.player_id
    })
    return rejection('GUILD_SYNC_STALE')
  }

  // Target resolved by (player_id, guild_code) like the RPC; the whole roster witnesses name uniqueness.
  const { data: rosterRows, error: targetError } = await guildRosterQuery(
    service,
    invite.guild_code,
    'player_id, display_name, original_display_name, has_duplicate_name, user_id, updated_at, protected'
  )

  if (targetError) {
    logger.error({ dbError: targetError.message }, 'Target roster read failed')
    return rejection('AUTHORITY_LOOKUP_FAILED')
  }

  const roster = (rosterRows ?? []) as TargetRosterRow[]
  const target =
    roster.find((row) => row.player_id === invite.player_id) ?? null
  if (!target) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'TARGET_NOT_ON_ROSTER',
      guildCode: invite.guild_code,
      targetPlayerId: invite.player_id
    })
    return rejection('TARGET_NOT_ON_ROSTER')
  }

  // The sync clock stays fresh when a roster refresh fails, so the roster rows must be recent too.
  if (isRosterWitnessStale(roster)) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'GUILD_SYNC_STALE',
      guildCode: invite.guild_code,
      targetPlayerId: invite.player_id
    })
    return rejection('GUILD_SYNC_STALE')
  }

  // Recounted from live rows, since a sync can reset `has_duplicate_name`.
  const targetRawName = rawRosterName(target)
  const sameNameCount = roster.filter(
    (row) => rawRosterName(row) === targetRawName
  ).length
  if (target.has_duplicate_name === true || sameNameCount !== 1) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'NAME_NOT_UNIQUE',
      guildCode: invite.guild_code,
      targetPlayerId: invite.player_id
    })
    return rejection('NAME_NOT_UNIQUE')
  }

  const player = await tacticusAPI.getPlayer(apiKey)
  if (!player) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'PLAYER_SCOPE_REQUIRED',
      guildCode: invite.guild_code,
      targetPlayerId: invite.player_id
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
      guildCode: invite.guild_code,
      targetPlayerId: invite.player_id
    })
    return rejection('PLAYER_LOOKUP_FAILED')
  }

  // Case-sensitive to match the uniqueness gate; casefolding would admit same-guild case variants.
  if (targetRawName !== keyPlayerName.trim()) {
    await auditRejection({
      service,
      request,
      userId: user.id,
      code: 'POSSESSION_NAME_MISMATCH',
      guildCode: invite.guild_code,
      targetPlayerId: invite.player_id,
      keyPlayerName
    })
    return rejection('POSSESSION_NAME_MISMATCH')
  }

  // H3 only when the key could read /guild (else the synced roster stood in).
  if (authority.ok) {
    const members = Array.isArray(authority.upstreamGuild?.members)
      ? authority.upstreamGuild.members
      : []
    const memberHits = members.filter(
      (member) => member.userId === invite.player_id
    ).length
    if (memberHits !== 1) {
      await auditRejection({
        service,
        request,
        userId: user.id,
        code: 'TARGET_NOT_IN_KEY_GUILD',
        guildCode: invite.guild_code,
        targetPlayerId: invite.player_id,
        keyPlayerName
      })
      return rejection('TARGET_NOT_IN_KEY_GUILD')
    }
  }

  // Session client: a service p_user_id would be an on-behalf-of bypass. The RPC re-checks the rest.
  const { data: claimData, error: claimError } = await supabase.rpc(
    'validate_and_use_invite_code',
    { p_code: code, p_user_id: user.id }
  )

  if (claimError) {
    logger.error(
      { userId: user.id, dbError: claimError.message },
      'Invite claim RPC failed after a successful possession witness'
    )
    return rejection('AUTHORITY_LOOKUP_FAILED')
  }

  const result = claimData as {
    success?: boolean
    error?: string
    error_code?: string
  } | null

  if (!result?.success) {
    // RPC messages are hand-authored and user-facing.
    return NextResponse.json(
      {
        error: {
          code: result?.error_code ?? 'CLAIM_REJECTED',
          message: result?.error ?? 'Failed to claim profile'
        }
      },
      { status: 409 }
    )
  }

  logger.info(
    { userId: user.id, guildCode: invite.guild_code },
    'Consumed an invite after a server-verified target possession proof'
  )

  return NextResponse.json({
    success: true,
    playerName: keyPlayerName,
    guildCode: invite.guild_code
  })
})
