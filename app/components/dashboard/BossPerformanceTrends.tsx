'use client'

import { useMemo, useState } from 'react'
import {
  useBossDifficultyAnalysis,
  useBossPerformanceMetrics,
  useDamageByBossLoop,
  useTokenUsageByLoop
} from '@/app/lib/hooks/queries'
import { HelpCircle } from 'lucide-react'
import { usePerformanceMonitor } from '@/app/lib/hooks/usePerformanceOptimized'
import { buildBossMlInsight } from '@/app/lib/ml/performance-predictor'
import type { BossHistoricalSample } from '@/app/lib/ml/types'
import { type TrendDirection } from './boss-performance-tooltips'
import {
  type BossMetrics,
  type TargetFilter
} from './boss-performance-trends-types'
import { Tooltip } from './BossPerformanceTrendsTooltip'
import { BossPerformanceSummaryStats } from './BossPerformanceSummaryStats'
import { BossPerformanceLoopTable } from './BossPerformanceLoopTable'
import { BossPerformanceBossList } from './BossPerformanceBossList'

interface BossPerformanceTrendsProps {
  selectedGuild: string
  selectedSeason: string
  className?: string
  bossFilter?: string // Filter to specific boss name
  levelFilter?: string // Filter to specific level (L1, L2, etc.)
}

