'use client'

import React, { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useDataContext } from '@/app/lib/hooks/useDataContext'
import {
  usePlayerBossPerformance,
  usePlayerPerformanceSummary,
  useGuildVsClusterBossPerformance
} from '@/app/lib/hooks/queries'
import { Rarity } from '@tacticus/app-core/rarity-utils'
import { dbClient } from '@/app/lib/db/client'
import { normalizeDisplayName } from '@/app/lib/utils/normalize'
import {
  usePerformanceCalculations,
  useRecalculatedSummaries
} from '@/app/components/performance'
import type { GuildVsClusterPerformance } from '@/app/components/performance/PerformanceRadarCharts'
import type { PerformanceSummary } from '@tacticus/app-core/performance.types'
import type {
  BossPerformanceFilter,
  CompareMode,
  PerformanceBossStats,
  PerformanceMode,
  TokenRatioMaps,
  TokenWeightingMode
} from '@/app/components/performance/types'
import type { FiveSeasonPlayerRow } from '@/app/components/performance'
import type { SeasonTokenStats } from '@tacticus/app-core/tokens.types'
import { deriveParticipationShareRatiosFromSummaries } from '@tacticus/app-core/token-weighting'
import { aggregateByPlayer } from '@/app/lib/boss-assignments/performance-leaderboard-aggregate'
import type { TokenPerformanceData } from '@/app/(dashboard)/guild-management/upcoming-assignments/types'
import {
  buildTargetWeightedCalculationSummaries,
  clampTargetLoopRange,
  filterTokenPerformanceByLoopRange,
  getTargetLoopList,
  hasCompleteTargetLoopCoverage,
  isFullTargetLoopRange,
  targetAggregateCalculationId
} from './player-performance-data/helpers'
import { queryKeys } from './player-performance-data/query-keys'
import type {
  PlayerMappingStatusRow,
  PlayerPerformancePageProps,
  TargetLoopRange
} from './player-performance-data/types'
import {
  buildBurnStatsLookup,
  buildBurnStatsSummary,
  buildPlayerMembershipMap,
  buildTokenRatioState
} from './player-performance-data/model'
import { useTokenBurnRows } from './player-performance-data/useTokenBurnRows'

