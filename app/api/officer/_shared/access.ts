import { requireAuthForApi } from '@/app/lib/auth'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { Errors } from '@/app/lib/errors/AppError'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'

export async function requireActiveOfficerCommandAccess() {
  const { user, profile } = await requireAuthForApi()

  if (user.membershipStatus !== 'active' || profile.is_current !== true) {
    throw Errors.fromResponse(403, {
      error: 'Active guild officer membership required'
    })
  }

  if (!canManageHeraldRole(profile.role)) {
    throw Errors.fromResponse(403, {
      error: 'Active guild officer role required'
    })
  }

  const guildCode = profile.guild_code
  if (!guildCode) {
    throw Errors.fromResponse(400, { error: 'No guild on profile' })
  }

  const access = await checkFeatureAccess(user.id, 'officer_command_center')
  if (!access.has_access) {
    throw Errors.fromResponse(403, {
      error: 'Officer Command Center access required',
      stage: access.stage,
      reason: access.reason
    })
  }

  return { user, profile, guildCode }
}
