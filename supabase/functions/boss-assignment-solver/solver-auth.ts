import { requireServiceRole } from '../_shared/auth-guard.ts'
import { createServiceClient } from '../_shared/supabase-client.ts'
import { errorResponse } from '../_shared/response-helpers.ts'
import { guildCodesEqual } from '../_shared/guild-code.ts'
import { logger } from '../_shared/logger.ts'

type AuthDependencies = {
  createClient?: () => any
}

type SolverMembership = {
  guild_code: string | null
  player_id: string | null
  discord_user_id: string | null
}

const normalizeBanValue = (value: unknown): string =>
  typeof value === 'string' ? value.trim().toLowerCase() : ''

const discordIdentityId = (caller: any): string => {
  const identity = Array.isArray(caller?.identities)
    ? caller.identities.find((item: any) => item?.provider === 'discord')
    : null
  const data = identity?.identity_data
  return normalizeBanValue(
    data?.provider_id ?? data?.sub ?? data?.id ?? identity?.identity_id
  )
}

async function checkEffectiveBan(
  svc: any,
  caller: any,
  membership: SolverMembership
): Promise<{ banned: boolean; error: unknown | null }> {
  const nowIso = new Date().toISOString()
  const baseQuery = () =>
    svc
      .from('user_bans')
      .select('id')
      .is('lifted_at', null)
      .or(`expires_at.is.null,expires_at.gt.${nowIso}`)

  const direct = await baseQuery().eq('auth_user_id', caller.id).limit(1)
  if (direct.error) return { banned: false, error: direct.error }
  if (direct.data?.length) return { banned: true, error: null }

  const subjects = [
    ['user_id', caller.id],
    ['email', caller.email],
    ['discord_user_id', membership.discord_user_id],
    ['discord_user_id', discordIdentityId(caller)],
    ['player_id', membership.player_id]
  ]

  const seen = new Set<string>()
  for (const [subjectType, rawValue] of subjects) {
    const subjectValue = normalizeBanValue(rawValue)
    const key = `${subjectType}:${subjectValue}`
    if (!subjectValue || seen.has(key)) continue
    seen.add(key)

    const result = await baseQuery()
      .eq('subject_type', subjectType)
      .eq('subject_value', subjectValue)
      .limit(1)
    if (result.error) return { banned: false, error: result.error }
    if (result.data?.length) return { banned: true, error: null }
  }

  return { banned: false, error: null }
}

export async function authorizeSolverGuildRequest(
  req: Request,
  guildCode: string,
  dependencies: AuthDependencies = {}
): Promise<Response | null> {
  if (requireServiceRole(req) === null) return null

  const authHeader = req.headers.get('authorization') ?? ''
  const jwt = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : ''
  if (!jwt) return errorResponse('Authentication required', 401)

  const svc = (dependencies.createClient ?? createServiceClient)()
  const {
    data: { user: caller },
    error: getUserError
  } = await svc.auth.getUser(jwt)
  if (!caller) {
    if (getUserError) {
      logger.warn('Guild isolation could not resolve the caller token', {
        error: getUserError.message
      })
    }
    return errorResponse('Authentication required', 401)
  }

  const { data: membership, error: membershipError } = await svc
    .from('player_mapping')
    .select('guild_code,player_id,discord_user_id')
    .eq('user_id', caller.id)
    .eq('is_current', true)
    .single()

  if (
    membershipError ||
    !membership ||
    !guildCodesEqual(membership.guild_code, guildCode)
  ) {
    return errorResponse('You do not have access to this guild', 403)
  }

  const ban = await checkEffectiveBan(svc, caller, membership)
  if (ban.error) {
    logger.error('Solver ban verification failed closed', {
      userId: caller.id,
      error: ban.error
    })
    return errorResponse('Unable to verify account access', 503)
  }
  if (ban.banned) return errorResponse('Account suspended', 403)

  return null
}
