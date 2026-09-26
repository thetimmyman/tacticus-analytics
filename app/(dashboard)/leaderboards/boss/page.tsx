import dynamicImport from 'next/dynamic'
import { requireAuth } from '@/app/lib/auth'
import { getLatestSeason } from '@/app/lib/data/get-latest-season'
import { createPageMetadata } from '@/app/lib/metadata'
import { redirect } from 'next/navigation'

export const metadata = createPageMetadata({
  title: 'Boss Leaderboards',
  description:
    'View boss-specific guild raid leaderboards, top performers, and current season rankings.',
  path: '/leaderboards/boss'
})

const BossLeaderboards = dynamicImport(
  () => import('@/app/(dashboard)/leaderboards/components/BossLeaderboards'),
  {
    loading: () => (
      <div className="p-6 text-[var(--text-secondary)]">
        Loading boss leaderboards...
      </div>
    )
  }
)

export default async function BossLeaderboardPage() {
  const user = await requireAuth()

  // Service-role helper: get_latest_season is SECURITY INVOKER, and under caller RLS its
  // "EOT_GR_data" scan is ~10s per render. The latest season is a global scalar.
  const rpcSeason = await getLatestSeason()
  const currentSeason = rpcSeason ? String(rpcSeason) : '83'
  const userGuild = user.profile.guild_code
  if (!userGuild) redirect('/dashboard')

  return (
    <div className="w-full">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-[var(--text-primary)]">
          Boss Leaderboards
        </h1>
        <p className="text-[var(--text-secondary)] mt-2">
          View top performers for each boss encounter
        </p>
      </div>

      <BossLeaderboards initialSeason={currentSeason} userGuild={userGuild} />
    </div>
  )
}