export function usePlayerPerformanceData({
  selectedGuild,
  selectedSeason,
  userRole
}: PlayerPerformancePageProps) {
  const { context, loading: contextLoading } = useDataContext()
  const [compareMode, setCompareMode] = useState<CompareMode>('guild')
  const [showBossDetail, setShowBossDetail] = useState(false)
  const [showChartLines, setShowChartLines] = useState(false)
  const [show5SeasonAvg, setShow5SeasonAvg] = useState(false)
  const [hideInactivePlayers, setHideInactivePlayers] = useState(true)
  const currentDisplayNames = React.useMemo(() => new Map<string, string>(), [])
  const latestDisplayNames = React.useMemo(() => new Map<string, string>(), [])
  const [bossDetailSearch, setBossDetailSearch] = useState('')
  const [selectedBossType, setSelectedBossType] = useState('all')
  const [bossPerformanceFilter, setBossPerformanceFilter] =
    useState<BossPerformanceFilter>('all')
  const [bossMinBattles, setBossMinBattles] = useState(0)
  const [performanceMode, setPerformanceMode] =
    useState<PerformanceMode>('battle-weighted')
  const [tokenWeightingMode, setTokenWeightingMode] =
    useState<TokenWeightingMode>('max')
  const [targetLoopRange, setTargetLoopRange] =
    useState<TargetLoopRange | null>(null)

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

  const hasCluster = !!context?.clusterCode

  const { data: playerBossStats, isLoading: bossStatsLoading } =
    usePlayerBossPerformance(selectedGuild, selectedSeason, {
      rarities: selectedRarities
    })
  const { data: playerSummaries, isLoading: summaryLoading } =
    usePlayerPerformanceSummary(selectedGuild, selectedSeason, {
      rarities: selectedRarities
    })
  const { data: guildVsClusterBoss, isLoading: guildClusterLoading } =
    useGuildVsClusterBossPerformance(selectedGuild, selectedSeason, {
      enabled: hasCluster,
      rarities: selectedRarities
    })

  const currentSeasonNum = parseInt(selectedSeason) || 0

  const { data: playerFiveSeasonData = [] } = useQuery({
    queryKey: queryKeys.fiveSeasonAverages(selectedGuild, currentSeasonNum),
    queryFn: async () => {
      // The RPC joins player_mapping (no browser grants), so it goes through a
      // service-role route with a guild membership gate.
      const params = new URLSearchParams({
        guild: selectedGuild,
        season: String(currentSeasonNum)
      })
      const res = await fetch(
        `/api/performance/five-season-averages?${params.toString()}`
      )
      if (!res.ok) {
        throw new Error(
          `five-season averages fetch failed: ${res.status} ${res.statusText}`
        )
      }
      return (await res.json()) as FiveSeasonPlayerRow[]
    },
    enabled: show5SeasonAvg && !!selectedGuild && !!selectedSeason,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  const { data: rosterMembershipData, isSuccess: membershipLoaded } = useQuery({
    queryKey: queryKeys.rosterMembership(selectedGuild),
    queryFn: async () => {
      const supabase = dbClient()
      const { data, error } = await supabase
        .from('player_mapping')
        .select('player_id, display_name, is_current, is_active')
        .eq('guild_code', selectedGuild)

      if (error) throw error

      const entries = Array.isArray(data)
        ? (data as PlayerMappingStatusRow[])
        : []
      return buildPlayerMembershipMap(entries)
    },
    enabled: !!selectedGuild,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000,
    placeholderData: () => new Map<string, boolean>()
  })

  const playerMembershipMap = useMemo(
    () => rosterMembershipData ?? new Map<string, boolean>(),
    [rosterMembershipData]
  )

  const calculationSummaries: PerformanceSummary[] = Array.isArray(
    playerSummaries
  )
    ? (playerSummaries as PerformanceSummary[])
    : []

  const basePlayerSummaries = useRecalculatedSummaries({
    showFiveSeasonAvg: show5SeasonAvg,
    playerFiveSeasonData,
    compareMode,
    latestDisplayNames,
    currentDisplayNames,
    playerMembershipMap,
    selectedGuild,
    calculationSummaries
  })

  const fallbackTokenRatioMaps = React.useMemo<TokenRatioMaps>(
    () => ({
      max: deriveParticipationShareRatiosFromSummaries(
        basePlayerSummaries,
        'max'
      ),
      average: deriveParticipationShareRatiosFromSummaries(
        basePlayerSummaries,
        'average'
      )
    }),
    [basePlayerSummaries]
  )

  const seasonNumber = parseInt(selectedSeason, 10)
  const includeCluster = hasCluster
  const { data: tokenStats = null } = useQuery({
    queryKey: queryKeys.tokenStats(selectedGuild, seasonNumber, includeCluster),
    queryFn: async () => {
      const supabase = dbClient()
      const { data, error } = await supabase.rpc('get_season_token_stats', {
        p_guild_code: selectedGuild,
        p_season: seasonNumber,
        p_include_cluster: includeCluster
      })

      if (error) throw error

      return Array.isArray(data) ? (data as SeasonTokenStats[]) : []
    },
    enabled: !!selectedGuild && !!selectedSeason && !Number.isNaN(seasonNumber),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  const { data: tokenUsageBurnRows = [], isLoading: burnStatsLoading } =
    useTokenBurnRows(
      selectedGuild,
      selectedSeason,
      !!selectedGuild && !!selectedSeason && !show5SeasonAvg,
      userRole
    )

  const tokenRatioState = React.useMemo(
    () => buildTokenRatioState(tokenStats, fallbackTokenRatioMaps),
    [fallbackTokenRatioMaps, tokenStats]
  )

  const tokenContext =
    compareMode === 'cluster' || compareMode === 'cluster-boss'
      ? 'cluster'
      : 'guild'
  const appliedTokenRatioMaps = tokenRatioState.mapsByContext[tokenContext]
  const selectedTokenRatios = appliedTokenRatioMaps[tokenWeightingMode]
  const usingRpcTokenData = tokenRatioState.hasRpc[tokenContext]
  const tokenModeAvailable = selectedTokenRatios.size > 0
  const tokenModeUsesApproximation =
    performanceMode === 'token-weighted' &&
    tokenModeAvailable &&
    !usingRpcTokenData

  React.useEffect(() => {
    if (performanceMode !== 'token-weighted') {
      return
    }

    const currentRatios = appliedTokenRatioMaps[tokenWeightingMode]
    if (currentRatios.size > 0) {
      return
    }

    const alternateMode: TokenWeightingMode =
      tokenWeightingMode === 'average' ? 'max' : 'average'

    if (appliedTokenRatioMaps[alternateMode].size > 0) {
      setTokenWeightingMode(alternateMode)
      return
    }

    setPerformanceMode('battle-weighted')
  }, [appliedTokenRatioMaps, performanceMode, tokenWeightingMode])

  const includePlayer = React.useCallback(
    (playerId?: string, name?: string, isActiveOverride?: boolean) => {
      if (!hideInactivePlayers) return true

      if (
        performanceMode === 'target-weighted' &&
        playerId &&
        playerId.trim().length > 0
      ) {
        return true
      }

      if (typeof isActiveOverride === 'boolean') {
        return isActiveOverride
      }

      if (!membershipLoaded || playerMembershipMap.size === 0) return true

      if (playerId) {
        const trimmedId = playerId.trim()
        const statusById = playerMembershipMap.get(trimmedId)
        if (statusById !== undefined) {
          return statusById
        }
      }

      const normalized = normalizeDisplayName(name)
      if (normalized) {
        const statusByName = playerMembershipMap.get(normalized)
        if (statusByName !== undefined) {
          return statusByName
        }
      }

      // Unmapped players with a userId are assumed active (e.g. renamed players).
      if (playerId && playerId.trim().length > 0) {
        return true
      }

      return false
    },
    [
      hideInactivePlayers,
      membershipLoaded,
      performanceMode,
      playerMembershipMap
    ]
  )

  const loading =
    bossStatsLoading || summaryLoading || guildClusterLoading || contextLoading

  const rawPerformanceBossStatsArray: PerformanceBossStats[] = Array.isArray(
    playerBossStats
  )
    ? (playerBossStats as PerformanceBossStats[])
    : []

  const targetCompareMode: 'guild' | 'cluster' =
    compareMode === 'cluster' || compareMode === 'cluster-boss'
      ? 'cluster'
      : 'guild'
  // In Target Weighting `-boss` Compare variants mean mains only; primes default on.
  const targetIncludePrimes =
    compareMode !== 'guild-boss' && compareMode !== 'cluster-boss'
  const setTargetIncludePrimes = React.useCallback((next: boolean) => {
    setCompareMode((prev) => {
      const base =
        prev === 'cluster' || prev === 'cluster-boss' ? 'cluster' : 'guild'
      return next ? base : (`${base}-boss` as CompareMode)
    })
  }, [])
  const targetClusterCode = context?.clusterCode ?? ''
  const targetRaritiesKey = [...selectedRarities].sort().join(',')
  const { data: targetWeightedRaw } = useQuery({
    queryKey: queryKeys.targetWeightedTokenPerformance(
      selectedGuild,
      selectedSeason,
      targetCompareMode,
      targetClusterCode,
      targetRaritiesKey,
      targetIncludePrimes
    ),
    queryFn: async (): Promise<TokenPerformanceData> => {
      const params = new URLSearchParams({ guild_code: selectedGuild })
      if (selectedSeason) params.set('season', selectedSeason)
      params.set('compare_mode', targetCompareMode)
      if (targetCompareMode === 'cluster' && targetClusterCode) {
        params.set('cluster_code', targetClusterCode)
      }
      if (targetRaritiesKey) params.set('rarities', targetRaritiesKey)
      params.set('include_per_loop', 'true')
      // Historical view: keep players who left the roster. Assignment surfaces leave this off.
      params.set('include_historical_players', 'true')
      if (targetIncludePrimes) params.set('include_primes', 'true')
      const res = await fetch(
        `/api/upcoming/token-performance?${params.toString()}`
      )
      if (!res.ok) {
        // Empty on failure keeps the heatmap usable; log to tell auth/RLS/500 from no data.
        console.warn(
          'usePlayerPerformanceData: target-weighted token-performance fetch failed',
          {
            status: res.status,
            statusText: res.statusText,
            season: selectedSeason,
            compareMode: targetCompareMode
          }
        )
        return {}
      }
      return (await res.json()) as TokenPerformanceData
    },
    enabled:
      !!selectedGuild &&
      performanceMode === 'target-weighted' &&
      !show5SeasonAvg &&
      (targetCompareMode === 'guild' || !!targetClusterCode),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })

  const targetLoopList = useMemo(
    () => getTargetLoopList(targetWeightedRaw),
    [targetWeightedRaw]
  )
  const targetLoopCoverageComplete = useMemo(
    () => hasCompleteTargetLoopCoverage(targetWeightedRaw),
    [targetWeightedRaw]
  )
  const targetLoopListKey = targetLoopList.join(',')
  const targetLoopFirst = targetLoopList[0]
  const targetLoopLast = targetLoopList[targetLoopList.length - 1]

  React.useEffect(() => {
    if (
      performanceMode !== 'target-weighted' ||
      !targetLoopCoverageComplete ||
      targetLoopFirst === undefined ||
      targetLoopLast === undefined
    ) {
      setTargetLoopRange(null)
      return
    }

    setTargetLoopRange({ start: targetLoopFirst, end: targetLoopLast })
  }, [
    performanceMode,
    selectedGuild,
    selectedSeason,
    targetClusterCode,
    targetCompareMode,
    targetLoopCoverageComplete,
    targetLoopFirst,
    targetLoopListKey,
    targetLoopLast,
    targetRaritiesKey
  ])

  const setTargetLoopRangeClamped = React.useCallback(
    (nextStart: number, nextEnd: number) => {
      const nextRange = clampTargetLoopRange(nextStart, nextEnd, targetLoopList)
      if (!nextRange) return

      setTargetLoopRange(nextRange)
    },
    [targetLoopList]
  )

  const targetWeightedFilteredRaw = useMemo(() => {
    if (!targetWeightedRaw) return null
    if (!targetLoopCoverageComplete) return targetWeightedRaw
    if (targetLoopList.length <= 1) return targetWeightedRaw
    if (isFullTargetLoopRange(targetLoopRange, targetLoopList)) {
      return targetWeightedRaw
    }
    if (!targetLoopRange) return targetWeightedRaw

    return filterTokenPerformanceByLoopRange(targetWeightedRaw, targetLoopRange)
  }, [
    targetLoopCoverageComplete,
    targetLoopList,
    targetLoopRange,
    targetWeightedRaw
  ])

  // Target Weighting is single-season; with the 5-season average on, use battle-weighted.
  React.useEffect(() => {
    if (performanceMode === 'target-weighted' && show5SeasonAvg) {
      setPerformanceMode('battle-weighted')
    }
  }, [performanceMode, show5SeasonAvg])

  const targetWeightedAggregateRows = useMemo(
    () =>
      targetWeightedFilteredRaw
        ? aggregateByPlayer(targetWeightedFilteredRaw)
        : [],
    [targetWeightedFilteredRaw]
  )

  const targetWeightedScoresByPlayer = useMemo(() => {
    const map = new Map<string, number>()
    targetWeightedAggregateRows.forEach((row) => {
      if (row.weightedScore !== null) {
        map.set(targetAggregateCalculationId(row), row.weightedScore)
      }
    })
    return map
  }, [targetWeightedAggregateRows])

  const targetWeightedCalculationSummaries = useMemo(() => {
    if (
      performanceMode !== 'target-weighted' ||
      targetWeightedFilteredRaw === null
    ) {
      return basePlayerSummaries
    }

    if (targetWeightedAggregateRows.length === 0) {
      return []
    }

    return buildTargetWeightedCalculationSummaries(
      basePlayerSummaries,
      targetWeightedAggregateRows
    )
  }, [
    basePlayerSummaries,
    performanceMode,
    targetWeightedAggregateRows,
    targetWeightedFilteredRaw
  ])

  const performanceCalculations = usePerformanceCalculations({
    summaries: targetWeightedCalculationSummaries,
    bossStats: rawPerformanceBossStatsArray,
    hideInactive: hideInactivePlayers,
    includePlayer,
    bossDetailSearch,
    selectedBossType,
    bossPerformanceFilter,
    bossMinBattles,
    compareMode,
    performanceMode,
    tokenRatiosByMode: appliedTokenRatioMaps,
    tokenWeightingMode,
    targetWeightedScoresByPlayer:
      performanceMode === 'target-weighted' && targetWeightedFilteredRaw
        ? targetWeightedScoresByPlayer
        : undefined
  })

  const {
    playerSummaries: playerSummariesArray,
    filteredBossStats: displayBossStats,
    bossDetailTypes,
    totalBossRows,
    hasBossFiltersActive,
    hiddenPlayerCount,
    chartMax,
    topPlayer,
    tokenModeActive
  } = performanceCalculations

  const burnStatsLookup = React.useMemo(
    () => buildBurnStatsLookup(tokenUsageBurnRows),
    [tokenUsageBurnRows]
  )
  const burnStatsSummary = React.useMemo(
    () =>
      buildBurnStatsSummary({
        showFiveSeasonAverage: show5SeasonAvg,
        rows: tokenUsageBurnRows,
        summaries: playerSummariesArray,
        lookup: burnStatsLookup
      }),
    [burnStatsLookup, playerSummariesArray, show5SeasonAvg, tokenUsageBurnRows]
  )

  const getBarColor = React.useCallback((value: number) => {
    if (!Number.isFinite(value) || value === 0) {
      return 'bg-(--card-border)'
    }
    if (value > 0) {
      return value >= 20 ? 'bg-emerald-400' : 'bg-accent-wh40k'
    }
    return value <= -20 ? 'bg-red-600' : 'bg-red-500/80'
  }, [])

  const getTextColor = React.useCallback((value: number) => {
    if (!Number.isFinite(value) || value === 0) {
      return 'text-secondary-wh40k'
    }
    return value > 0 ? 'text-(--accent)' : 'text-red-400'
  }, [])

  const resetBossDetailFilters = React.useCallback(() => {
    setBossDetailSearch('')
    setSelectedBossType('all')
    setBossPerformanceFilter('all')
    setBossMinBattles(0)
  }, [
    setBossDetailSearch,
    setSelectedBossType,
    setBossPerformanceFilter,
    setBossMinBattles
  ])
  const guildVsClusterBossArray: GuildVsClusterPerformance[] = Array.isArray(
    guildVsClusterBoss
  )
    ? (guildVsClusterBoss as GuildVsClusterPerformance[])
    : []
  const showNoDataCard = !loading && playerSummariesArray.length === 0
  const allHiddenByFilter = showNoDataCard && hiddenPlayerCount > 0
  const showBurnStatsCard = !show5SeasonAvg

  return {
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
    burnStatsLoading: showBurnStatsCard && Boolean(burnStatsLoading),
    showBurnStatsCard,
    targetLoopRange:
      performanceMode === 'target-weighted' &&
      targetLoopCoverageComplete &&
      targetLoopList.length > 1 &&
      targetLoopRange
        ? {
            availableLoops: targetLoopList,
            start: targetLoopRange.start,
            end: targetLoopRange.end
          }
        : null,
    setTargetLoopRange: setTargetLoopRangeClamped,
    targetIncludePrimes,
    setTargetIncludePrimes,
    targetWeightedRaw: targetWeightedFilteredRaw ?? null
  }
}
