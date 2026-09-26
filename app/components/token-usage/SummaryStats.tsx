'use client'

import { memo, useMemo } from 'react'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { TotalStats, PlayerTokens } from './types'
import { formatShortDuration } from './utils'

interface SummaryStatsProps {
  totalStats: TotalStats
  totalTokensAvailable: number
  totalBurned: number
  /** Guild sum of overcapped (wasted) tokens. */
  totalOvercapped?: number
  players: PlayerTokens[]
  showBurned?: boolean
}

function SummaryStats({
  totalStats,
  totalTokensAvailable,
  totalBurned,
  totalOvercapped = 0,
  players,
  showBurned = false
}: SummaryStatsProps) {
  const dataSourceStats = useMemo(() => {
    const liveCount = players.filter((p) => p.dataSource === 'live').length
    const calculatedCount = players.filter(
      (p) => p.dataSource === 'calculated'
    ).length
    const defaultCount = players.filter(
      (p) => !p.dataSource || p.dataSource === 'default'
    ).length
    return { liveCount, calculatedCount, defaultCount }
  }, [players])

  const avgRegenSeconds = useMemo(() => {
    const playersWithRegen = players.filter(
      (p) =>
        p.tokenNextSeconds != null &&
        p.tokenNextSeconds > 0 &&
        (p.tokensAvailable ?? 0) < 3
    )
    if (playersWithRegen.length === 0) return null
    const totalSeconds = playersWithRegen.reduce(
      (sum, p) => sum + (p.tokenNextSeconds ?? 0),
      0
    )
    return Math.round(totalSeconds / playersWithRegen.length)
  }, [players])

  const cappedCount = useMemo(
    () => players.filter((p) => (p.tokensAvailable ?? 0) >= 3).length,
    [players]
  )

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4">
        <div className="stat-card-wh40k p-3 sm:p-4">
          <div className="stat-value-wh40k text-lg sm:text-2xl">
            {formatNumber(totalStats.totalTokens)}
          </div>
          <div className="stat-label-wh40k text-xs">Total Tokens</div>
        </div>
        <div className="stat-card-wh40k p-3 sm:p-4">
          <div className="stat-value-wh40k text-lg sm:text-2xl">
            {formatNumber(totalStats.maxTokens)}
          </div>
          <div className="stat-label-wh40k text-xs">Max by Player</div>
        </div>
        <div className="stat-card-wh40k p-3 sm:p-4">
          <div className="stat-value-wh40k text-lg sm:text-2xl">
            {formatNumber(totalStats.averageUsage, 1)}
          </div>
          <div className="stat-label-wh40k text-xs">Average Usage</div>
        </div>
        <div className="stat-card-wh40k p-3 sm:p-4">
          <div className="stat-value-wh40k text-lg sm:text-2xl">
            {formatNumber(totalStats.tokensAvailableAvg, 1)}
          </div>
          <div className="stat-label-wh40k text-xs">Avg Tokens Available</div>
        </div>
        <div className="stat-card-wh40k p-3 sm:p-4">
          <div className="stat-value-wh40k text-lg sm:text-2xl">
            {formatNumber(totalTokensAvailable)}
          </div>
          <div className="stat-label-wh40k text-xs">Total Tokens Available</div>
        </div>
        <div className="stat-card-wh40k p-3 sm:p-4">
          <div className="stat-value-wh40k text-lg sm:text-2xl">
            {formatNumber(totalStats.bombsAvailableCount)}
          </div>
          <div className="stat-label-wh40k text-xs">Bombs Ready (count)</div>
        </div>
        {showBurned && (
          <div className="stat-card-wh40k p-3 sm:p-4 relative group">
            <div className="stat-value-wh40k text-lg sm:text-2xl">
              {formatNumber(totalBurned)}
            </div>
            <div className="stat-label-wh40k text-xs flex items-center gap-1">
              Behind pace
              <span
                className="text-[var(--text-tertiary)] cursor-help"
                title="Tokens behind the guild's most active member — a participation proxy, not physical waste. Measured against the guild leader; matches the Discord /token-overview bot (+/- 1 uncertainty)."
              >
                ⓘ
              </span>
            </div>
            {avgRegenSeconds !== null && (
              <div className="text-[10px] text-[var(--text-tertiary)] mt-1">
                Avg regen: {formatShortDuration(avgRegenSeconds)}
              </div>
            )}
          </div>
        )}
        {showBurned && (
          <div className="stat-card-wh40k p-3 sm:p-4 relative group">
            <div className="stat-value-wh40k text-lg sm:text-2xl">
              {formatNumber(totalOvercapped)}
            </div>
            <div className="stat-label-wh40k text-xs flex items-center gap-1">
              Overcapped
              <span
                className="text-[var(--text-tertiary)] cursor-help"
                title="Tokens physically wasted by sitting at the 3/3 cap through a full 12h regen cycle. Unrecoverable."
              >
                ⓘ
              </span>
            </div>
          </div>
        )}
      </div>

      {showBurned && (
        <p className="text-[10px] sm:text-xs italic text-[var(--text-tertiary)]">
          Behind pace = tokens behind the guild&apos;s most active member
          (participation proxy). Overcapped = tokens physically wasted at the
          3/3 cap (unrecoverable).
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--text-secondary)] bg-card/50 rounded-lg px-3 py-2 border border-card-border/30">
        <span className="font-medium text-[var(--text-primary)]">
          Data Sources:
        </span>
        {dataSourceStats.liveCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            {dataSourceStats.liveCount} Live
          </span>
        )}
        {dataSourceStats.calculatedCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-yellow-500" />
            {dataSourceStats.calculatedCount} Estimated
          </span>
        )}
        {dataSourceStats.defaultCount > 0 && (
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-gray-500" />
            {dataSourceStats.defaultCount} Default
          </span>
        )}
        <span className="text-[var(--text-tertiary)] ml-auto">
          {cappedCount} capped (3/3)
        </span>
      </div>
    </div>
  )
}

export default memo(SummaryStats)
