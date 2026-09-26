'use client'

import { useMemo, useState, memo, useEffect, useCallback } from 'react'
import { Loader2 } from 'lucide-react'
import { useDebounce } from '@/app/hooks/useDebounce'
import {
  useTokenUsageByLoop,
  useTokenUsageByLoopAndSet,
  useDamageByBossLoop,
  useBossPerformanceMetrics,
  useGuildVsClusterBoss,
  useGuildVsClusterPrime,
  useTotalDamage,
  useMaxLoop
} from '@/app/lib/hooks/queries'
import { usePerformanceMonitor } from '@/app/lib/hooks/usePerformanceOptimized'
import LazyBattleLog from '@/app/components/LazyBattleLog'
import { BossPerformanceTrends } from '@/app/components/dashboard/BossPerformanceTrends'
import type { Rarity } from '@tacticus/app-core/rarity-utils'
import { SystemHealthWidget } from '@/app/components/dashboard/SystemHealthWidget'
import { DataErrorBoundary } from '@/app/components/error'
import { SeasonForecastStrip, LapProjectionOverlay } from '@/app/components/ui'
import { useGuildDisplayLabel } from '@/app/lib/hooks/useGuildDisplayLabel'
import type { DashboardSummaryProps } from '@/app/components/dashboard-summary/types'
import {
  buildBossPerformanceSummaries,
  buildDashboardLoopAggregates,
  buildDamageLoopModel,
  buildLoopTokenData,
  buildLoopTokenDataBySet,
  buildPrimePerformanceSummaries
} from '@/app/components/dashboard-summary/model'
import { CommandCenterHeader } from '@/app/components/dashboard-summary/CommandCenterHeader'
import { PerformanceColumns } from '@/app/components/dashboard-summary/PerformanceColumns'
import { ChartsRow } from '@/app/components/dashboard-summary/ChartsRow'
import { LoopAnalysisSection } from '@/app/components/dashboard-summary/LoopAnalysisSection'
import { TokensPerLapStackedChart } from '@/app/components/dashboard-summary/TokensPerLapStackedChart'

