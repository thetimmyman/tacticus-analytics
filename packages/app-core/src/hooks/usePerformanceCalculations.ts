import {
  applyTokenWeightingPercent,
  getTokenRatioForSummary
} from '@tacticus/app-core/token-weighting'
import type {
  BossPerformanceFilter,
  CompareMode,
  PerformanceBossStats,
  PerformanceMode,
  PreparedPerformanceBossStat,
  PreparedPerformanceSummary,
  TokenRatioMaps,
  TokenWeightingMode
} from '@tacticus/app-core/performance-calculations.types'
import type { PerformanceSummary } from '@tacticus/app-core/performance.types'

export interface UsePerformanceCalculationsParams {
  summaries: PerformanceSummary[]
  bossStats: PerformanceBossStats[]
  hideInactive: boolean
  includePlayer: (
    playerId?: string,
    name?: string,
    isActive?: boolean
  ) => boolean
  bossDetailSearch: string
  selectedBossType: string
  bossPerformanceFilter: BossPerformanceFilter
  bossMinBattles: number
  compareMode: CompareMode
  performanceMode: PerformanceMode
  tokenRatiosByMode?: TokenRatioMaps
  tokenWeightingMode: TokenWeightingMode
  /** displayName -> actual/expected ratio, used only in target-weighted mode. */
  targetWeightedScoresByPlayer?: Map<string, number>
}

export interface PerformanceCalculationsResult {
  playerSummaries: PreparedPerformanceSummary[]
  filteredBossStats: PreparedPerformanceBossStat[]
  bossDetailTypes: string[]
  totalBossRows: number
  hasBossFiltersActive: boolean
  hiddenPlayerCount: number
  maxPerformanceAbsolute: number
  chartMax: number
  topPlayer: PreparedPerformanceSummary | null
  tokenModeActive: boolean
}

