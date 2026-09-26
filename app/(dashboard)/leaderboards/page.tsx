import dynamicImport from 'next/dynamic'
import { requireAuth } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { redirect } from 'next/navigation'
import { getClusterInfoFromProfile } from '@/app/lib/utils/cluster'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger('leaderboards.page')

const ClusterStatsClient = dynamicImport(() => import('./ClusterStatsClient'), {
  loading: () => (
    <div className="p-6 text-[var(--text-secondary)]">
      Loading leaderboards...
    </div>
  )
})

export async function generateMetadata() {
  try {
    const { profile } = await requireAuth()
    const clusterInfo = await getClusterInfoFromProfile({
      guild_code: profile.guild_code ?? undefined
    })

    if (!profile.cluster_code) {
      return {
        title: 'Leaderboards | Guild Stats',
        description: 'Guild leaderboards and analytics'
      }
    }

    return {
      title: `Leaderboards | ${clusterInfo.display_name}`,
      description: `Cross-guild leaderboards and analytics for the ${clusterInfo.display_name} cluster`
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to build cluster stats metadata:')
    return {
      title: 'Leaderboards | Tacticus Analytics',
      description: 'Cross-guild leaderboards and analytics'
    }
  }
}

interface PageProps {
  searchParams: Promise<{ season?: string }>
}

export default async function ClusterStatsPage({ searchParams }: PageProps) {
  const { profile } = await requireAuth()

  const supabase = await db()

  if (!profile.user_id) {
    redirect('/dashboard')
  }

  const params = await searchParams

  // Only the latest season: cluster pages moved to Guild Ops and Meta Analysis is global.
  const { data: latestSeason } = await supabase.rpc('get_cluster_latest_season')

  const defaultSeason = latestSeason || '81'
  const selectedSeason = params.season || defaultSeason

  return (
    <div className="space-y-6">
      <div className="border-b border-[var(--card-border)] pb-4">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">
          Leaderboards
        </h1>
      </div>

      <ClusterStatsClient profile={profile} latestSeason={selectedSeason} />
    </div>
  )
}
