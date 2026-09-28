import { requireRole } from '@/app/lib/auth'
import { getServerClusterContext } from '@/app/lib/auth/cached-auth'
import { db } from '@/app/lib/db'
import { redirect } from 'next/navigation'
import LeaderAnalytics from '@/app/(dashboard)/leaderboards/components/LeaderAnalytics'
import ClusterBossMatrix from '@/app/(dashboard)/leaderboards/components/ClusterBossMatrix'

export const metadata = {
  title: 'Cluster Analytics | Guild Ops',
  description:
    'Cross-guild boss matrices and performance analytics for your cluster.'
}

/** Leaders in a cluster only; cluster-less leaders are sent home. */
export default async function ClusterAnalyticsPage() {
  const { profile } = await requireRole('leader')
  if (!profile.user_id) redirect('/dashboard')

  const clusterContext = await getServerClusterContext(profile.user_id)
  if (!clusterContext.clusterCode) redirect('/home')

  const supabase = await db()
  const { data: latestSeason } = await supabase.rpc('get_cluster_latest_season')
  const season = latestSeason || '81'

  return (
    <div className="space-y-6">
      <div className="border-b border-(--card-border) pb-4">
        <h1 className="text-3xl font-bold text-primary-wh40k">
          Cluster Analytics
        </h1>
      </div>

      <ClusterBossMatrix season={season} />
      <LeaderAnalytics season={season} />
    </div>
  )
}
