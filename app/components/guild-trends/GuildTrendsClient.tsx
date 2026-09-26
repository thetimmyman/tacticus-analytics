'use client'

import { useMemo } from 'react'
import {
  useGuildTrendsBatch,
  useGuildVsClusterBossPerformance
} from '@/app/lib/hooks/queries'
import type { GuildTrendsRow } from '@/app/lib/calculations/experimental/guild-trends'
import type { GuildVsClusterBossRow } from '@/app/lib/calculations/experimental/guild-vs-cluster'
import { GuildSeasonTable } from './GuildSeasonTable'
import { PlayerSeasonRankingHeatmap } from './PlayerSeasonRankingHeatmap'
import { GuildDamageTrendChart } from './GuildDamageTrendChart'
import { GuildTokenTrendChart } from './GuildTokenTrendChart'
import { GuildEfficiencyChart } from './GuildEfficiencyChart'
import { GuildVsClusterRadar } from './GuildVsClusterRadar'
import { GuildPerformanceTrendChart } from './GuildPerformanceTrendChart'
import { GuildReliabilityTrendChart } from './GuildReliabilityTrendChart'

interface GuildTrendsClientProps {
  guildCode: string
  clusterCode: string
  latestSeason: string
  initialTrends?: GuildTrendsRow[]
  initialRadar?: GuildVsClusterBossRow[]
}

export function GuildTrendsClient({
  guildCode,
  clusterCode,
  latestSeason,
  initialTrends,
  initialRadar
}: GuildTrendsClientProps) {
  const seasons = useMemo(() => {
    const latest = parseInt(latestSeason, 10)
    if (isNaN(latest)) return []
    return Array.from({ length: 10 }, (_, i) => String(latest - i))
  }, [latestSeason])

  const {
    data: trendsData,
    isLoading,
    error
  } = useGuildTrendsBatch(guildCode, seasons, {
    enabled: !!guildCode && seasons.length > 0,
    initialData: initialTrends
  })

  const hasCluster = !!clusterCode
  const { data: radarData } = useGuildVsClusterBossPerformance(
    guildCode,
    latestSeason,
    {
      enabled: hasCluster && !!guildCode && !!latestSeason,
      initialData: initialRadar
    }
  )

  const chronologicalData = useMemo(() => {
    if (!trendsData) return []
    return [...trendsData].sort(
      (a, b) => parseInt(a.season, 10) - parseInt(b.season, 10)
    )
  }, [trendsData])

  if (!guildCode) {
    return (
      <div className="p-6 text-center">
        <h1 className="heading-wh40k text-2xl mb-4">
          Guild Performance Trends
        </h1>
        <p className="text-[var(--text-secondary)]">
          You must be a member of a guild to view guild trends.
        </p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="heading-wh40k text-2xl">Guild Performance Trends</h1>
        <div className="animate-pulse space-y-4">
          <div className="h-64 bg-[var(--card-bg)] rounded-lg" />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="h-80 bg-[var(--card-bg)] rounded-lg" />
            <div className="h-80 bg-[var(--card-bg)] rounded-lg" />
          </div>
        </div>
      </div>
    )
  }

  if (error || !chronologicalData.length) {
    return (
      <div className="p-6 text-center">
        <h1 className="heading-wh40k text-2xl mb-4">
          Guild Performance Trends
        </h1>
        <p className="text-[var(--text-secondary)]">
          No trend data available. Guild performance data will appear here once
          battle data is recorded across multiple seasons.
        </p>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="heading-wh40k text-2xl">Guild Performance Trends</h1>
      <GuildSeasonTable data={chronologicalData} hasCluster={hasCluster} />
      <PlayerSeasonRankingHeatmap
        guildCode={guildCode}
        latestSeason={latestSeason}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <GuildDamageTrendChart data={chronologicalData} />
        <GuildTokenTrendChart data={chronologicalData} />
      </div>
      <GuildEfficiencyChart data={chronologicalData} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {hasCluster && <GuildPerformanceTrendChart data={chronologicalData} />}
        <GuildReliabilityTrendChart data={chronologicalData} />
      </div>
      {hasCluster && radarData && radarData.length > 0 && (
        <GuildVsClusterRadar data={radarData} season={latestSeason} />
      )}
    </div>
  )
}
