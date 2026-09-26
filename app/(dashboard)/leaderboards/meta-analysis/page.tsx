import { requireAuth } from '@/app/lib/auth'
import MetaAnalysisClient from './MetaAnalysisClient'
import { getLatestSeason } from '@/app/lib/utils/season'
import { getServerClusterContext } from '@/app/lib/auth/cached-auth'
import { EmptyState } from '@tacticus/ui-kit'
import { redirect } from 'next/navigation'
import { createPageMetadata } from '@/app/lib/metadata'

// "Global", not "Cluster": title, share card and SEO are scope claims for a global aggregate.
export const metadata = createPageMetadata({
  title: 'Global Meta Analysis',
  description:
    'Analyze consistent raid team compositions from global guild raid data.',
  path: '/leaderboards/meta-analysis'
})

export default async function MetaAnalysisPage() {
  const { profile } = await requireAuth()

  if (!profile.user_id) {
    redirect('/dashboard')
  }

  const clusterContext = await getServerClusterContext(profile.user_id)

  if (!clusterContext.clusterCode) {
    redirect('/dashboard')
  }

  const latestSeason = await getLatestSeason()

  return (
    <div className="space-y-6">
      <div>
        <h1 className="heading-wh40k">Meta Analysis</h1>
        <p className="subheading-wh40k">
          Analyze the most consistent team compositions across all guilds
        </p>
      </div>

      {latestSeason ? (
        <MetaAnalysisClient initialSeason={latestSeason} />
      ) : (
        <EmptyState title="Season data unavailable">
          We couldn&apos;t determine the latest season right now. Please try
          again shortly.
        </EmptyState>
      )}
    </div>
  )
}
