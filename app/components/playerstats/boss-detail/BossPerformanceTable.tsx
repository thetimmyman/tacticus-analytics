'use client'

import { VS_GUILD_NA } from '@/app/components/playerstats/hooks/useGuildComparisonOverlay'
import { ChevronDown, ChevronRight } from 'lucide-react'
import {
  formatDamage,
  formatNumber,
  formatPercentageDiff
} from '@tacticus/app-core/formatters'
import { getBossLevelFromSetAndRarity } from '@/app/lib/catalogs/rarity-set'
import type { PlayerDamageByBossLoopResult } from '@/app/lib/data/dashboard-calculations'
import type { BossStatDetail } from '@/app/components/playerstats/types'
import { TrendBadge } from '@/app/components/ui/TrendBadge'
import { formatDuration } from './format-duration'

type BossLoopDetail = PlayerDamageByBossLoopResult['detailedData'][number] & {
  trend: 'improving' | 'declining' | 'stable'
  durationMinutes: number | null
}

interface BossPerformanceTableProps {
  title: string
  entries: [string, BossStatDetail][]
  expandedBosses: Set<string>
  toggleBossExpanded: (bossKey: string) => void
  getLoopDetailsForBoss: (bossName: string, level: string) => BossLoopDetail[]
  hasValidCluster: boolean
  guildLabel: string
}