export function BossPerformanceTrends({
  selectedGuild,
  selectedSeason,
  className = '',
  bossFilter,
  levelFilter
}: BossPerformanceTrendsProps) {
  const [sortBy, setSortBy] = useState<
    'problems' | 'damage' | 'tokens' | 'duration'
  >('problems')
  const [targetFilter, setTargetFilter] = useState<TargetFilter>('all')
  const [isLoopTableOpen, setIsLoopTableOpen] = useState(false)
  const [expandedLoopIndex, setExpandedLoopIndex] = useState<number | null>(
    null
  )
  const [expandedBosses, setExpandedBosses] = useState<Set<string>>(new Set())

  const toggleBossExpansion = (bossId: string) => {
    const newExpanded = new Set(expandedBosses)
    if (newExpanded.has(bossId)) {
      newExpanded.delete(bossId)
    } else {
      newExpanded.add(bossId)
    }
    setExpandedBosses(newExpanded)
  }

  const { start: startCalc, end: endCalc } = usePerformanceMonitor(
    'BossPerformanceTrends.calculation'
  )

  const { data: bossPerformanceData, isLoading } = useBossPerformanceMetrics(
    selectedGuild,
    selectedSeason,
    { enabled: !!selectedGuild && !!selectedSeason }
  )

  const { data: bossTimeData } = useBossDifficultyAnalysis(
    selectedGuild,
    selectedSeason,
    ['Legendary', 'Mythic'],
    { enabled: !!selectedGuild && !!selectedSeason }
  )

  const { data: damageByLoopData } = useDamageByBossLoop(
    selectedGuild,
    selectedSeason,
    { enabled: !!selectedGuild && !!selectedSeason }
  )

  const { data: tokenByLoopData } = useTokenUsageByLoop(
    selectedGuild,
    selectedSeason,
    { enabled: !!selectedGuild && !!selectedSeason }
  )

  const bossMetrics = useMemo<BossMetrics[]>(() => {
    startCalc() // Start performance timing

    if (!bossPerformanceData || !Array.isArray(bossPerformanceData)) {
      endCalc()
      return []
    }

    const historicalSamplesByBoss = new Map<string, BossHistoricalSample[]>()
    if (Array.isArray(damageByLoopData?.detailedData)) {
      for (const sample of damageByLoopData.detailedData) {
        const durationMinutes =
          sample.startTime && sample.endTime
            ? (new Date(sample.endTime).getTime() -
                new Date(sample.startTime).getTime()) /
              (1000 * 60)
            : null
        const normalizedSample: BossHistoricalSample = {
          damage: sample.avgDamage,
          tokenUsage: sample.hitCount,
          durationMinutes,
          loopIndex: sample.loop
        }
        const existing = historicalSamplesByBoss.get(sample.bossName)
        if (existing) {
          existing.push(normalizedSample)
        } else {
          historicalSamplesByBoss.set(sample.bossName, [normalizedSample])
        }
      }
    }

    const sorted = bossPerformanceData
      .filter((boss) => {
        if (!bossFilter) {
          if (targetFilter === 'bosses') return (boss.encounterId ?? 0) === 0
          if (targetFilter === 'primes') return (boss.encounterId ?? 0) > 0
        }

        if (levelFilter) {
          const level =
            boss.rarity === 'Mythic'
              ? `M${(boss.set || 0) + 1}`
              : `L${(boss.set || 0) + 1}`
          if (level !== levelFilter) {
            return false
          }
        }

        return true // Show if passes all filters
      })
      .map((boss) => {
        const bossName = String(boss.bossName || boss.Name || 'TempBoss')
        const isTarget: 'boss' | 'prime' =
          boss.encounterId === 0 ? 'boss' : 'prime'
        const level =
          boss.rarity === 'Mythic'
            ? `M${(boss.set || 0) + 1}`
            : `L${(boss.set || 0) + 1}`

        const averageDamagePerHit = boss.avgDamage || 0
        const hitCount = boss.hitCount || 0 // Number of tokens/hits used
        const totalDamage = boss.totalDamage || 0
        const maxDamage = boss.maxDamage || 0 // Highest single hit damage

        const bossTimeInfo = Array.isArray(bossTimeData)
          ? bossTimeData.find(
              (timeEntry) =>
                timeEntry.name === bossName &&
                timeEntry.rarity === boss.rarity &&
                timeEntry.set === boss.set &&
                timeEntry.encounterId === boss.encounterId
            )
          : null

        const averageTimeToKill =
          bossTimeInfo?.timeMinutes && bossTimeInfo.completedLoops > 0
            ? bossTimeInfo.timeMinutes
            : null

        const lastLoopTimeToKill = null

        const avgDamagePerHour =
          averageTimeToKill !== null && averageTimeToKill > 0
            ? (averageDamagePerHit * hitCount * 60) / averageTimeToKill // Convert minutes to hours
            : null

        const tokenEfficiency = averageDamagePerHit

        const damageEfficiencyPct =
          maxDamage > 0 ? (averageDamagePerHit / maxDamage) * 100 : 0
        const isLowDamage = damageEfficiencyPct < 60 // Less than 60% of max hit
        const isHighDamage = damageEfficiencyPct >= 80 // 80%+ of max hit
        const isHighTokenUsage = hitCount > 50
        const isInefficient = tokenEfficiency < 15000 // Less than 15k damage per token

        // Real loop trends would need damage_by_boss_loop data.
        const hasPerformanceIssues =
          isLowDamage || isHighTokenUsage || isInefficient
        const hasSevereIssues = isLowDamage && isHighTokenUsage

        const timeTrend: TrendDirection =
          isHighDamage && !isHighTokenUsage
            ? 'improving'
            : hasSevereIssues
              ? 'declining'
              : 'stable'

        const tokenTrend: TrendDirection = isInefficient
          ? 'declining'
          : tokenEfficiency > 25000
            ? 'improving'
            : 'stable'

        const durationChangeValue =
          lastLoopTimeToKill !== null &&
          averageTimeToKill !== null &&
          averageTimeToKill > 0
            ? ((lastLoopTimeToKill - averageTimeToKill) / averageTimeToKill) *
              100
            : 0
        const durationTrend: TrendDirection =
          durationChangeValue < -10
            ? 'improving' // Getting faster
            : durationChangeValue > 10
              ? 'declining'
              : 'stable' // Getting slower

        // Placeholder until loop data is connected.
        const timeChange = hasSevereIssues ? 15 : hasPerformanceIssues ? 2 : -8
        const tokenChange = isInefficient
          ? 12
          : tokenEfficiency > 25000
            ? -10
            : 0

        const problemSeverity: 'low' | 'medium' | 'high' =
          isLowDamage && isHighTokenUsage
            ? 'high'
            : isLowDamage || isHighTokenUsage
              ? 'medium'
              : 'low'

        const variance =
          hitCount > 0
            ? ((maxDamage - averageDamagePerHit) / averageDamagePerHit) * 100
            : 0

        const historicalSamples =
          historicalSamplesByBoss.get(`${level} ${bossName}`) ?? []
        const mlInsight = buildBossMlInsight({
          bossId: `${level}-${bossName}-${boss.encounterId ?? 0}`,
          averageDamagePerHit,
          hitCount,
          averageTimeToKill,
          historicalSamples
        })

        const enhancedMetrics =
          mlInsight.source === 'insufficient_data'
            ? {}
            : {
                consistencyScore: mlInsight.consistencyScore,
                trendAnalysis: mlInsight.trendAnalysis,
                performanceStats: mlInsight.performanceStats,
                hasAnomalies: mlInsight.hasAnomalies,
                riskLevel: mlInsight.riskLevel
              }

        return {
          name: bossName,
          level,
          averageDamagePerHit,
          hitCount,
          totalDamage,
          maxDamage,
          tokenEfficiency,
          damageEfficiencyPct,
          averageTimeToKill,
          lastLoopTimeToKill,
          avgDamagePerHour,
          timeTrend,
          tokenTrend,
          durationTrend,
          timeChange,
          tokenChange,
          durationChange: durationChangeValue,
          problemSeverity,
          variance: Math.min(variance, 100), // Cap at 100%
          isTarget,
          encounterId: boss.encounterId || 0, // Store encounterId for sorting
          ...enhancedMetrics
        }
      })
      .sort((a, b) => {
        if (a.encounterId !== b.encounterId) {
          return a.encounterId - b.encounterId // Ascending: 0, 1, 2, etc.
        }

        switch (sortBy) {
          case 'problems': {
            const severityOrder = { high: 3, medium: 2, low: 1 }
            const severityDiff =
              severityOrder[b.problemSeverity] -
              severityOrder[a.problemSeverity]
            if (severityDiff !== 0) return severityDiff
            return a.averageDamagePerHit - b.averageDamagePerHit // Lower damage first for problems
          }
          case 'damage':
            return b.averageDamagePerHit - a.averageDamagePerHit
          case 'tokens':
            return a.hitCount - b.hitCount
          case 'duration':
            if (a.averageTimeToKill === null && b.averageTimeToKill === null)
              return 0
            if (a.averageTimeToKill === null) return 1
            if (b.averageTimeToKill === null) return -1
            return a.averageTimeToKill - b.averageTimeToKill
          default:
            return 0
        }
      })

    endCalc() // End performance timing
    return sorted
  }, [
    bossPerformanceData,
    bossTimeData,
    sortBy,
    targetFilter,
    bossFilter,
    levelFilter,
    damageByLoopData,
    startCalc,
    endCalc
  ])

  const loopMetrics = useMemo(() => {
    if (!damageByLoopData?.data || !tokenByLoopData || !bossMetrics.length)
      return []

    // Keyed by "Level Name".
    const metricsMap = new Map<string, BossMetrics>()
    bossMetrics.forEach((b) => metricsMap.set(`${b.level} ${b.name}`, b))

    const calculatedLoops = damageByLoopData.data
      .map((loopData) => {
        const loopIndex = loopData.loop
        const tokenData = tokenByLoopData[loopIndex]

        if (!tokenData) return null

        let totalDamage = 0
        let bossCount = 0

        const problemBossesList: Array<{
          name: string
          damage: number
          efficiency: number
        }> = []
        const performingWellList: Array<{
          name: string
          damage: number
          efficiency: number
        }> = []

        Object.entries(loopData).forEach(([key, value]) => {
          if (key === 'loop' || key === 'All Primes' || value === null) return

          const bossMetric = metricsMap.get(key)
          const maxDamage = bossMetric?.maxDamage || 0

          const damage = value as number
          totalDamage += damage
          bossCount++

          if (maxDamage > 0) {
            const efficiency = (damage / maxDamage) * 100
            if (efficiency < 60) {
              problemBossesList.push({ name: key, damage, efficiency })
            }
            if (efficiency >= 80) {
              performingWellList.push({ name: key, damage, efficiency })
            }
          }
        })

        const avgDamagePerHit = bossCount > 0 ? totalDamage / bossCount : 0
        const totalTokens = (tokenData.bosses || 0) + (tokenData.primes || 0)
        const avgTokensPerBoss = bossCount > 0 ? totalTokens / bossCount : 0

        return {
          loopIndex,
          problemCount: problemBossesList.length,
          performingWellCount: performingWellList.length,
          avgTokensPerBoss,
          avgDamagePerHit,
          problemBossesList,
          performingWellList
        }
      })
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort((a, b) => a.loopIndex - b.loopIndex)

    return calculatedLoops.map((loop, index) => {
      const prevLoop = calculatedLoops[index - 1]

      const calculateTrend = (
        current: number,
        prev: number,
        lowerIsBetter: boolean = false
      ): TrendDirection => {
        if (!prev) return 'stable'
        const diff = ((current - prev) / prev) * 100
        if (Math.abs(diff) < 5) return 'stable'
        if (lowerIsBetter) {
          return diff < 0 ? 'improving' : 'declining'
        }
        return diff > 0 ? 'improving' : 'declining'
      }

      return {
        ...loop,
        trends: {
          problemCount: prevLoop
            ? calculateTrend(loop.problemCount, prevLoop.problemCount, true)
            : 'stable',
          performingWellCount: prevLoop
            ? calculateTrend(
                loop.performingWellCount,
                prevLoop.performingWellCount,
                false
              )
            : 'stable',
          avgTokensPerBoss: prevLoop
            ? calculateTrend(
                loop.avgTokensPerBoss,
                prevLoop.avgTokensPerBoss,
                true
              )
            : 'stable',
          avgDamagePerHit: prevLoop
            ? calculateTrend(
                loop.avgDamagePerHit,
                prevLoop.avgDamagePerHit,
                false
              )
            : 'stable'
        } as Record<string, TrendDirection>
      }
    })
  }, [damageByLoopData, tokenByLoopData, bossMetrics])

  const getDetailedLoopStats = (bossName: string, level: string) => {
    if (!damageByLoopData?.detailedData) return []

    const fullBossName = `${level} ${bossName}`

    const stats = damageByLoopData.detailedData
      .filter((d) => d.bossName === fullBossName)
      .sort((a, b) => a.loop - b.loop)

    return stats.map((stat, index) => {
      const prev = stats[index - 1]
      const trend: TrendDirection = !prev
        ? 'stable'
        : stat.avgDamage > prev.avgDamage * 1.05
          ? 'improving'
          : stat.avgDamage < prev.avgDamage * 0.95
            ? 'declining'
            : 'stable'

      return {
        ...stat,
        trend,
        durationMinutes:
          stat.startTime && stat.endTime
            ? (new Date(stat.endTime).getTime() -
                new Date(stat.startTime).getTime()) /
              (1000 * 60)
            : null
      }
    })
  }

  if (isLoading) {
    return (
      <div className={`card-wh40k p-4 ${className}`}>
        <h3 className="subheading-wh40k mb-4">Boss Performance Trends</h3>
        <div className="animate-pulse space-y-3">
          {['a', 'b', 'c', 'd', 'e', 'f'].map((id) => (
            <div
              key={`boss-trend-skeleton-${id}`}
              className="h-16 bg-card/50 rounded-sm"
            ></div>
          ))}
        </div>
      </div>
    )
  }

  if (!bossMetrics.length) {
    return (
      <div className={`card-wh40k p-4 ${className}`}>
        <h3 className="subheading-wh40k mb-4">Boss Performance Trends</h3>
        <div className="text-center py-8 text-secondary-wh40k">
          No boss performance data available for this season
        </div>
      </div>
    )
  }

  const problemBosses = bossMetrics.filter(
    (boss) => boss.problemSeverity === 'high'
  ).length
  const improvingBosses = bossMetrics.filter(
    (boss) => boss.problemSeverity === 'low'
  ).length
  const averageTokensPerBoss = bossMetrics.length
    ? bossMetrics.reduce((sum, boss) => sum + boss.hitCount, 0) /
      bossMetrics.length
    : 0
  const averageDamagePerHitAcross = bossMetrics.length
    ? bossMetrics.reduce((sum, boss) => sum + boss.averageDamagePerHit, 0) /
      bossMetrics.length
    : 0
  const averageEfficiencyPct = bossMetrics.length
    ? bossMetrics.reduce((sum, boss) => sum + boss.damageEfficiencyPct, 0) /
      bossMetrics.length
    : 0

  return (
    <div
      className={`card-wh40k p-4 hover:shadow-xl hover:shadow-[color-mix(in_srgb,var(--primary)_20%,transparent)] hover:border-[color-mix(in_srgb,var(--primary)_60%,transparent)] transition-all duration-300 ${className}`}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="subheading-wh40k">
            Boss Performance Analysis
            {(bossFilter || levelFilter) && (
              <span className="text-sm font-normal text-(--accent) ml-2">
                {levelFilter && `• ${levelFilter}`}
                {bossFilter && `• ${bossFilter}`}
              </span>
            )}
          </h3>
          <Tooltip
            content={`Real-time analysis of boss performance using current season damage and token data. Shows which bosses are underperforming and need attention.${bossFilter ? ' Currently showing both main boss and prime encounters for the selected boss.' : ''}`}
          >
            <HelpCircle className="h-4 w-4 text-secondary-wh40k cursor-help" />
          </Tooltip>
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-2 sm:mt-0">
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="text-xs sm:text-sm text-secondary-wh40k">Show:</div>
            <select
              value={targetFilter}
              onChange={(e) => setTargetFilter(e.target.value as TargetFilter)}
              disabled={!!bossFilter}
              className={`px-2 py-1 text-xs bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k ${bossFilter ? 'opacity-50 cursor-not-allowed' : ''}`}
              title={
                bossFilter
                  ? 'Target filter disabled when boss filter is active - showing both main boss and primes'
                  : ''
              }
            >
              <option value="all">
                {bossFilter ? 'Boss + Primes' : 'All Targets'}
              </option>
              <option value="bosses">Bosses Only</option>
              <option value="primes">Primes Only</option>
            </select>
          </div>
          <div className="flex items-center gap-1 sm:gap-2">
            <div className="text-xs sm:text-sm text-secondary-wh40k">
              Sort by:
            </div>
            <select
              value={sortBy}
              onChange={(e) =>
                setSortBy(
                  e.target.value as
                    'problems' | 'damage' | 'tokens' | 'duration'
                )
              }
              className="px-2 py-1 text-xs bg-(--card-bg) border border-(--card-border) rounded-sm text-primary-wh40k"
            >
              <option value="problems">Performance Issues</option>
              <option value="damage">Damage Efficiency</option>
              <option value="tokens">Token Usage</option>
              <option value="duration">Time to Kill</option>
            </select>
          </div>
        </div>
      </div>

      {/* Summary Stats */}
      <BossPerformanceSummaryStats
        problemBosses={problemBosses}
        improvingBosses={improvingBosses}
        averageTokensPerBoss={averageTokensPerBoss}
        averageDamagePerHitAcross={averageDamagePerHitAcross}
        averageEfficiencyPct={averageEfficiencyPct}
        isLoopTableOpen={isLoopTableOpen}
        setIsLoopTableOpen={setIsLoopTableOpen}
      />

      {/* Loop Analysis Table */}
      {isLoopTableOpen && loopMetrics.length > 0 && (
        <BossPerformanceLoopTable
          loopMetrics={loopMetrics}
          expandedLoopIndex={expandedLoopIndex}
          setExpandedLoopIndex={setExpandedLoopIndex}
        />
      )}

      {/* Boss Performance List */}
      <BossPerformanceBossList
        bossMetrics={bossMetrics}
        expandedBosses={expandedBosses}
        toggleBossExpansion={toggleBossExpansion}
        getDetailedLoopStats={getDetailedLoopStats}
      />
    </div>
  )
}
