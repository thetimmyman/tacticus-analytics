import { requireBossAssignmentsAccess } from '@/app/(dashboard)/boss-assignments/_lib/access'
import { BossAssignments } from '@/app/(dashboard)/boss-assignments/BossAssignments'

// Per-request rendering so a `?season=` change re-runs the server component.
export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = {
  title: 'Current Season Assignments | Tacticus Analytics',
  description: 'Manage current season boss assignments and token allocation'
}

interface PageProps {
  searchParams: Promise<{ season?: string }>
}

// Season-planner access does not gate this route; the layout computes it for the sub-nav.
export default async function CurrentAssignmentsPage({
  searchParams
}: PageProps) {
  const { profile, canEdit } = await requireBossAssignmentsAccess()

  const params = await searchParams
  return (
    <BossAssignments
      profile={profile}
      mode="current"
      canEdit={canEdit}
      seasonOverride={params.season ?? null}
    />
  )
}