export function usePerformanceCalculations({
  summaries,
  bossStats,
  hideInactive,
  includePlayer,
  bossDetailSearch,
  selectedBossType,
  bossPerformanceFilter,
  bossMinBattles,
  compareMode,
  performanceMode,
  tokenRatiosByMode,
  tokenWeightingMode,
  targetWeightedScoresByPlayer
}: UsePerformanceCalculationsParams): PerformanceCalculationsResult {
  const includedSummaries = hideInactive
    ? summaries.filter((summary) =>
        includePlayer(summary.playerId, summary.displayName, summary.isActive)
      )
    : summaries

  const selectedTokenRatios =
    tokenRatiosByMode !== undefined
      ? tokenRatiosByMode[tokenWeightingMode]
      : undefined
  const tokenRatiosAvailable =
    selectedTokenRatios !== undefined && selectedTokenRatios.size > 0

  const lookupTargetWeightedScore = (
    summary: PerformanceSummary
  ): number | null => {
    if (
      !targetWeightedScoresByPlayer ||
      targetWeightedScoresByPlayer.size === 0
    )
      return null
    const normalize = (s: string | null | undefined) =>
      (s ?? '').trim().toLowerCase()
    const byId = summary.playerId
      ? targetWeightedScoresByPlayer.get(summary.playerId.trim())
      : undefined
    if (typeof byId === 'number') return byId
    const byName = targetWeightedScoresByPlayer.get(
      normalize(summary.displayName)
    )
    return typeof byName === 'number' ? byName : null
  }

  const playerSummaries: PreparedPerformanceSummary[] = includedSummaries.map(
    (summary) => {
      const basePerformance = getSummaryPerformanceValue(summary, compareMode)
      const ratio =
        performanceMode === 'token-weighted' &&
        tokenRatiosAvailable &&
        selectedTokenRatios
          ? getTokenRatioForSummary(summary, selectedTokenRatios)
          : 1

      let performanceValue: number
      if (performanceMode === 'target-weighted') {
        const score = lookupTargetWeightedScore(summary)
        // Raw score against a 1.0 reference line; null players render as 0 but stay listed.
        performanceValue = score !== null ? score : 0
      } else if (performanceMode === 'token-weighted' && tokenRatiosAvailable) {
        performanceValue = applyTokenWeightingPercent(basePerformance, ratio)
      } else {
        performanceValue = basePerformance
      }

      return {
        ...summary,
        performanceValue,
        basePerformanceValue: basePerformance,
        tokenRatioApplied: ratio
      }
    }
  )

  const hiddenPlayerCount = Math.max(
    0,
    summaries.length - includedSummaries.length
  )

  const maxPerformanceAbsolute =
    playerSummaries.length === 0
      ? 0
      : playerSummaries.reduce((max, summary) => {
          const absolute = Math.abs(summary.performanceValue)
          return absolute > max ? absolute : max
        }, 0)

  const chartMax = Math.max(maxPerformanceAbsolute, 40)
  const topPlayer =
    playerSummaries.length === 0
      ? null
      : playerSummaries.reduce<PreparedPerformanceSummary | null>(
          (best, current) => {
            if (!best) return current
            return current.performanceValue > best.performanceValue
              ? current
              : best
          },
          null
        )

  const playerBossStats = hideInactive
    ? bossStats.filter((stat) =>
        includePlayer(
          stat.player_id || stat.userId,
          stat.displayName,
          stat.is_current_member
        )
      )
    : bossStats

  const preparedBossStats: PreparedPerformanceBossStat[] = playerBossStats.map(
    (stat) => {
      const performanceValue = getBossPerformanceValue(stat, compareMode)
      const detailType = getBossDetailType(stat)

      return {
        ...stat,
        detailType,
        performanceValue
      }
    }
  )

  const bossDetailTypes = Array.from(
    new Set(preparedBossStats.map((stat) => stat.detailType))
  ).sort((a, b) => a.localeCompare(b))

  const searchTerm = bossDetailSearch.trim().toLowerCase()
  const filteredBossStats = preparedBossStats.filter((stat) => {
    const performanceValue = stat.performanceValue
    const statType = stat.detailType
    const matchesSearch =
      searchTerm.length === 0 ||
      [stat.displayName, stat.boss_name]
        .filter(
          (value): value is string =>
            typeof value === 'string' && value.length > 0
        )
        .some((value) => value.toLowerCase().includes(searchTerm))
    const matchesType =
      selectedBossType === 'all' || statType === selectedBossType
    const matchesPerformance =
      bossPerformanceFilter === 'all'
        ? true
        : bossPerformanceFilter === 'positive'
          ? performanceValue >= 0
          : performanceValue < 0
    const matchesMinBattles =
      bossMinBattles > 0 ? (stat.battle_count ?? 0) >= bossMinBattles : true

    return (
      matchesSearch && matchesType && matchesPerformance && matchesMinBattles
    )
  })

  const sortedBossStats = [...filteredBossStats].sort(
    (a, b) => b.performanceValue - a.performanceValue
  )

  const hasBossFiltersActive =
    bossDetailSearch.trim().length > 0 ||
    selectedBossType !== 'all' ||
    bossPerformanceFilter !== 'all' ||
    bossMinBattles > 0

  return {
    playerSummaries,
    filteredBossStats: sortedBossStats,
    bossDetailTypes,
    totalBossRows: preparedBossStats.length,
    hasBossFiltersActive,
    hiddenPlayerCount,
    maxPerformanceAbsolute,
    chartMax,
    topPlayer,
    tokenModeActive:
      performanceMode === 'token-weighted' && tokenRatiosAvailable
  }
}

function getBossPerformanceValue(
  stat: PerformanceBossStats,
  compareMode: CompareMode
): number {
  const rawValue =
    compareMode === 'cluster' || compareMode === 'cluster-boss'
      ? stat.vs_cluster_pct
      : stat.vs_guild_pct

  return typeof rawValue === 'number' && !Number.isNaN(rawValue) ? rawValue : 0
}

function getBossDetailType(stat: PerformanceBossStats): string {
  if (typeof stat.overallTokenUsage === 'string') {
    const normalized = stat.overallTokenUsage.trim()
    if (normalized.length > 0) {
      return normalized
    }
  }

  return 'Unknown'
}

function getSummaryPerformanceValue(
  summary: PerformanceSummary,
  compareMode: CompareMode
): number {
  switch (compareMode) {
    case 'cluster':
      return summary.avg_vs_cluster
    case 'cluster-boss':
      return summary.avg_vs_cluster_boss_only
    case 'guild':
      return summary.avg_vs_guild
    case 'guild-boss':
      return summary.avg_vs_guild_boss_only
    default:
      return summary.avg_vs_cluster
  }
}
