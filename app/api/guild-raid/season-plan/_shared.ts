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

async function requireSeasonPlannerFeatures(userId: string): Promise<void> {
  const [bossAssignmentsAccess, seasonPlannerAccess] = await Promise.all([
    checkFeatureAccess(userId, 'boss_assignments'),
    checkFeatureAccess(userId, 'boss_assignment_season_planner')
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
  } = {}
) {
  const supabase = await db()

  const user = await requireSessionUser(supabase, () =>
    Errors.fromResponse(401, { error: 'Authentication required' })
  )

  if (options.requireFeatureAccess) {
    await requireSeasonPlannerFeatures(user.id)
  }

  const profile = await resolveCurrentMembership(supabase, user.id)

  if (!profile?.guild_code) {
    throw Errors.fromResponse(403, {
      error: 'Profile not found or access denied'
    })
  }

  const canUseAppAdmin =
    options.allowAppAdmin === true && profile.is_app_admin === true

  if (!isSeasonPlanOfficerRole(profile.role) && !canUseAppAdmin) {
    throw Errors.fromResponse(403, { error: 'Insufficient permissions' })
  }

  const currentProfile: SeasonPlanProfile = {
    guild_code: profile.guild_code,
    role: profile.role ?? null,
    is_app_admin: profile.is_app_admin ?? null
  }

  return { supabase, user, profile: currentProfile }
}

export async function resolveSeasonPlanSeason(
  rawSeason: string | null
): Promise<string> {
  const season = rawSeason || (await getLatestSeason())

  if (!season) {
    throw Errors.fromResponse(503, { error: 'Season data unavailable' })
  }

  const parsedSeason = parseSeasonParam(season)
  if (!parsedSeason) {
    throw Errors.fromResponse(400, { error: 'Invalid season number' })
  }

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
