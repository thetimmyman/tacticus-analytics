import dynamicImport from 'next/dynamic'
import { redirect } from 'next/navigation'
import { requireAuth } from '@/app/lib/auth'
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
      <div className="p-6 text-[var(--text-secondary)]">
        Loading player statistics...
      </div>
    )
  }
)

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = createPageMetadata({
  title: 'Player Stats',
  description:
    'Review your Tacticus raid damage, boss performance, roster signals, and season-by-season player trends.',
  path: '/player-stats'
})

interface PageProps {
  searchParams: Promise<{
    season?: string
    player?: string
    search?: string
    guild?: string
  }>
}

export default async function PlayerStatsRoute({ searchParams }: PageProps) {
  const [{ profile }, params, latestSeason, supabase] = await Promise.all([
    requireAuth(),
    searchParams,
    getLatestSeason(),
    db()
  ])

  // Locked to the signed-in user; officer deep-links redirect to Guild Ops > Player Lookup.
  const lookupTarget =
    params.player?.trim() || params.search?.trim() || params.guild?.trim()
  const role = profile?.role ?? 'member'
  if (lookupTarget && (role === 'officer' || role === 'leader')) {
    const forwarded = new URLSearchParams()
    if (params.season?.trim()) forwarded.set('season', params.season.trim())
    if (params.player?.trim()) forwarded.set('player', params.player.trim())
    if (params.search?.trim()) forwarded.set('search', params.search.trim())
    if (params.guild?.trim()) forwarded.set('guild', params.guild.trim())
    const qs = forwarded.toString()
    redirect(`/guild-ops/player-lookup${qs ? `?${qs}` : ''}`)
  }

  const seasonFromParams = params.season?.trim()
  // No URL or latest season: explicit unavailable state, not a stale hardcoded season.
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

    // URL guild codes must be in the user's cluster so the dropdown never loads cross-cluster players.
    if (initialGuildCode && initialGuildCode !== userGuild) {
      if (canValidateInParallel) {
        if (!guildCheckResult?.data) initialGuildCode = undefined
      } else if (clusterCode) {
        // cluster_code missing from profile: sequential fallback via guild_config.
        const { data: guildCheck } = await supabase
          .from('guild_config')
          .select('guild_code')
          .eq('guild_code', initialGuildCode)
          .eq('cluster_code', clusterCode)
          .maybeSingle()
        if (!guildCheck) initialGuildCode = undefined
      } else {
        // No cluster: own guild only.
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
      />
    </div>
  )
}
