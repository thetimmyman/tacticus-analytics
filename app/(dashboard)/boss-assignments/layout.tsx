import { ReleaseStageBadge } from '@/app/components/release/ReleaseStageBadge'
import {
  getFeatureReleaseStage,
  checkFeatureAccess
} from '@/app/lib/services/feature-release-service'
import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { BossAssignmentsSubnav } from '@/app/(dashboard)/boss-assignments/_components/BossAssignmentsSubnav'
import { isOfficerLeaderOrAdminRole } from '@/app/lib/auth/role-predicates'

export default async function BossAssignmentsLayout({
  children
}: {
  children: React.ReactNode
}) {
  // The auth call is React-cached, so this adds no round-trip.
  const { user, profile, canEdit } = await requireBossAssignmentsAccess()
  const [stage, seasonAccess] = await Promise.all([
    getFeatureReleaseStage('boss_assignments'),
    checkFeatureAccess(user.id, 'boss_assignment_season_planner')
  ])
  const canUseSeasonPlanner =
    canEdit && isOfficerLeaderOrAdminRole(profile.role)

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-3">
          <h1 className="text-3xl font-bold text-primary-wh40k">
            Boss Assignments
          </h1>
          {stage && stage !== 'public' && (
            <ReleaseStageBadge stage={stage} size="md" />
          )}
        </div>
        <p className="text-secondary-wh40k mt-2">
          Boss target planning, token capacity, and assignment queues for guild
          officers
        </p>
      </div>

      <BossAssignmentsSubnav
        hasSeasonAccess={canUseSeasonPlanner && seasonAccess.has_access}
      />

      <div>{children}</div>
    </div>
  )
}
