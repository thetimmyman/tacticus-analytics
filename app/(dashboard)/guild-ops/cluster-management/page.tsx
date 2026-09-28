import { requireActiveMembership } from '@/app/lib/auth'
import { isClusterLeaderRole } from '@/app/lib/auth/role-predicates'
import { getServerClusterContext } from '@/app/lib/auth/cached-auth'
import { db } from '@/app/lib/db'
import { redirect } from 'next/navigation'
import ClusterManagement from '@/app/(dashboard)/leaderboards/components/ClusterManagement'

interface PageProps {
  searchParams: Promise<{ tab?: string }>
}

export const metadata = {
  title: 'Cluster Management | Guild Ops',
  description: 'Manage cluster membership, identity, and cross-guild webhooks.'
}

/** Cluster leaders only; callers without a cluster are redirected. */
export default async function ClusterManagementPage({
  searchParams
}: PageProps) {
  const { profile } = await requireActiveMembership()
  if (!isClusterLeaderRole(profile.role)) {
    redirect(
      `/unauthorized?required=leader&current=${profile.role ?? 'member'}`
    )
  }
  if (!profile.user_id) redirect('/dashboard')

  const clusterContext = await getServerClusterContext(profile.user_id)
  if (!clusterContext.clusterCode) redirect('/home')

  const supabase = await db()
  const { data: latestSeason } = await supabase.rpc('get_cluster_latest_season')
  const season = latestSeason || '81'

  const params = await searchParams

  return (
    <div className="space-y-6">
      <div className="border-b border-(--card-border) pb-4">
        <h1 className="text-3xl font-bold text-primary-wh40k">
          Cluster Management
        </h1>
      </div>

      <ClusterManagement
        season={season}
        userGuildCode={profile.guild_code ?? undefined}
        userRole={profile.role ?? undefined}
        clusterCode={clusterContext.clusterCode}
        initialTab={params.tab}
      />
    </div>
  )
}