function DashboardSummary({
  selectedGuild,
  selectedSeason,
  hasCluster = true,
  isAlpha = false,
  initialForecast = null,
  initialOutlook = null
}: DashboardSummaryProps) {
  const guildDisplayLabel = useGuildDisplayLabel(selectedGuild)

  usePerformanceMonitor('DashboardSummary.render')
  const { start: startCalculations, end: endCalculations } =
    usePerformanceMonitor('DashboardSummary.calculations')

  const [loadPieChart, setLoadPieChart] = useState(false)
  const [loadLineChart, setLoadLineChart] = useState(false)
  const [loadBarChart, setLoadBarChart] = useState(false)

  const [selectedRarities, setSelectedRarities] = useState<Rarity[]>([
    'Legendary',
    'Mythic'
  ])
  const [availableRarities] = useState<Rarity[]>([
    'Common',
    'Uncommon',
    'Rare',
    'Epic',
    'Legendary',
    'Mythic'
  ])

  const [expandedDashboardLoops, setExpandedDashboardLoops] = useState<
    Set<number>
  >(new Set())
  const [showLoopAnalysisTable, setShowLoopAnalysisTable] = useState(false)
  const [selectedDashboardBoss, setSelectedDashboardBoss] = useState<
    string | null
  >(null)
  const [showPrimesOnly, setShowPrimesOnly] = useState(false)

  const debouncedGuild = useDebounce(selectedGuild, 300)
  const debouncedSeason = useDebounce(selectedSeason, 300)

  const { data: totalDamageData } = useTotalDamage(
    debouncedGuild || '',
    debouncedSeason || '',
    { enabled: !!debouncedGuild && !!debouncedSeason }
  )
  const { data: maxLoopData } = useMaxLoop(
    debouncedGuild || '',
    debouncedSeason || '',
    { enabled: !!debouncedGuild && !!debouncedSeason }
  )

  useEffect(() => {
    if (totalDamageData !== undefined && maxLoopData !== undefined) {
      startCalculations()
      endCalculations()
    }
  }, [totalDamageData, maxLoopData, startCalculations, endCalculations])

  const { data: tokenUsageByLoop } = useTokenUsageByLoop(
    debouncedGuild || '',
    debouncedSeason || '',
    {
      enabled: loadPieChart && !!debouncedGuild && !!debouncedSeason,
      rarities: selectedRarities
    }
  )
  const { data: tokenUsageByLoopAndSet } = useTokenUsageByLoopAndSet(
    debouncedGuild || '',
    debouncedSeason || '',
    {
      enabled: loadBarChart && !!debouncedGuild && !!debouncedSeason,
      rarities: selectedRarities
    }
  )
  const { data: bossPerformanceData } = useBossPerformanceMetrics(
    debouncedGuild || '',
    debouncedSeason || '',
    {
      enabled: loadPieChart && !!debouncedGuild && !!debouncedSeason,
      rarities: selectedRarities
    }
  )
  const { data: clusterComparison } = useGuildVsClusterBoss(
    debouncedGuild || '',
    debouncedSeason || '',
    { enabled: loadPieChart && !!debouncedGuild && !!debouncedSeason }
  )
  const { data: primeClusterComparison } = useGuildVsClusterPrime(
    debouncedGuild || '',
    debouncedSeason || '',
    { enabled: loadPieChart && !!debouncedGuild && !!debouncedSeason }
  )
  const { data: damageByBossLoop } = useDamageByBossLoop(
    debouncedGuild || '',
    debouncedSeason || '',
    { enabled: loadLineChart && !!debouncedGuild && !!debouncedSeason }
  )

  const bossPerformance = useMemo(
    () => buildBossPerformanceSummaries(bossPerformanceData, clusterComparison),
    [bossPerformanceData, clusterComparison]
  )
  const primePerformance = useMemo(
    () =>
      buildPrimePerformanceSummaries(
        bossPerformanceData,
        primeClusterComparison
      ),
    [bossPerformanceData, primeClusterComparison]
  )
  const damageLoopModel = useMemo(
    () => buildDamageLoopModel(damageByBossLoop),
    [damageByBossLoop]
  )
  const processedDamageByBossLoop = damageLoopModel.processed
  const damageBossSeries = damageLoopModel.bosses
  const primeStatusLookup = damageLoopModel.primeStatus

  const totalDamage = totalDamageData ?? 0

  // Must precede the early return (hooks rules).
  const loopTokenData = useMemo(
    () => buildLoopTokenData(tokenUsageByLoop, maxLoopData ?? 0),
    [tokenUsageByLoop, maxLoopData]
  )

  // Must be declared after loopTokenData (TDZ in production).
  const dashboardLoopAggregates = useMemo(
    () =>
      buildDashboardLoopAggregates(
        processedDamageByBossLoop,
        damageBossSeries,
        primeStatusLookup,
        loopTokenData
      ),
    [
      processedDamageByBossLoop,
      damageBossSeries,
      primeStatusLookup,
      loopTokenData
    ]
  )

  const toggleDashboardLoopExpanded = useCallback((loopIndex: number) => {
    setExpandedDashboardLoops((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(loopIndex)) {
        newSet.delete(loopIndex)
      } else {
        newSet.add(loopIndex)
      }
      return newSet
    })
  }, [])

  useEffect(() => {
    const timers = [
      setTimeout(() => setLoadPieChart(true), 500),
      setTimeout(() => setLoadLineChart(true), 700),
      setTimeout(() => setLoadBarChart(true), 900)
    ]

    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [selectedGuild, selectedSeason]) // Reset on filter change

  // Must precede the early return.
  const loopTokenDataBySet = useMemo(
    () => buildLoopTokenDataBySet(tokenUsageByLoopAndSet, maxLoopData ?? 0),
    [tokenUsageByLoopAndSet, maxLoopData]
  )

  if (!selectedGuild || !selectedSeason) {
    return (
      <div className="min-h-screen bg-wh40k flex items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-6 w-6 animate-spin text-primary-wh40k" />
          <p className="text-primary-wh40k">Loading dashboard data...</p>
          <p className="text-sm text-secondary-wh40k mt-2">
            {`Guild: ${selectedGuild ? guildDisplayLabel : 'Loading...'} • Season: ${selectedSeason || 'Loading...'}`}
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-wh40k text-primary-wh40k relative overflow-hidden">
      <div className="absolute inset-0 pattern-scales opacity-5"></div>
      <div className="container-modern space-y-6 relative z-10">
        <CommandCenterHeader
          selectedSeason={selectedSeason}
          totalDamage={totalDamage}
          availableRarities={availableRarities}
          selectedRarities={selectedRarities}
          setSelectedRarities={setSelectedRarities}
        />

        {/* API key health banner */}
        {/* Disabled on user request. */}
        {/* <ApiKeyHealthBanner /> */}

        {/* System health: shown on an issue or to leaders */}
        <SystemHealthWidget />

        <PerformanceColumns
          loadPieChart={loadPieChart}
          bossPerformanceData={bossPerformanceData}
          bossPerformance={bossPerformance}
          primePerformance={primePerformance}
          hasCluster={hasCluster}
          loopTokenData={loopTokenData}
        />

        <ChartsRow
          loadPieChart={loadPieChart}
          loadLineChart={loadLineChart}
          bossPerformance={bossPerformance}
          processedDamageByBossLoop={processedDamageByBossLoop}
          damageBossSeries={damageBossSeries}
        />

        <LoopAnalysisSection
          dashboardLoopAggregates={dashboardLoopAggregates}
          selectedDashboardBoss={selectedDashboardBoss}
          setSelectedDashboardBoss={setSelectedDashboardBoss}
          showPrimesOnly={showPrimesOnly}
          setShowPrimesOnly={setShowPrimesOnly}
          showLoopAnalysisTable={showLoopAnalysisTable}
          setShowLoopAnalysisTable={setShowLoopAnalysisTable}
          expandedDashboardLoops={expandedDashboardLoops}
          toggleDashboardLoopExpanded={toggleDashboardLoopExpanded}
        />

        {/* Season forecast strip (alpha-gated), above the per-lap chart. */}
        {isAlpha && initialForecast && (
          <SeasonForecastStrip
            season={initialForecast.season}
            tokens={initialForecast.tokens}
            bombs={initialForecast.bombs}
            outlook={initialOutlook}
            totalPlayers={initialForecast.per_player.length}
          />
        )}

        <TokensPerLapStackedChart
          loadBarChart={loadBarChart}
          loopTokenDataBySet={loopTokenDataBySet}
        />

        {/* Lap projection summary panel (alpha-gated). */}
        {isAlpha && initialForecast?.lap_projection && (
          <LapProjectionOverlay
            lapProjection={initialForecast.lap_projection}
            tokens={initialForecast.tokens}
          />
        )}

        {/* Boss performance trends */}
        <BossPerformanceTrends
          selectedGuild={selectedGuild}
          selectedSeason={selectedSeason}
          className="mb-6"
        />

        {/* Battle log, lazy loaded */}
        <DataErrorBoundary fallbackMessage="Failed to load battle log">
          <LazyBattleLog
            selectedGuild={selectedGuild}
            selectedSeason={selectedSeason}
          />
        </DataErrorBoundary>
      </div>
    </div>
  )
}

export default memo(DashboardSummary)
