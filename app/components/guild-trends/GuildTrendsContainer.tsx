'use client'

import type { GuildTrendsRow } from '@/app/lib/calculations/experimental/guild-trends'
import type { GuildVsClusterBossRow } from '@/app/lib/calculations/experimental/guild-vs-cluster'
import { GuildTrendsClient } from './GuildTrendsClient'

interface GuildTrendsContainerProps {
  userGuildCode: string
  clusterCode: string
  latestSeason: string
  initialTrends?: GuildTrendsRow[]
  initialRadar?: GuildVsClusterBossRow[]
}

export function GuildTrendsContainer({
  userGuildCode,
  clusterCode,
  latestSeason,
  initialTrends,
  initialRadar
}: GuildTrendsContainerProps) {
  return (
    <GuildTrendsClient
      guildCode={userGuildCode}
      clusterCode={clusterCode}
      latestSeason={latestSeason}
      initialTrends={initialTrends}
      initialRadar={initialRadar}
    />
  )
}
