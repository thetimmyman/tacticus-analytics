import dynamicImport from 'next/dynamic'
import { requireRole } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { getLatestSeason } from '@/app/lib/utils/season'
import { EmptyState } from '@tacticus/ui-kit'
import { createPageMetadata } from '@/app/lib/metadata'

const PlayerStatsPage = dynamicImport(
  () =>
    import('@/app/components/playerstats/PlayerStatsPage').then((mod) => ({
      default: mod.PlayerStatsPage
    })),
  {
    loading: () => (
      <div className="p-6 text-secondary-wh40k">Loading player lookup...</div>
    )
  }
)

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = createPageMetadata({
  title: 'Player Lookup',
  description:
    'Search guild and cluster player raid stats, roster records, and performance history.',
  path: '/guild-ops/player-lookup'
})

interface PageProps {
  searchParams: Promise<{
    season?: string
    player?: string
    search?: string
    guild?: string
  }>
}

export default async function PlayerLookupRoute({ searchParams }: PageProps) {
  const [{ profile }, params, latestSeason, supabase] = await Promise.all([
    requireRole('officer'),
    searchParams,
    getLatestSeason(),
    db()
  ])

  const seasonFromParams = params.season?.trim()
  // No URL or latest season: show an unavailable state, not a stale hardcoded season.
  const selectedSeason =
    seasonFromParams && seasonFromParams.length > 0
      ? seasonFromParams
      : latestSeason
  if (!selectedSeason) {
    return (
      <div className="px-4 py-6">
        <EmptyState title="Season data unavailable">
          We couldn&apos;t determine the latest season right now. Please try
          again shortly.
        </EmptyState>
      </div>
    )
  }

  let clusterCode = profile?.cluster_code || ''
  const userGuild = profile?.guild_code || ''
  const userDisplayName = profile?.display_name || ''
  let userGuildName = userGuild
  let initialGuildCode: string | undefined = params.guild?.trim() || undefined

  if (userGuild) {
    const profileClusterCode = profile?.cluster_code || ''
    const canValidateInParallel =
      !!initialGuildCode &&
      initialGuildCode !== userGuild &&
      !!profileClusterCode

    const [guildResult, guildCheckResult] = await Promise.all([
      supabase
        .from('guild_config')
        .select('display_name, cluster_code')
        .eq('guild_code', userGuild)
        .single(),
      canValidateInParallel
        ? supabase
            .from('guild_config')
            .select('guild_code')
            .eq('guild_code', initialGuildCode!)
            .eq('cluster_code', profileClusterCode)
            .maybeSingle()
        : Promise.resolve(null)
    ])

    if (guildResult.data?.display_name)
      userGuildName = guildResult.data.display_name
    if (!clusterCode && guildResult.data?.cluster_code)
      clusterCode = guildResult.data.cluster_code

    if (initialGuildCode && initialGuildCode !== userGuild) {
      if (canValidateInParallel) {
        if (!guildCheckResult?.data) initialGuildCode = undefined
      } else if (clusterCode) {
        const { data: guildCheck } = await supabase
          .from('guild_config')
          .select('guild_code')
          .eq('guild_code', initialGuildCode)
          .eq('cluster_code', clusterCode)
          .maybeSingle()
        if (!guildCheck) initialGuildCode = undefined
      } else {
        initialGuildCode = undefined
      }
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <PlayerStatsPage
        userRole={profile?.role || 'member'}
        userGuild={userGuild}
        userGuildName={userGuildName}
        userDisplayName={userDisplayName}
        clusterCode={clusterCode}
        selectedSeason={selectedSeason}
        initialPlayerName={params.player?.trim() || params.search?.trim()}
        initialGuildCode={initialGuildCode}
        enableSearch
      />
    </div>
  )
}
