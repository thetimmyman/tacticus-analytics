'use client'

import {
  AlertTriangle,
  BarChart3,
  ChevronRight,
  ChevronUp,
  Clock,
  Target,
  TrendingUp as TrendingUpAlt
} from 'lucide-react'
import {
  formatDamage,
  formatDuration,
  formatNumber,
  formatPercentage
} from '@tacticus/app-core/formatters'
import { ChartErrorBoundary } from '@/app/components/error'
import type { DamageByBossLoopResult } from '@/app/lib/data/dashboard-calculations'
import {
  bossMetricTooltips,
  type TrendDirection
} from './boss-performance-tooltips'
import { type BossMetrics } from './boss-performance-trends-types'
import {
  getProblemSeverityColor,
  getTrendIcon
} from './boss-performance-trend-visuals'
import { Tooltip } from './BossPerformanceTrendsTooltip'

export type DetailedLoopStat =
  DamageByBossLoopResult['detailedData'][number] & {
    trend: TrendDirection
    durationMinutes: number | null
  }

export function BossPerformanceBossList({
  bossMetrics,
  expandedBosses,
  toggleBossExpansion,
  getDetailedLoopStats
}: {
  bossMetrics: BossMetrics[]
  expandedBosses: Set<string>
  toggleBossExpansion: (bossId: string) => void
  getDetailedLoopStats: (bossName: string, level: string) => DetailedLoopStat[]
}) {
  return (
    <ChartErrorBoundary chartName="Boss Performance Trends">
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {bossMetrics.map((boss) => {
          const isExpanded = expandedBosses.has(`${boss.level} ${boss.name}`)
          const detailedStats = isExpanded
            ? getDetailedLoopStats(boss.name, boss.level)
            : []

          return (
            <div
              key={`${boss.name}-${boss.level}`}
              className={`border-l-4 p-3 rounded-r-lg ${getProblemSeverityColor(boss.problemSeverity)} hover:bg-[var(--card-hover)] transition-colors`}
            >
              <div
                className="cursor-pointer"
                onClick={() =>
                  toggleBossExpansion(`${boss.level} ${boss.name}`)
                }
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="text-[var(--text-secondary)]">
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <div className="font-semibold text-[var(--text-primary)]">
                        {boss.level} {boss.name}
                      </div>
                      <div className="text-xs text-[var(--text-secondary)] flex items-center gap-4">
                        <Tooltip content="Total damage dealt to this boss across all encounters this season">
                          <span className="flex items-center gap-1 cursor-help">
                            <Clock className="h-3 w-3" />
                            Total:{' '}
                            {formatNumber(
                              boss.averageDamagePerHit * boss.hitCount,
                              0
                            )}
                          </span>
                        </Tooltip>
                        <Tooltip content="Number of tokens (attacks) used against this boss">
                          <span className="flex items-center gap-1 cursor-help">
                            <Target className="h-3 w-3" />
                            Tokens: {boss.hitCount}
                          </span>
                        </Tooltip>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 sm:gap-4 text-sm">
                    {/* Damage Efficiency */}
                    <Tooltip
                      content={bossMetricTooltips.damageEfficiency(boss)}
                    >
                      <div className="flex items-center gap-1 cursor-help">
                        {getTrendIcon(boss.timeTrend)}
                        <span
                          className={`font-mono text-xs sm:text-sm ${boss.timeTrend === 'declining' ? 'text-red-400' : boss.timeTrend === 'improving' ? 'text-green-400' : 'text-yellow-400'}`}
                        >
                          {formatDamage(boss.averageDamagePerHit)}
                        </span>
                      </div>
                    </Tooltip>

                    {/* Total Tokens Used - Hidden on mobile */}
                    <Tooltip content={bossMetricTooltips.tokenUsage(boss)}>
                      <div className="hidden sm:flex items-center gap-1 cursor-help">
                        {getTrendIcon(boss.tokenTrend)}
                        <span
                          className={`font-mono ${boss.tokenTrend === 'declining' ? 'text-red-400' : boss.tokenTrend === 'improving' ? 'text-green-400' : 'text-yellow-400'}`}
                        >
                          {boss.hitCount} tokens
                        </span>
                      </div>
                    </Tooltip>

                    {/* Damage per Hour - Hidden on mobile */}
                    <Tooltip content={bossMetricTooltips.damagePerHour(boss)}>
                      <div className="hidden sm:flex items-center gap-1 cursor-help">
                        <TrendingUpAlt
                          className={`h-4 w-4 ${boss.avgDamagePerHour === null ? 'text-[var(--text-secondary)]' : boss.avgDamagePerHour > 1000000 ? 'text-green-400' : boss.avgDamagePerHour > 500000 ? 'text-yellow-400' : 'text-red-400'}`}
                        />
                        <span
                          className={`font-mono text-xs ${boss.avgDamagePerHour === null ? 'text-[var(--text-secondary)]' : boss.avgDamagePerHour > 1000000 ? 'text-green-400' : boss.avgDamagePerHour > 500000 ? 'text-yellow-400' : 'text-red-400'}`}
                        >
                          {boss.avgDamagePerHour !== null
                            ? `${formatDamage(boss.avgDamagePerHour)}/h`
                            : 'N/A'}
                        </span>
                      </div>
                    </Tooltip>

                    {/* Performance Analytics Indicator */}
                    {boss.consistencyScore && (
                      <Tooltip content={bossMetricTooltips.analytics(boss)}>
                        <div className="cursor-help">
                          <BarChart3
                            className={`h-4 w-4 ${
                              boss.riskLevel === 'high'
                                ? 'text-red-400'
                                : boss.riskLevel === 'medium'
                                  ? 'text-yellow-400'
                                  : 'text-green-400'
                            }`}
                          />
                        </div>
                      </Tooltip>
                    )}

                    {/* Problem Indicator */}
                    <Tooltip content={bossMetricTooltips.priority(boss)}>
                      <div className="cursor-help">
                        {boss.problemSeverity === 'high' && (
                          <AlertTriangle className="h-4 w-4 text-red-400" />
                        )}
                        {boss.problemSeverity === 'medium' && (
                          <AlertTriangle className="h-4 w-4 text-yellow-400" />
                        )}
                      </div>
                    </Tooltip>
                  </div>
                </div>

                {/* Detailed Metrics */}
                <div className="mt-2 pt-2 border-t border-card-border/30">
                  <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 text-xs text-[var(--text-secondary)]">
                    <Tooltip content="Maximum single hit damage vs average damage - shows damage consistency and best performance">
                      <div className="cursor-help">
                        <div>Max Hit: {formatDamage(boss.maxDamage)}</div>
                        <div>
                          Avg Hit: {formatDamage(boss.averageDamagePerHit)}
                        </div>
                      </div>
                    </Tooltip>
                    <Tooltip content="Total hits/tokens used against this boss and total damage dealt">
                      <div className="cursor-help">
                        <div>Total Hits: {boss.hitCount}</div>
                        <div>Total Dmg: {formatDamage(boss.totalDamage)}</div>
                      </div>
                    </Tooltip>
                    <Tooltip content={bossMetricTooltips.timeToKill(boss)}>
                      <div className="cursor-help">
                        <div>
                          Avg Time:{' '}
                          {boss.averageTimeToKill !== null
                            ? formatDuration(boss.averageTimeToKill * 60)
                            : 'N/A'}
                        </div>
                        <div>
                          Last Loop:{' '}
                          {boss.lastLoopTimeToKill !== null
                            ? formatDuration(boss.lastLoopTimeToKill * 60)
                            : 'N/A'}
                        </div>
                      </div>
                    </Tooltip>
                    <Tooltip content={bossMetricTooltips.damagePerHour(boss)}>
                      <div className="cursor-help">
                        <div>
                          Dmg/Hour:{' '}
                          {boss.avgDamagePerHour !== null
                            ? formatDamage(boss.avgDamagePerHour)
                            : 'N/A'}
                        </div>
                        <div
                          className={`font-semibold ${boss.avgDamagePerHour !== null && boss.avgDamagePerHour > 1000000 ? 'text-green-400' : boss.avgDamagePerHour !== null && boss.avgDamagePerHour > 500000 ? 'text-yellow-400' : 'text-red-400'}`}
                        >
                          {boss.avgDamagePerHour !== null
                            ? boss.avgDamagePerHour > 1000000
                              ? 'HIGH'
                              : boss.avgDamagePerHour > 500000
                                ? 'MODERATE'
                                : 'LOW'
                            : 'NO DATA'}
                        </div>
                      </div>
                    </Tooltip>
                    {boss.consistencyScore ? (
                      <Tooltip
                        content={`Performance consistency analysis: ${boss.consistencyScore.description}. Score based on damage variation patterns over multiple encounters.`}
                      >
                        <div className="cursor-help">
                          <div>
                            Consistency: {boss.consistencyScore.score}/100
                          </div>
                          <div
                            className={`font-semibold ${
                              boss.consistencyScore.rating === 'excellent'
                                ? 'text-green-400'
                                : boss.consistencyScore.rating === 'good'
                                  ? 'text-blue-400'
                                  : boss.consistencyScore.rating === 'fair'
                                    ? 'text-yellow-400'
                                    : 'text-red-400'
                            }`}
                          >
                            {boss.consistencyScore.rating.toUpperCase()}
                          </div>
                        </div>
                      </Tooltip>
                    ) : (
                      <Tooltip content="Performance variance - lower is more consistent">
                        <div className="cursor-help">
                          <div>
                            Variance: {formatPercentage(boss.variance / 100, 0)}
                          </div>
                          <div>
                            Consistency:{' '}
                            {boss.variance < 20
                              ? 'High'
                              : boss.variance < 50
                                ? 'Medium'
                                : 'Low'}
                          </div>
                        </div>
                      </Tooltip>
                    )}
                    {boss.trendAnalysis && (
                      <Tooltip
                        content={`Statistical trend analysis: ${boss.trendAnalysis.direction} trend with ${boss.trendAnalysis.strength} strength (${Math.round(boss.trendAnalysis.confidence)}% confidence)`}
                      >
                        <div className="cursor-help">
                          <div>Trend: {boss.trendAnalysis.direction}</div>
                          <div
                            className={`font-semibold ${
                              boss.trendAnalysis.direction === 'improving'
                                ? 'text-green-400'
                                : boss.trendAnalysis.direction === 'declining'
                                  ? 'text-red-400'
                                  : 'text-yellow-400'
                            }`}
                          >
                            {Math.round(boss.trendAnalysis.confidence)}% sure
                          </div>
                        </div>
                      </Tooltip>
                    )}
                    <div>
                      <div
                        className={`font-semibold ${
                          boss.problemSeverity === 'high'
                            ? 'text-red-400'
                            : boss.problemSeverity === 'medium'
                              ? 'text-yellow-400'
                              : 'text-green-400'
                        }`}
                      >
                        {boss.problemSeverity.toUpperCase()} PRIORITY
                      </div>
                      <div className="text-xs">
                        {boss.problemSeverity === 'high'
                          ? 'Needs Attention'
                          : boss.problemSeverity === 'medium'
                            ? 'Room for Improvement'
                            : 'Performing Well'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Loop Details Table */}
              {isExpanded && detailedStats.length > 0 && (
                <div
                  className="mt-4 overflow-x-auto animate-in fade-in slide-in-from-top-2 duration-200"
                  onClick={(e) => e.stopPropagation()}
                >
                  <table className="w-full text-xs text-left border-collapse bg-card/30 rounded-lg">
                    <thead className="text-[var(--text-secondary)] uppercase bg-card/50">
                      <tr>
                        <th className="px-3 py-2">Loop</th>
                        <th className="px-3 py-2 text-right">Max Hit</th>
                        <th className="px-3 py-2 text-right">Avg Hit</th>
                        <th className="px-3 py-2 text-right">Total Dmg</th>
                        <th className="px-3 py-2 text-right">Hits</th>
                        <th className="px-3 py-2 text-right">Duration</th>
                        <th className="px-3 py-2 text-center">Trend</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detailedStats.map((stat) => (
                        <tr
                          key={`loop-${stat.loop}`}
                          className="border-b border-card-border/30 hover:bg-[color-mix(in_srgb,var(--card-hover)_50%,transparent)] transition-colors"
                        >
                          <td className="px-3 py-2 font-medium">
                            Loop {stat.loop + 1}
                          </td>
                          <td className="px-3 py-2 text-right font-mono">
                            {formatDamage(stat.maxDamage)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-blue-400">
                            {formatDamage(stat.avgDamage)}
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-yellow-400">
                            {formatDamage(stat.totalDamage)}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {stat.hitCount}
                          </td>
                          <td className="px-3 py-2 text-right text-[var(--text-secondary)]">
                            {stat.durationMinutes
                              ? formatDuration(stat.durationMinutes * 60)
                              : '-'}
                          </td>
                          <td className="px-3 py-2 text-center">
                            <div className="flex items-center justify-center gap-1">
                              {getTrendIcon(stat.trend)}
                              <span
                                className={`
                                              text-[10px] uppercase font-semibold
                                              ${
                                                stat.trend === 'improving'
                                                  ? 'text-green-400'
                                                  : stat.trend === 'declining'
                                                    ? 'text-red-400'
                                                    : 'text-yellow-400'
                                              }
                                          `}
                              >
                                {stat.trend}
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </ChartErrorBoundary>
  )
}
