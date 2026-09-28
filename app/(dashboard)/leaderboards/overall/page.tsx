import dynamicImport from 'next/dynamic'
import { requireAuth } from '@/app/lib/auth'
import { getLatestSeason } from '@/app/lib/data/get-latest-season'
import { createPageMetadata } from '@/app/lib/metadata'
import { redirect } from 'next/navigation'

export const metadata = createPageMetadata({
  title: 'Overall Leaderboard',
  description:
    'View overall guild raid player rankings, season standings, and all-boss performance totals.',
  path: '/leaderboards/overall'
})

const OverallLeaderboard = dynamicImport(
  () => import('@/app/(dashboard)/leaderboards/components/OverallLeaderboard'),
  {
    loading: () => (
      <div className="p-6 text-secondary-wh40k">Loading leaderboard...</div>
    )
  }
)

export default async function OverallLeaderboardPage() {
  const { profile } = await requireAuth()

  // Service-role helper: get_latest_season is SECURITY INVOKER, and under caller RLS its
  // "EOT_GR_data" scan is ~10s per render. The latest season is a global scalar.
  const rpcSeason = await getLatestSeason()
  const currentSeason = rpcSeason ? String(rpcSeason) : '83'
  const userGuild = profile.guild_code
  if (!userGuild) redirect('/dashboard')

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-primary-wh40k">
          Overall Leaderboard
        </h1>
        <p className="text-secondary-wh40k mt-2">
          View player rankings and performance across all battles
        </p>
      </div>

      <OverallLeaderboard season={currentSeason} userGuild={userGuild} />
    </div>
  )
}
