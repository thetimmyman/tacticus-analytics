import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { decryptApiKey } from '@tacticus/app-core/encryption'
import {
  TACTICUS_CIRCUIT_NAME,
  tacticusAPI,
  type TacticusGuild
} from '@/app/lib/api/tacticus-client'
import { circuitRegistry } from '@/app/lib/resilience'
import { createComponentLogger } from '@/app/lib/logging'
import { safeEqual } from '@/app/lib/auth/require-header-secret'

const logger = createComponentLogger('lib.onboarding.guild-authority')

// Authority to spend a guild's stored credential comes only from client-unauthorable state:
// the key's upstream guild, else a CURRENT leader/officer seat. `onboarding_progress` is never read.

/** An open breaker makes getGuild return null without calling Tacticus; that is not a missing scope. */
export function tacticusUpstreamHealthy(): boolean {
  const state = circuitRegistry.getState(TACTICUS_CIRCUIT_NAME)
  return state === null || state === 'CLOSED'
}

export type GuildAuthoritySource = 'api_key' | 'roster_seat'

/** How standing was proven. roster_seat: a CURRENT leader/officer row in the key-resolved guild.
 * registered_credential: the key IS the stored credential (grants nothing new), so a freshly
 * registered leader with no seat until the first sync avoids a deadlock. */
export type GuildAuthorityElevation = 'roster_seat' | 'registered_credential'

export type GuildAuthorityFailureCode =
  | 'GUILD_ATTESTATION_REQUIRED'
  | 'GUILD_SCOPE_REQUIRED'
  | 'GUILD_NOT_REGISTERED'
  | 'GUILD_ELEVATION_REQUIRED'
  | 'TACTICUS_UNAVAILABLE'
  | 'AUTHORITY_LOOKUP_FAILED'

interface FailureShape {
  status: number
  message: string
}

export const GUILD_AUTHORITY_FAILURES: Record<
  GuildAuthorityFailureCode,
  FailureShape
> = {
  GUILD_ATTESTATION_REQUIRED: {
    status: 409,
    message:
      'Enter your guild API key to start the sync. We confirm guild ownership with Tacticus for every sync rather than trusting the browser.'
  },
  GUILD_SCOPE_REQUIRED: {
    status: 400,
    message:
      'That API key was not accepted for guild access. Confirm it has Guild read access at api.tacticusgame.com, or try again shortly if Tacticus is having trouble.'
  },
  GUILD_NOT_REGISTERED: {
    status: 404,
    message:
      'That API key belongs to a guild that is not registered here yet. Register the guild first, then run the sync.'
  },
  // 403, NOT 409: the dashboard re-asks for a key on 409, and the key is fine.
  GUILD_ELEVATION_REQUIRED: {
    status: 403,
    message:
      'That API key confirms which guild it belongs to, but not that you lead it. Ask a guild leader or officer to run the first sync, or claim your leader profile first.'
  },
  TACTICUS_UNAVAILABLE: {
    status: 503,
    message:
      'Tacticus is not answering right now. Please try again in a few minutes.'
  },
  AUTHORITY_LOOKUP_FAILED: {
    status: 503,
    message: 'Unable to resolve the guild for that API key. Please try again.'
  }
}

export interface GuildAuthorityGrant {
  ok: true
  guildCode: string
  guildId: string | null
  source: GuildAuthoritySource
  elevation: GuildAuthorityElevation | null
  upstreamGuild: TacticusGuild | null
}

export interface GuildAuthorityDenial {
  ok: false
  code: GuildAuthorityFailureCode
  status: number
  message: string
}

export type GuildAuthority = GuildAuthorityGrant | GuildAuthorityDenial

function deny(code: GuildAuthorityFailureCode): GuildAuthorityDenial {
  const shape = GUILD_AUTHORITY_FAILURES[code]
  return { ok: false, code, status: shape.status, message: shape.message }
}

const AUTHORITY_ROLES = new Set(['leader', 'officer'])

/** Names the guild only; the invite-claim corridor also uses its member list. */
export async function resolveGuildFromApiKey(
  service: TypedSupabaseClient,
  apiKey: string
): Promise<GuildAuthority> {
  const upstreamGuild = await tacticusAPI.getGuild(apiKey)
  if (!upstreamGuild?.guildId) {
    // Null means no scope OR an outage; never blame the key for an outage.
    return deny(
      tacticusUpstreamHealthy()
        ? 'GUILD_SCOPE_REQUIRED'
        : 'TACTICUS_UNAVAILABLE'
    )
  }

  const { data, error } = await service
    .from('guild_config')
    .select('guild_code')
    .eq('guild_id', upstreamGuild.guildId)
    .maybeSingle()

  if (error) {
    logger.error(
      { dbError: error.message },
      'Guild authority lookup failed while mapping an upstream guild id'
    )
    return deny('AUTHORITY_LOOKUP_FAILED')
  }

  const guildCode = (data as { guild_code?: string | null } | null)?.guild_code
  if (!guildCode) return deny('GUILD_NOT_REGISTERED')

  return {
    ok: true,
    guildCode,
    guildId: upstreamGuild.guildId,
    source: 'api_key',
    // Proves no standing: callers needing it use resolveAuthorizedGuildCode.
    elevation: null,
    upstreamGuild
  }
}

