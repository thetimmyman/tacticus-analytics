'use client'

import { memo } from 'react'
import {
  MechanicusEmptyState as EmptyState,
  TableSkeleton
} from '@tacticus/ui-kit/loading'
import {
  PerformanceControls,
  PerformanceChart,
  PerformanceSummaryWidgets,
  PerformanceBurnStats,
  PerformanceRadarCharts,
  PerformanceBossDetails,
  PerformanceTargetTokensTable
} from '@/app/components/performance'
import { usePlayerPerformanceData } from '@/app/components/performance/hooks/usePlayerPerformanceData'
import PerformanceHeatmapClient from '@/app/components/performance/PerformanceHeatmapClient'
import { useGuildDisplayLabel } from '@/app/lib/hooks/useGuildDisplayLabel'

interface PlayerPerformanceClientProps {
  selectedGuild: string
  selectedSeason: string
  userGuild?: string
  userRole?: string
  canManageTargets?: boolean
}

function PlayerPerformanceClient({
  selectedGuild,
  selectedSeason,
  userGuild,
  userRole,
  canManageTargets = false
}: PlayerPerformanceClientProps) {
  const guildDisplayLabel = useGuildDisplayLabel(selectedGuild)
  const {
    compareMode,
    setCompareMode,
    showBossDetail,
    setShowBossDetail,
    showChartLines,
    setShowChartLines,
    show5SeasonAvg,
    setShow5SeasonAvg,
    hideInactivePlayers,
    setHideInactivePlayers,
    bossDetailSearch,
    setBossDetailSearch,
    selectedBossType,
    setSelectedBossType,
    bossPerformanceFilter,
    setBossPerformanceFilter,
    bossMinBattles,
    setBossMinBattles,
    performanceMode,
    setPerformanceMode,
    tokenWeightingMode,
    setTokenWeightingMode,
    selectedRarities,
    setSelectedRarities,
    availableRarities,
    hasCluster,
    loading,
    playerSummariesArray,
    displayBossStats,
    bossDetailTypes,
    totalBossRows,
    hasBossFiltersActive,
    hiddenPlayerCount,
    chartMax,
    topPlayer,
    tokenModeActive,
    getBarColor,
    getTextColor,
    resetBossDetailFilters,
    guildVsClusterBossArray,
    showNoDataCard,
    allHiddenByFilter,
    tokenModeUsesApproximation,
    tokenModeAvailable,
    burnStatsSummary,
    burnStatsLoading,
    showBurnStatsCard,
    targetLoopRange,
    setTargetLoopRange,
    targetIncludePrimes,
    setTargetIncludePrimes,
    targetWeightedRaw
  } = usePlayerPerformanceData({
    selectedGuild,
    selectedSeason,
    userGuild,
    userRole
  })

  if (loading) {
    return (
      <div className="p-6">
        <TableSkeleton rows={5} columns={6} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-lg font-semibold text-accent-wh40k">
          <span className="block sm:inline">Player Performance vs Average</span>
          <span className="block sm:inline sm:ml-1">(Per Boss)</span>
        </h2>
        <p className="text-sm text-secondary-wh40k">
          {show5SeasonAvg
            ? `5-Season Historical Average (Seasons ${parseInt(selectedSeason) - 5} to ${parseInt(selectedSeason) - 1})`
            : `Season ${selectedSeason}`}{' '}
          - {guildDisplayLabel}
        </p>
        <p className="text-xs text-secondary-wh40k">
          Dynamic Rarity Filtering - No Sweeps - No Bombs - Token-Weighted
          Average
        </p>
      </div>

      <PerformanceControls
        availableRarities={availableRarities}
        selectedRarities={selectedRarities}
        onRarityChange={setSelectedRarities}
        hideInactivePlayers={hideInactivePlayers}
        hiddenPlayerCount={hiddenPlayerCount}
        onHideInactiveChange={setHideInactivePlayers}
        hasCluster={hasCluster}
        compareMode={compareMode}
        onCompareModeChange={setCompareMode}
        performanceMode={performanceMode}
        onPerformanceModeChange={setPerformanceMode}
        tokenModeAvailable={tokenModeAvailable}
        tokenWeightingMode={tokenWeightingMode}
        onTokenWeightingModeChange={setTokenWeightingMode}
        tokenModeUsesApproximation={tokenModeUsesApproximation}
        showBossDetail={showBossDetail}
        onShowBossDetailChange={setShowBossDetail}
        showFiveSeasonAverage={show5SeasonAvg}
        onShowFiveSeasonAverageChange={setShow5SeasonAvg}
        targetLoopRange={targetLoopRange}
        onTargetLoopRangeChange={setTargetLoopRange}
      />

      {showNoDataCard && (
        <EmptyState
          title={allHiddenByFilter ? 'All Players Hidden' : 'No Player Data'}
          description={
            allHiddenByFilter
              ? 'All players are currently hidden because they are marked inactive. Toggle off “Hide inactive members” to review archived members.'
              : `No qualified players found for Season ${selectedSeason} - ${guildDisplayLabel}. Adjust your filters or reset the boss detail view to see results.`
          }
          action={
            <button
              type="button"
              onClick={() => {
                if (allHiddenByFilter) {
                  setHideInactivePlayers(false)
                } else {
                  resetBossDetailFilters()
                }
              }}
              className="rounded-sm border border-(--card-border) bg-(--card-bg) px-4 py-2 text-sm font-medium text-primary-wh40k transition hover:bg-(--bg-tertiary)"
            >
              {allHiddenByFilter ? 'Show inactive members' : 'Reset filters'}
            </button>
          }
        />
      )}

      {playerSummariesArray.length > 0 && (
        <PerformanceChart
          compareMode={compareMode}
          performanceMode={performanceMode}
          tokenModeActive={tokenModeActive}
          showChartLines={showChartLines}
          onToggleChartLines={() => setShowChartLines((prev) => !prev)}
          playerSummaries={playerSummariesArray}
          chartMax={chartMax}
          getBarColor={getBarColor}
          getTextColor={getTextColor}
        />
      )}

      {/* The page-level primes scope drives the score, heatmap and this table together. */}
      {performanceMode === 'target-weighted' && selectedGuild && (
        <PerformanceTargetTokensTable
          guildCode={selectedGuild}
          canManage={canManageTargets}
          selectedSeason={selectedSeason}
          showPrimes={targetIncludePrimes}
          onShowPrimesChange={setTargetIncludePrimes}
        />
      )}

      {/* targetWeightedRaw is only populated in target-weighted mode. */}
      {performanceMode === 'target-weighted' &&
        targetWeightedRaw &&
        Object.keys(targetWeightedRaw).length > 0 && (
          <PerformanceHeatmapClient
            tokenPerformance={targetWeightedRaw}
            includePrimes={targetIncludePrimes}
            onIncludePrimesChange={setTargetIncludePrimes}
          />
        )}

      <PerformanceSummaryWidgets
        playerSummaries={playerSummariesArray}
        topPlayer={topPlayer}
        compareMode={compareMode}
        performanceMode={performanceMode}
        tokenModeActive={tokenModeActive}
        tokenModeUsesApproximation={tokenModeUsesApproximation}
        tokenWeightingMode={tokenWeightingMode}
      />

      {showBurnStatsCard && (
        <PerformanceBurnStats
          season={selectedSeason}
          burnSummary={burnStatsSummary}
          isLoading={burnStatsLoading}
        />
      )}

      <PerformanceRadarCharts
        hasCluster={hasCluster}
        selectedGuild={selectedGuild}
        data={guildVsClusterBossArray}
      />

      <PerformanceBossDetails
        showBossDetail={showBossDetail}
        bossDetailTypes={bossDetailTypes}
        bossDetailSearch={bossDetailSearch}
        onBossDetailSearchChange={setBossDetailSearch}
        selectedBossType={selectedBossType}
        onSelectedBossTypeChange={setSelectedBossType}
        bossPerformanceFilter={bossPerformanceFilter}
        onBossPerformanceFilterChange={setBossPerformanceFilter}
        bossMinBattles={bossMinBattles}
        onBossMinBattlesChange={setBossMinBattles}
        displayedBossStats={displayBossStats}
        totalBossRows={totalBossRows}
        hasBossFiltersActive={hasBossFiltersActive}
        resetBossDetailFilters={resetBossDetailFilters}
        compareMode={compareMode}
        getTextColor={getTextColor}
        hasCluster={hasCluster}
      />
    </div>
  )
}

export default memo(PlayerPerformanceClient)
