import { redirect } from 'next/navigation'
import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { BossAssignments } from '@/app/(dashboard)/boss-assignments/BossAssignments'
import { checkFeatureAccess } from '@/app/lib/services/feature-release-service'
import { isOfficerLeaderOrAdminRole } from '@/app/lib/auth/role-predicates'

export const metadata = {
  title: 'Season Planner | Tacticus Analytics',
  description:
    'Plan the entire guild raid season using token regeneration, availability windows, and expected damage.'
}

export default async function SeasonPlannerPage() {
  const { profile, user, canEdit } = await requireBossAssignmentsAccess()

  const seasonAccess = await checkFeatureAccess(
    user.id,
    'boss_assignment_season_planner'
  )

  const canUseSeasonPlanner =
    canEdit && isOfficerLeaderOrAdminRole(profile.role)

  if (!canUseSeasonPlanner || !seasonAccess.has_access) {
    redirect('/boss-assignments/current')
  }

  return <BossAssignments profile={profile} mode="season" canEdit={canEdit} />
}
