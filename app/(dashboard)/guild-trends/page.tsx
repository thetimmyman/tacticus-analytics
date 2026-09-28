import dynamicImport from 'next/dynamic'
import { requireAuth } from '@/app/lib/auth'
import { db } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { getLatestSeason } from '@/app/lib/utils/season'
import {
  getGuildTrendsCached,
  getGuildVsClusterBossCached
} from '@/app/lib/guild-trends/cached'
import { createComponentLogger } from '@/app/lib/logging'
import { createPageMetadata } from '@/app/lib/metadata'
import { EmptyState } from '@tacticus/ui-kit'
import type { GuildTrendsRow } from '@/app/lib/calculations/experimental/guild-trends'
import type { GuildVsClusterBossRow } from '@/app/lib/calculations/experimental/guild-vs-cluster'

const logger = createComponentLogger('app.guild-trends.page')

const GuildTrendsContainer = dynamicImport(
  () =>
    import('@/app/components/guild-trends/GuildTrendsContainer').then(
      (mod) => ({ default: mod.GuildTrendsContainer })
    ),
  {
    loading: () => (
      <div className="p-6 text-secondary-wh40k">Loading guild trends...</div>
    )
  }
)

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = createPageMetadata({
  title: 'Guild Trends',
  description:
    'Analyze guild raid trends, boss performance movement, and cluster comparisons across recent seasons.',
  path: '/guild-trends'
})

const TREND_SEASON_WINDOW = 10

function buildSeasonWindow(latestSeason: string): string[] {
  const latest = parseInt(latestSeason, 10)
  if (Number.isNaN(latest)) return []
  return Array.from({ length: TREND_SEASON_WINDOW }, (_, i) =>
    String(latest - i)
  )
}

export default async function GuildTrendsPage() {
  const [{ profile }, latestSeason] = await Promise.all([
    requireAuth(),
    getLatestSeason()
  ])

  const userGuildCode = profile?.guild_code || ''

  // No latest season: trends are season-windowed, so show an unavailable state.
  if (latestSeason === null) {
    return (
      <div className="px-4 py-6">
        <EmptyState title="Season data unavailable">
          We couldn&apos;t determine the latest season right now. Please try
          again shortly.
        </EmptyState>
      </div>
    )
  }

  let clusterCode = ''
  if (userGuildCode) {
    const supabase = await db()
    const config = await GuildConfigService.getBasic(supabase, userGuildCode)
    clusterCode = config?.cluster_code || ''
  }

  // Server prefetch; closed seasons are cached in Redis.
  const seasons = buildSeasonWindow(latestSeason)
  let initialTrends: GuildTrendsRow[] | undefined
  let initialRadar: GuildVsClusterBossRow[] | undefined

  if (userGuildCode && seasons.length > 0) {
    const supabase = await db()
    const [trendsResult, radarResult] = await Promise.allSettled([
      getGuildTrendsCached(supabase, userGuildCode, seasons, latestSeason),
      clusterCode
        ? getGuildVsClusterBossCached(
            supabase,
            userGuildCode,
            latestSeason,
            latestSeason
          )
        : Promise.resolve([] as GuildVsClusterBossRow[])
    ])

    if (trendsResult.status === 'fulfilled') {
      initialTrends = trendsResult.value
    } else {
      logger.warn(
        { err: trendsResult.reason },
        'guild trends prefetch failed; client will refetch'
      )
    }
    if (radarResult.status === 'fulfilled') {
      initialRadar = radarResult.value
    } else {
      logger.warn(
        { err: radarResult.reason },
        'radar prefetch failed; client will refetch'
      )
    }
  }

  return (
    <GuildTrendsContainer
      userGuildCode={userGuildCode}
      clusterCode={clusterCode}
      latestSeason={latestSeason}
      initialTrends={initialTrends}
      initialRadar={initialRadar}
    />
  )
}