export function BossPerformanceTable({
  title,
  entries,
  expandedBosses,
  toggleBossExpanded,
  getLoopDetailsForBoss,
  hasValidCluster,
  guildLabel
}: BossPerformanceTableProps) {
  if (entries.length === 0) return null

  const sortedEntries = [...entries].sort(
    (a, b) => (b[1].damage ?? 0) - (a[1].damage ?? 0)
  )

  const guildRankLabel = (stats: BossStatDetail) =>
    stats.guildRank && stats.guildRank > 0 && stats.totalPlayersOnBossGuild
      ? `#${stats.guildRank}/${stats.totalPlayersOnBossGuild}`
      : '--'

  const clusterRankLabel = (stats: BossStatDetail) =>
    stats.clusterRank && stats.clusterRank > 0 && stats.totalPlayersOnBoss
      ? `#${stats.clusterRank}/${stats.totalPlayersOnBoss}`
      : '--'

  const renderCards = (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:hidden">
      {sortedEntries.map(([name, stats]) => {
        const displayName = name.split('_')[0]
        const guildRank = guildRankLabel(stats)
        const clusterRank = clusterRankLabel(stats)
        return (
          <div
            key={name}
            className="bg-[var(--card-bg)] border border-[var(--card-border)] rounded-lg p-3 space-y-2"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {getBossLevelFromSetAndRarity(
                    stats.set || 0,
                    stats.rarity || 'Legendary'
                  )}
                </div>
                <div className="text-sm font-semibold text-[var(--text-primary)]">
                  {displayName}
                </div>
              </div>
              {guildRank !== '--' || clusterRank !== '--' ? (
                <div className="text-right">
                  <div className="text-xs text-[var(--text-secondary)] uppercase tracking-wide">
                    Rank
                  </div>
                  <div className="text-sm font-semibold text-[var(--primary)]">
                    {clusterRank !== '--' ? clusterRank : guildRank}
                  </div>
                </div>
              ) : null}
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Damage
                </div>
                <div className="text-[var(--text-primary)]">
                  {formatDamage(stats.damage ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Avg Damage
                </div>
                <div className="text-[var(--text-primary)]">
                  {formatNumber(stats.avgDamage ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Tokens
                </div>
                <div className="text-[var(--text-primary)]">
                  {formatNumber(stats.tokens ?? stats.totalTokens ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Sweeps
                </div>
                <div className="text-[var(--text-primary)]">
                  {formatNumber(stats.sweeps ?? 0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Score
                </div>
                <div
                  className={
                    stats.vsGuildAvg === VS_GUILD_NA
                      ? 'text-[var(--text-secondary)]'
                      : (stats.vsGuildAvg ?? 0) >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                  }
                >
                  {stats.vsGuildAvg === VS_GUILD_NA
                    ? '—'
                    : (1 + (stats.vsGuildAvg ?? 0) / 100).toFixed(2)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-secondary)]">
                  {guildLabel}
                </div>
                <div
                  className={
                    stats.vsGuildAvg === VS_GUILD_NA
                      ? 'text-[var(--text-secondary)]'
                      : stats.vsGuildAvg >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                  }
                >
                  {stats.vsGuildAvg === VS_GUILD_NA
                    ? 'N/A'
                    : formatPercentageDiff(stats.vsGuildAvg ?? 0, 0)}
                </div>
              </div>
              <div>
                <div className="text-xs text-[var(--text-secondary)]">
                  Guild Rank
                </div>
                <div className="text-[var(--text-primary)]">{guildRank}</div>
              </div>
              {hasValidCluster && (
                <div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    vs Cluster
                  </div>
                  <div
                    className={
                      stats.vsClusterAvg >= 0
                        ? 'text-green-400'
                        : 'text-red-400'
                    }
                  >
                    {formatPercentageDiff(stats.vsClusterAvg ?? 0, 0)}
                  </div>
                </div>
              )}
              {hasValidCluster && (
                <div>
                  <div className="text-xs text-[var(--text-secondary)]">
                    Cluster Rank
                  </div>
                  <div className="text-[var(--text-primary)]">
                    {clusterRank}
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs text-[var(--text-secondary)]">
              <div>
                One-Shots:{' '}
                <span className="text-[var(--text-primary)]">
                  {formatNumber(stats.oneShots ?? 0)}
                </span>
              </div>
            </div>
          </div>
        )
      })}
    </div>
  )

  const colSpan = 10 + (hasValidCluster ? 2 : 0) + 1 // base cols (incl Score) + cluster cols + expand col

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-[var(--text-primary)]">
        {title}
      </h3>
      <div className="hidden lg:block">
        <div className="overflow-x-auto border border-[var(--card-border)] rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-[var(--card-bg)]">
              <tr className="text-left text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                <th className="px-2 py-2 w-8"></th>
                <th className="px-4 py-2">Boss</th>
                <th className="px-4 py-2">Level</th>
                <th className="px-4 py-2 text-right">Damage</th>
                <th className="px-4 py-2 text-right">Avg Damage</th>
                <th className="px-4 py-2 text-right">Tokens</th>
                <th className="px-4 py-2 text-right">Sweeps</th>
                <th className="px-4 py-2 text-right">One-Shots</th>
                <th
                  className="px-4 py-2 text-right"
                  title={`Token-equivalent score. 1.00 = ${guildLabel.replace('vs ', '')} average; >1 over-, <1 under-performing.`}
                >
                  Score
                </th>
                <th className="px-4 py-2 text-right">{guildLabel}</th>
                <th className="px-4 py-2 text-right">Guild Rank</th>
                {hasValidCluster && (
                  <th className="px-4 py-2 text-right">vs Cluster</th>
                )}
                {hasValidCluster && (
                  <th className="px-4 py-2 text-right">Cluster Rank</th>
                )}
              </tr>
            </thead>
            <tbody>
              {sortedEntries.map(([name, stats]) => {
                const displayName = name.split('_')[0] ?? name
                const level = getBossLevelFromSetAndRarity(
                  stats.set || 0,
                  stats.rarity || 'Legendary'
                )
                const guildRank = guildRankLabel(stats)
                const clusterRank = clusterRankLabel(stats)
                const bossKey = `${level} ${displayName}`
                const isExpanded = expandedBosses.has(bossKey)
                const loopDetails = isExpanded
                  ? getLoopDetailsForBoss(displayName, level)
                  : []

                return (
                  <>
                    <tr
                      key={name}
                      className="border-t border-card-border/60 cursor-pointer hover:bg-card/50 transition-colors"
                      onClick={() => toggleBossExpanded(bossKey)}
                    >
                      <td className="px-2 py-2 text-[var(--text-secondary)]">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </td>
                      <td className="px-4 py-2 text-[var(--text-primary)]">
                        {displayName}
                      </td>
                      <td className="px-4 py-2 text-[var(--text-secondary)]">
                        {level}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--text-primary)]">
                        {formatDamage(stats.damage ?? 0)}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--text-primary)]">
                        {formatNumber(stats.avgDamage ?? 0)}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--text-primary)]">
                        {formatNumber(stats.tokens ?? stats.totalTokens ?? 0)}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--text-primary)]">
                        {formatNumber(stats.sweeps ?? 0)}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--text-primary)]">
                        {formatNumber(stats.oneShots ?? 0)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right font-mono ${
                          stats.vsGuildAvg === VS_GUILD_NA
                            ? 'text-[var(--text-secondary)]'
                            : (stats.vsGuildAvg ?? 0) >= 0
                              ? 'text-green-400'
                              : 'text-red-400'
                        }`}
                        title={`Token-equivalent score. 1.00 = ${guildLabel.replace('vs ', '')} average.`}
                      >
                        {stats.vsGuildAvg === VS_GUILD_NA
                          ? '—'
                          : (1 + (stats.vsGuildAvg ?? 0) / 100).toFixed(2)}
                      </td>
                      <td
                        className={`px-4 py-2 text-right ${stats.vsGuildAvg === VS_GUILD_NA ? 'text-[var(--text-secondary)]' : stats.vsGuildAvg >= 0 ? 'text-green-400' : 'text-red-400'}`}
                      >
                        {stats.vsGuildAvg === VS_GUILD_NA
                          ? 'N/A'
                          : formatPercentageDiff(stats.vsGuildAvg ?? 0, 0)}
                      </td>
                      <td className="px-4 py-2 text-right text-[var(--text-primary)]">
                        {guildRank}
                      </td>
                      {hasValidCluster && (
                        <td
                          className={`px-4 py-2 text-right ${stats.vsClusterAvg >= 0 ? 'text-green-400' : 'text-red-400'}`}
                        >
                          {formatPercentageDiff(stats.vsClusterAvg ?? 0, 0)}
                        </td>
                      )}
                      {hasValidCluster && (
                        <td className="px-4 py-2 text-right text-[var(--text-primary)]">
                          {clusterRank}
                        </td>
                      )}
                    </tr>
                    {isExpanded && loopDetails.length > 0 && (
                      <tr key={`${name}-details`}>
                        <td colSpan={colSpan} className="p-0">
                          <div className="bg-card/30 px-4 py-3 animate-in fade-in slide-in-from-top-2 duration-200">
                            <table className="w-full text-xs border-collapse">
                              <thead className="text-[var(--text-secondary)] uppercase bg-card/50">
                                <tr>
                                  <th className="px-3 py-2 text-left">Loop</th>
                                  <th className="px-3 py-2 text-right">
                                    Max Hit
                                  </th>
                                  <th className="px-3 py-2 text-right">
                                    Avg Hit
                                  </th>
                                  <th className="px-3 py-2 text-right">
                                    Eff Avg
                                  </th>
                                  <th className="px-3 py-2 text-right">
                                    Total Dmg
                                  </th>
                                  <th className="px-3 py-2 text-right">Hits</th>
                                  <th className="px-3 py-2 text-right">
                                    Sweeps
                                  </th>
                                  <th className="px-3 py-2 text-right">
                                    1-Shots
                                  </th>
                                  <th className="px-3 py-2 text-right">
                                    Duration
                                  </th>
                                  <th
                                    className="px-3 py-2 text-right"
                                    title="Token-equivalent score for this loop. Compares the player's loop avg damage to the season-baseline guild avg damage on this boss."
                                  >
                                    Score
                                  </th>
                                  <th className="px-3 py-2 text-center">
                                    Trend
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {loopDetails.map((stat) => (
                                  <tr
                                    key={`loop-${stat.loop}`}
                                    className="border-b border-card-border/30 hover:bg-[color-mix(in_srgb,var(--card-hover)_50%,transparent)] transition-colors"
                                  >
                                    <td className="px-3 py-2 font-medium">
                                      Loop {stat.loop + 1}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono">
                                      {formatNumber(stat.maxDamage)}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-blue-400">
                                      {formatNumber(stat.avgDamage)}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-blue-300">
                                      {stat.effAvgDamage != null
                                        ? formatNumber(stat.effAvgDamage)
                                        : '-'}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono text-yellow-400">
                                      {formatNumber(stat.totalDamage)}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {stat.hitCount}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {stat.sweepCount > 0 ? (
                                        <span className="text-orange-400 font-semibold">
                                          {stat.sweepCount}
                                        </span>
                                      ) : (
                                        <span className="text-[var(--text-secondary)]">
                                          -
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right">
                                      {stat.oneShotCount > 0 ? (
                                        <span className="text-green-400 font-semibold">
                                          {stat.oneShotCount}
                                        </span>
                                      ) : (
                                        <span className="text-[var(--text-secondary)]">
                                          -
                                        </span>
                                      )}
                                    </td>
                                    <td className="px-3 py-2 text-right text-[var(--text-secondary)]">
                                      {stat.durationMinutes
                                        ? formatDuration(
                                            stat.durationMinutes * 60
                                          )
                                        : '-'}
                                    </td>
                                    <td className="px-3 py-2 text-right font-mono">
                                      {(() => {
                                        // Loop avg damage / season guild avg, with guild_avg = avgDamage / (1 + vsGuildAvg/100).
                                        // Same metric as /player-performance.
                                        if (
                                          stats.vsGuildAvg === VS_GUILD_NA ||
                                          !Number.isFinite(stats.avgDamage) ||
                                          (stats.avgDamage ?? 0) <= 0
                                        ) {
                                          return (
                                            <span className="text-[var(--text-secondary)]">
                                              —
                                            </span>
                                          )
                                        }
                                        const loopAvg = stat.avgDamage ?? 0
                                        const seasonGuildAvg =
                                          (stats.avgDamage ?? 0) /
                                          (1 + (stats.vsGuildAvg ?? 0) / 100)
                                        if (
                                          !Number.isFinite(seasonGuildAvg) ||
                                          seasonGuildAvg <= 0
                                        ) {
                                          return (
                                            <span className="text-[var(--text-secondary)]">
                                              —
                                            </span>
                                          )
                                        }
                                        const loopScore =
                                          loopAvg / seasonGuildAvg
                                        if (!Number.isFinite(loopScore)) {
                                          return (
                                            <span className="text-[var(--text-secondary)]">
                                              —
                                            </span>
                                          )
                                        }
                                        return (
                                          <span
                                            className={
                                              loopScore >= 1
                                                ? 'text-green-400'
                                                : 'text-red-400'
                                            }
                                            title={`Loop ${stat.loop + 1} damage-per-attack vs season guild baseline.`}
                                          >
                                            {loopScore.toFixed(2)}
                                          </span>
                                        )
                                      })()}
                                    </td>
                                    <td className="px-3 py-2 text-center">
                                      <TrendBadge trend={stat.trend} />
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                    {isExpanded && loopDetails.length === 0 && (
                      <tr key={`${name}-no-details`}>
                        <td colSpan={colSpan} className="p-0">
                          <div className="bg-card/30 px-4 py-3 text-xs text-[var(--text-secondary)] text-center">
                            No loop details available for this boss
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
      {renderCards}
    </div>
  )
}