async function holdsElevatedSeatIn(
  service: TypedSupabaseClient,
  userId: string,
  guildCode: string
): Promise<{ ok: true; elevated: boolean } | { ok: false }> {
  const { data, error } = await guildRosterQuery(service, guildCode, 'role').eq(
    'user_id',
    userId
  )

  if (error) {
    // A failed read must not look like "not a leader".
    logger.error(
      { dbError: error.message },
      'Guild authority lookup failed while checking for an elevated seat'
    )
    return { ok: false }
  }

  const rows = (data ?? []) as Array<{ role?: string | null }>
  return {
    ok: true,
    elevated: rows.some((row) =>
      AUTHORITY_ROLES.has((row.role ?? '').toLowerCase())
    )
  }
}

/** Constant-time compare; defence in depth, not the load-bearing control. */
function secretsMatch(a: string, b: string): boolean {
  return safeEqual(a, b)
}

/** Same column the job runner decrypts, so a match hands over nothing new. */
async function keyIsRegisteredCredentialOf(
  service: TypedSupabaseClient,
  guildCode: string,
  submittedKey: string
): Promise<{ ok: true; matches: boolean } | { ok: false }> {
  const { data, error } = await service
    .from('guild_config')
    .select('api_key_encrypted')
    .eq('guild_code', guildCode)
    .maybeSingle()

  if (error) {
    logger.error(
      { dbError: error.message },
      'Guild authority lookup failed while reading the registered credential'
    )
    return { ok: false }
  }

  const stored = (data as { api_key_encrypted?: string | null } | null)
    ?.api_key_encrypted
  if (!stored) return { ok: true, matches: false }

  let plaintext: string
  try {
    plaintext = await decryptApiKey(stored)
  } catch (error) {
    logger.error(
      { err: error, guildCode },
      'Guild authority could not decrypt the registered credential'
    )
    return { ok: false }
  }

  // Stored keys are not re-trimmed on write; a stray byte must not refuse.
  return { ok: true, matches: secretsMatch(plaintext.trim(), submittedKey) }
}

/** Null for zero seats or several (refused, not guessed). */
async function resolveGuildFromRosterSeat(
  service: TypedSupabaseClient,
  userId: string
): Promise<{ ok: true; guildCode: string | null } | { ok: false }> {
  const { data, error } = await service
    .from('player_mapping')
    .select('guild_code, role')
    .eq('user_id', userId)
    .eq('is_current', true)

  if (error) {
    logger.error(
      { dbError: error.message },
      'Guild authority lookup failed while reading the roster seat'
    )
    return { ok: false }
  }

  const rows = (data ?? []) as Array<{
    guild_code?: string | null
    role?: string | null
  }>
  const codes = new Set(
    rows
      .filter((row) => AUTHORITY_ROLES.has((row.role ?? '').toLowerCase()))
      .map((row) => row.guild_code)
      .filter((code): code is string => typeof code === 'string' && code !== '')
  )

  return {
    ok: true,
    guildCode: codes.size === 1 ? ([...codes][0] ?? null) : null
  }
}

/** Never derived from a client-writable column. */
export async function resolveAuthorizedGuildCode({
  service,
  userId,
  apiKey
}: {
  service: TypedSupabaseClient
  userId: string
  apiKey?: string | null
}): Promise<GuildAuthority> {
  const submittedKey = typeof apiKey === 'string' ? apiKey.trim() : ''

  // Any member can mint a key, so the key only names the guild.
  if (submittedKey) {
    const named = await resolveGuildFromApiKey(service, submittedKey)
    if (!named.ok) return named

    const seat = await holdsElevatedSeatIn(service, userId, named.guildCode)
    if (!seat.ok) return deny('AUTHORITY_LOOKUP_FAILED')
    if (seat.elevated) {
      return { ...named, elevation: 'roster_seat' }
    }

    const custody = await keyIsRegisteredCredentialOf(
      service,
      named.guildCode,
      submittedKey
    )
    if (!custody.ok) return deny('AUTHORITY_LOOKUP_FAILED')
    if (custody.matches) {
      return { ...named, elevation: 'registered_credential' }
    }

    return deny('GUILD_ELEVATION_REQUIRED')
  }

  const seat = await resolveGuildFromRosterSeat(service, userId)
  if (!seat.ok) return deny('AUTHORITY_LOOKUP_FAILED')
  if (seat.guildCode) {
    return {
      ok: true,
      guildCode: seat.guildCode,
      guildId: null,
      source: 'roster_seat',
      elevation: 'roster_seat',
      upstreamGuild: null
    }
  }

  return deny('GUILD_ATTESTATION_REQUIRED')
}
