'use client'

import { memo, useRef } from 'react'
import type { RefObject } from 'react'
import { BossEasterEgg } from '@/app/components/ui/BossEasterEgg'
import {
  MechanicusEmptyState as EmptyState,
  TableSkeleton
} from '@tacticus/ui-kit/loading'
import BossBattleLog from '@/app/components/BossBattleLog'
import { BossPerformanceTrends } from '@/app/components/dashboard/BossPerformanceTrends'
import { BossPerformanceCalculationsFAQ } from '@/app/components/boss-performance/BossPerformanceCalculationsFAQ'
import { BossPlaybookSection } from '@/app/components/boss-performance/BossPlaybookSection'
import { BossPerformanceHeader } from '@/app/components/boss-performance/BossPerformanceHeader'
import { BossStatsHighlights } from '@/app/components/boss-performance/BossStatsHighlights'
import { BossRankingsPanel } from '@/app/components/boss-performance/BossRankingsPanel'
import { BossLevelHeatmap } from '@/app/components/boss-performance/BossLevelHeatmap'
import { BossLapTrendCard } from '@/app/components/boss-performance/BossLapTrendCard'
import { BossPrimePerformanceGrid } from '@/app/components/boss-performance/BossPrimePerformanceGrid'
import { BossDamageDistributions } from '@/app/components/boss-performance/BossDamageDistributions'
import {
  BossPerformanceDataProvider,
  useBossPerformanceOverview
} from '@/app/components/boss-performance/hooks/useBossPerformanceData'
import type { BossPerformanceParams } from '@/app/components/boss-performance/types'

function BossPerformanceContainer(props: BossPerformanceParams) {
  const desktopTitleRef = useRef<HTMLHeadingElement>(null)
  const mobileTitleRef = useRef<HTMLHeadingElement>(null)

  return (
    <BossPerformanceDataProvider {...props}>
      <BossPerformanceContent
        desktopTitleRef={desktopTitleRef}
        mobileTitleRef={mobileTitleRef}
        selectedGuild={props.selectedGuild}
        selectedSeason={props.selectedSeason}
        level={props.level}
      />
    </BossPerformanceDataProvider>
  )
}

interface BossPerformanceContentProps extends BossPerformanceParams {
  desktopTitleRef: RefObject<HTMLHeadingElement>
  mobileTitleRef: RefObject<HTMLHeadingElement>
}

function BossPerformanceContent({
  desktopTitleRef,
  mobileTitleRef,
  selectedGuild,
  selectedSeason,
  level
}: BossPerformanceContentProps) {
  const { loading, bossName, displayBossName, playerBossStats, error } =
    useBossPerformanceOverview()

  if (loading && playerBossStats.length === 0) {
    return (
      <div className="min-h-screen bg-wh40k flex items-center justify-center">
        <div className="card-wh40k p-8 w-full max-w-4xl">
          <TableSkeleton rows={4} columns={5} />
          <p className="mt-4 text-center text-primary-wh40k font-semibold">
            Analyzing Level {level} Battle Data...
          </p>
          <div className="mt-2 text-center text-secondary-wh40k text-sm">
            Communing with Machine Spirits...
          </div>
        </div>
      </div>
    )
  }

  return (
    <BossEasterEgg
      bossName={displayBossName}
      triggerRefs={[desktopTitleRef, mobileTitleRef]}
    >
      <div className="space-y-6">
        <BossPerformanceHeader
          desktopTitleRef={desktopTitleRef}
          mobileTitleRef={mobileTitleRef}
        />

        {error && (
          <EmptyState
            title="Unable to load boss analytics"
            description={error}
            action={
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded border border-[var(--card-border)] bg-[var(--card-bg)] px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-[var(--bg-tertiary)]"
              >
                Retry fetch
              </button>
            }
          />
        )}

        <BossPlaybookSection displayBossName={displayBossName} />

        <BossStatsHighlights />

        <BossRankingsPanel />

        <BossLevelHeatmap />

        <BossLapTrendCard />

        <BossPrimePerformanceGrid />

        <BossPerformanceTrends
          selectedGuild={selectedGuild}
          selectedSeason={selectedSeason}
          bossFilter={bossName}
          levelFilter={level}
          className="mb-6"
        />

        <BossDamageDistributions />

        <BossBattleLog
          selectedGuild={selectedGuild}
          selectedSeason={selectedSeason}
          level={level}
          bossName={bossName}
        />

        <div className="card-wh40k p-6">
          <BossPerformanceCalculationsFAQ />
        </div>
      </div>
    </BossEasterEgg>
  )
}

export default memo(BossPerformanceContainer)
