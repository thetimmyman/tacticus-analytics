import dynamicImport from 'next/dynamic'
import { getLatestSeason } from '@/app/lib/utils/season'
import { isAlphaDeploymentEnvironment } from '@/app/lib/utils/deployment-environment'
import { resolveEffectiveSeason } from '@/app/lib/season-date/precedence'
import { requireAuth } from '@/app/lib/auth'
import { EmptyState } from '@tacticus/ui-kit'
import { Suspense } from 'react'
import { db } from '@/app/lib/db'
import { fetchSeasonForecast } from '@/app/lib/season-forecast/forecast-service'
import type { SeasonForecastEnvelope } from '@/app/lib/season-forecast/forecast-service'
import { computeSeasonOutlookWithTimeout } from '@/app/lib/season-forecast/season-outlook-projection'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'
import { mergeLapProjection } from '@/app/lib/season-forecast/lap-projection-display'
import { createPageMetadata } from '@/app/lib/metadata'

interface PageProps {
  searchParams: Promise<{ guild?: string; season?: string }>
}

const DashboardSummary = dynamicImport(
  () => import('@/app/components/DashboardSummary'),
  {
    // Do not block the shell on the largest client bundle.
    loading: () => (
      <div className="p-6 text-secondary-wh40k">
        Loading dashboard insights…
      </div>
    )
  }
)

export const dynamic = 'force-dynamic'
export const revalidate = 0

export const metadata = createPageMetadata({
  title: 'Raid Dashboard',
  description:
    'Analyze guild raid performance, current season progress, token usage, and boss damage trends.',
  path: '/dashboard'
})

export default async function DashboardPage({ searchParams }: PageProps) {
  const { profile } = await requireAuth()
  const params = await searchParams

  const selectedGuild = params.guild || profile.guild_code || ''
  const latestSeason = await getLatestSeason()
  const selectedSeason = resolveEffectiveSeason(params.season, latestSeason)

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

  const hasValidCluster = !!(
    profile.cluster_code && profile.cluster_code !== ''
  )
  const isAlpha = isAlphaDeploymentEnvironment()

  // Forecast envelope with the rotation outlook's finish merged onto lap_projection.
  let initialForecast: SeasonForecastEnvelope | null = null
  let initialOutlook: SeasonOutlookProjection | null = null
  if (isAlpha && selectedGuild && selectedSeason) {
    try {
      const supabase = await db()
      const seasonNumber = Number(selectedSeason)
      if (Number.isFinite(seasonNumber)) {
        const [envelope, outlook] = await Promise.all([
          fetchSeasonForecast(supabase, {
            guildCode: selectedGuild,
            seasonNumber,
            includePerPlayer: true,
            userId: profile.user_id ?? null,
            skipCache: false
          }),
          // Shared 7s race so a cache-miss sim cannot hang the page; current season only.
          selectedSeason === latestSeason
            ? computeSeasonOutlookWithTimeout({
                guildCode: selectedGuild,
                season: selectedSeason
              })
            : Promise.resolve(null)
        ])
        initialForecast = envelope
          ? {
              ...envelope,
              lap_projection:
                mergeLapProjection(envelope.lap_projection ?? null, outlook) ??
                undefined
            }
          : null
        initialOutlook = outlook
      }
    } catch {
      // Additive only: failure must not break the dashboard.
      initialForecast = null
      initialOutlook = null
    }
  }

  return (
    <Suspense
      fallback={
        <div className="p-6 text-secondary-wh40k">Preparing dashboard…</div>
      }
    >
      <DashboardSummary
        selectedGuild={selectedGuild}
        selectedSeason={selectedSeason}
        hasCluster={hasValidCluster}
        isAlpha={isAlpha}
        initialForecast={initialForecast}
        initialOutlook={initialOutlook}
      />
    </Suspense>
  )
}
