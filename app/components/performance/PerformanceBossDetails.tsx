'use client'

import {
  formatDamage,
  formatNumber,
  formatPercentageDiff
} from '@tacticus/app-core/formatters'
import { getBossDisplayName } from '@/app/lib/resolvers/boss-identity'
import type {
  BossPerformanceFilter,
  CompareMode,
  PreparedPerformanceBossStat
} from '@/app/components/performance/types'

interface PerformanceBossDetailsProps {
  showBossDetail: boolean
  bossDetailTypes: string[]
  bossDetailSearch: string
  onBossDetailSearchChange: (value: string) => void
  selectedBossType: string
  onSelectedBossTypeChange: (value: string) => void
  bossPerformanceFilter: BossPerformanceFilter
  onBossPerformanceFilterChange: (value: BossPerformanceFilter) => void
  bossMinBattles: number
  onBossMinBattlesChange: (value: number) => void
  displayedBossStats: PreparedPerformanceBossStat[]
  totalBossRows: number
  hasBossFiltersActive: boolean
  resetBossDetailFilters: () => void
  compareMode: CompareMode
  getTextColor: (value: number) => string
  hasCluster?: boolean
}

export function PerformanceBossDetails({
  showBossDetail,
  bossDetailTypes,
  bossDetailSearch,
  onBossDetailSearchChange,
  selectedBossType,
  onSelectedBossTypeChange,
  bossPerformanceFilter,
  onBossPerformanceFilterChange,
  bossMinBattles,
  onBossMinBattlesChange,
  displayedBossStats,
  totalBossRows,
  hasBossFiltersActive,
  resetBossDetailFilters,
  compareMode,
  getTextColor,
  hasCluster = true
}: PerformanceBossDetailsProps) {
  if (!showBossDetail || totalBossRows === 0) {
    return null
  }

  return (
    <div className="card-wh40k p-4">
      <h3 className="heading-wh40k">Boss-by-Boss Performance Detail</h3>

      <div className="mt-4 space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="boss-detail-search"
              className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]"
            >
              Quick Filter
            </label>
            <input
              id="boss-detail-search"
              type="text"
              value={bossDetailSearch}
              onChange={(event) => onBossDetailSearchChange(event.target.value)}
              placeholder="Search player or boss"
              className="input-wh40k text-xs"
            />
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="boss-detail-type"
              className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]"
            >
              Type
            </label>
            <select
              id="boss-detail-type"
              value={selectedBossType}
              onChange={(event) => onSelectedBossTypeChange(event.target.value)}
              className="input-wh40k text-xs"
            >
              <option value="all">All Types</option>
              {bossDetailTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="boss-detail-performance"
              className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]"
            >
              Performance
            </label>
            <select
              id="boss-detail-performance"
              value={bossPerformanceFilter}
              onChange={(event) =>
                onBossPerformanceFilterChange(
                  event.target.value as BossPerformanceFilter
                )
              }
              className="input-wh40k text-xs"
            >
              <option value="all">All Performance</option>
              <option value="positive">Above Average</option>
              <option value="negative">Below Average</option>
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label
              htmlFor="boss-detail-min-battles"
              className="text-xs font-semibold uppercase tracking-wide text-[var(--text-tertiary)]"
            >
              Minimum Battles
            </label>
            <select
              id="boss-detail-min-battles"
              value={String(bossMinBattles)}
              onChange={(event) =>
                onBossMinBattlesChange(Number(event.target.value))
              }
              className="input-wh40k text-xs"
            >
              <option value="0">All Battles</option>
              <option value="2">2+ Battles</option>
              <option value="3">3+ Battles</option>
              <option value="5">5+ Battles</option>
            </select>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <span className="text-xs text-secondary-wh40k">
            {`${formatNumber(displayedBossStats.length)} of ${formatNumber(totalBossRows)} rows shown`}
          </span>
          <button
            type="button"
            onClick={resetBossDetailFilters}
            disabled={!hasBossFiltersActive}
            className={`px-3 py-2 text-xs font-medium rounded border border-primary-wh40k transition-colors duration-200 ${
              hasBossFiltersActive
                ? 'text-primary-wh40k hover:text-accent-wh40k hover:border-accent-wh40k'
                : 'text-secondary-wh40k opacity-60 cursor-not-allowed'
            }`}
          >
            Reset filters
          </button>
        </div>

        <p className="mt-3 text-xs text-secondary-wh40k">
          Both performance columns show percentage difference; the selection
          under &quot;Compare Against&quot; controls sorting, filtering, and
          which column is emphasized.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="table-wh40k">
          <thead>
            <tr>
              <th>Player</th>
              <th>Boss</th>
              <th>Type</th>
              <th className="text-right">Battles</th>
              <th className="text-right">Avg Damage</th>
              <th className="text-right">Weighted Contrib</th>
              {hasCluster && <th className="text-right">Vs Cluster</th>}
              <th className="text-right">Vs Guild</th>
            </tr>
          </thead>
          <tbody>
            {displayedBossStats.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="py-6 text-center text-sm text-secondary-wh40k"
                >
                  No boss records match the current filters.
                </td>
              </tr>
            ) : (
              displayedBossStats.map((stat) => {
                const typeLabel = stat.detailType
                const clusterPerformance =
                  typeof stat.vs_cluster_pct === 'number' &&
                  !Number.isNaN(stat.vs_cluster_pct)
                    ? stat.vs_cluster_pct
                    : null
                const guildPerformance =
                  typeof stat.vs_guild_pct === 'number' &&
                  !Number.isNaN(stat.vs_guild_pct)
                    ? stat.vs_guild_pct
                    : null
                const clusterActive =
                  compareMode === 'cluster' || compareMode === 'cluster-boss'
                const guildActive =
                  compareMode === 'guild' || compareMode === 'guild-boss'

                return (
                  <tr
                    key={`boss-perf-${stat.displayName}-${stat.boss_name}-${stat.detailType}`}
                  >
                    <td className="font-medium">{stat.displayName}</td>
                    <td>{getBossDisplayName(stat.boss_name)}</td>
                    <td className="text-xs">{typeLabel}</td>
                    <td className="text-right">{stat.battle_count}</td>
                    <td className="text-right">
                      {formatDamage(stat.player_avg, 2)}
                    </td>
                    <td className="text-right">
                      {formatDamage(stat.weighted_contribution, 2)}
                    </td>
                    {hasCluster && (
                      <td
                        className={`text-right ${
                          clusterPerformance !== null
                            ? getTextColor(clusterPerformance)
                            : 'text-secondary-wh40k'
                        } ${clusterActive ? 'font-semibold' : ''}`}
                      >
                        {clusterPerformance !== null
                          ? formatPercentageDiff(clusterPerformance, 0)
                          : '-'}
                      </td>
                    )}
                    <td
                      className={`text-right ${
                        guildPerformance !== null
                          ? getTextColor(guildPerformance)
                          : 'text-secondary-wh40k'
                      } ${guildActive ? 'font-semibold' : ''}`}
                    >
                      {guildPerformance !== null
                        ? formatPercentageDiff(guildPerformance, 0)
                        : '-'}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
