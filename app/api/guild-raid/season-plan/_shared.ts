import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { db } from '@/app/lib/db'
import { Errors } from '@/app/lib/errors/AppError'
import {
  requireSessionUser,
  resolveCurrentMembership
} from '@/app/lib/api/session-user'
import { isOfficerLeaderOrAdminRole } from '@/app/lib/auth/role-predicates'
import { parseSeasonParam } from '@/app/lib/boss-assignments/target-token-season'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { getLatestSeason } from '@/app/lib/utils/season'

type SeasonPlanProfile = {
  guild_code: string
  role: string | null
  is_app_admin: boolean | null
}

function isSeasonPlanOfficerRole(role: string | null | undefined): boolean {
  return isOfficerLeaderOrAdminRole(role)
}

async function requireSeasonPlannerFeatures(
  userId: string,
  client?: TypedSupabaseClient
): Promise<void> {
  const [bossAssignmentsAccess, seasonPlannerAccess] = await Promise.all([
    checkFeatureAccess(
      userId,
      'boss_assignments',
      ...(client ? ([client] as const) : [])
    ),
    checkFeatureAccess(
      userId,
      'boss_assignment_season_planner',
      ...(client ? ([client] as const) : [])
    )
  ])

  if (!bossAssignmentsAccess.has_access) {
    throw Errors.fromResponse(403, {
      error: 'Boss assignments access required'
    })
  }

  if (!seasonPlannerAccess.has_access) {
    throw Errors.fromResponse(403, { error: 'Season planner access required' })
  }
}

export async function requireSeasonPlanOfficerContext(
  options: {
    requireFeatureAccess?: boolean
    allowAppAdmin?: boolean
    allowMemberRead?: boolean
  } = {}
) {
  const supabase = await db()

  const user = await requireSessionUser(supabase, () =>
    Errors.fromResponse(401, { error: 'Authentication required' })
  )

  if (options.requireFeatureAccess) {
    await requireSeasonPlannerFeatures(
      user.id,
      getRuntimeProfile() === 'desktop' ? supabase : undefined
    )
  }

  const desktop = getRuntimeProfile() === 'desktop'
  const profile = desktop
    ? (
        await supabase
          .from('player_mapping')
          .select('player_id, guild_code, role, is_app_admin')
          .eq('user_id', user.id)
          .eq('is_current', true)
          .eq('is_active', true)
          .single()
      ).data
    : await resolveCurrentMembership(supabase, user.id)

  if (!profile?.guild_code) {
    throw Errors.fromResponse(403, {
      error: 'Profile not found or access denied'
    })
  }

  const canUseAppAdmin =
    options.allowAppAdmin === true && profile.is_app_admin === true

  const canRead =
    desktop &&
    options.allowMemberRead === true &&
    ['member', 'officer', 'leader'].includes((profile.role ?? '').toLowerCase())
  const canWrite = desktop
    ? canManageHeraldRole(profile.role)
    : isSeasonPlanOfficerRole(profile.role) || canUseAppAdmin
  if (!canRead && !canWrite) {
    throw Errors.fromResponse(403, { error: 'Insufficient permissions' })
  }

  const currentProfile: SeasonPlanProfile = {
    guild_code: profile.guild_code,
    role: profile.role ?? null,
    is_app_admin: profile.is_app_admin ?? null
  }

  return { supabase, user, profile: currentProfile }
}

export async function requireSeasonPlanReadContext() {
  return requireSeasonPlanOfficerContext({
    requireFeatureAccess: getRuntimeProfile() === 'desktop',
    allowMemberRead: true
  })
}

export async function resolveSeasonPlanSeason(
  rawSeason: string | null,
  client?: TypedSupabaseClient,
  guild?: string
): Promise<string> {
  let savedSeasons: string[] | null = null
  if (getRuntimeProfile() === 'desktop') {
    if (!client || !guild)
      throw Errors.fromResponse(503, {
        error: 'Saved season context unavailable'
      })
    const { data, error } = await client.rpc('get_distinct_seasons_for_guild', {
      p_guild: guild
    })
    if (error || !Array.isArray(data))
      throw Errors.fromResponse(503, { error: 'Saved seasons unavailable' })
    savedSeasons = data.filter(
      (value): value is string =>
        typeof value === 'string' && parseSeasonParam(value) !== null
    )
  }
  const season =
    rawSeason ||
    (savedSeasons
      ? savedSeasons.sort((a, b) => Number(b) - Number(a))[0]
      : await getLatestSeason())

  if (!season) {
    throw Errors.fromResponse(503, { error: 'Season data unavailable' })
  }

  const parsedSeason = parseSeasonParam(season)
  if (!parsedSeason) {
    throw Errors.fromResponse(400, { error: 'Invalid season number' })
  }

  if (savedSeasons && !savedSeasons.includes(parsedSeason))
    throw Errors.fromResponse(404, {
      error: 'Import saved raid data for the selected season before planning.'
    })
  return parsedSeason
}

export const toPositiveInt = (
  value: string | null,
  fallback: number
): number => {
  const parsed = value ? Number.parseInt(value, 10) : NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

export const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.trunc(value)))

export function validateDesktopPlanningParameters(
  params: URLSearchParams
): void {
  if (getRuntimeProfile() !== 'desktop') return
  const allowed = new Set([
    'season',
    'snapshot_at',
    'config_id',
    'lookback_days',
    'sessions_per_day',
    'time_zone'
  ])
  for (const key of params.keys())
    if (!allowed.has(key) || params.getAll(key).length !== 1)
      throw Errors.fromResponse(400, {
        error: 'Unsupported planning parameter'
      })
  for (const [key, max] of [
    ['lookback_days', 180],
    ['sessions_per_day', 3]
  ] as const) {
    const raw = params.get(key)
    if (raw !== null && (!/^[1-9]\d*$/.test(raw) || Number(raw) > max))
      throw Errors.fromResponse(400, { error: `Invalid ${key}` })
  }
  const at = params.get('snapshot_at')
  if (
    at !== null &&
    (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(at) ||
      !Number.isFinite(Date.parse(at)))
  )
    throw Errors.fromResponse(400, { error: 'Invalid snapshot_at' })
  const zone = params.get('time_zone')
  if (zone !== null) {
    try {
      if (zone.length > 128 || !zone) throw new Error()
      new Intl.DateTimeFormat('en', { timeZone: zone })
    } catch {
      throw Errors.fromResponse(400, { error: 'Invalid time_zone' })
    }
  }
}
