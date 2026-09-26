import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { BossAssignments } from '@/app/(dashboard)/boss-assignments/BossAssignments'

// Per-request rendering so a ?season= change re-runs the server component.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Token Performance | Tacticus Analytics',
  description:
    'Guild leaderboard of token performance against expected damage targets'
}

interface PageProps {
  searchParams: Promise<{ season?: string }>
}

export default async function PerformanceLeaderboardPage({
  searchParams
}: PageProps) {
  const { profile, canEdit } = await requireBossAssignmentsAccess()

  const params = await searchParams
  return (
    <BossAssignments
      profile={profile}
      mode="performance"
      canEdit={canEdit}
      seasonOverride={params.season ?? null}
    />
  )
}
