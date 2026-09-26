'use client'

import { useQuery } from '@tanstack/react-query'
import PerformanceHeatmapClient from '@/app/components/performance/PerformanceHeatmapClient'
import { useBossPerformanceContext } from '@/app/components/boss-performance/hooks/useBossPerformanceData'
import type { TokenPerformanceData } from '@/app/(dashboard)/guild-management/upcoming-assignments/types'

/** Per-encounter heatmap on /boss (Main, Prime 1, Prime 2) for the selected boss and level. */
export function BossLevelHeatmap() {
  const { selectedGuild, selectedSeason, bossName, level } =
    useBossPerformanceContext()

  const { data, isLoading } = useQuery({
    queryKey: [
      'boss-level-token-performance',
      selectedGuild,
      selectedSeason,
      bossName,
      level
    ] as const,
    queryFn: async (): Promise<TokenPerformanceData> => {
      const params = new URLSearchParams({
        guild_code: selectedGuild,
        season: selectedSeason,
        boss: bossName,
        level,
        include_per_loop: 'true'
      })
      const res = await fetch(
        `/api/boss/token-performance?${params.toString()}`
      )
      if (!res.ok) {
        // Empty on failure keeps /boss usable; log so RLS/auth/500 is distinguishable.
        console.warn(
          'BossLevelHeatmap: boss-level token-performance fetch failed',
          {
            status: res.status,
            statusText: res.statusText,
            season: selectedSeason,
            boss: bossName,
            level
          }
        )
        return {}
      }
      return (await res.json()) as TokenPerformanceData
    },
    enabled: !!selectedGuild && !!selectedSeason && !!bossName && !!level,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  if (isLoading || !data || Object.keys(data).length === 0) {
    return null
  }

  return <PerformanceHeatmapClient tokenPerformance={data} />
}
