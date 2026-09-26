'use client'

import clsx from 'clsx'
import { formatNumber } from '@tacticus/app-core/formatters'

export interface BenchmarkData {
  damage_avg: number
  damage_p75: number
  damage_p90: number
  damage_max: number
  attack_count: number
  team_composition?: string
  meta_team?: string | null
}

export interface BenchmarkCardProps {
  benchmark: BenchmarkData | null
  userDamage?: number
  isPremium?: boolean
  showTeamInfo?: boolean
  compact?: boolean
  className?: string
}

function getPercentile(damage: number, benchmark: BenchmarkData): number {
  if (damage >= benchmark.damage_max) return 100
  if (damage >= benchmark.damage_p90) {
    return (
      90 +
      ((damage - benchmark.damage_p90) /
        (benchmark.damage_max - benchmark.damage_p90)) *
        10
    )
  }
  if (damage >= benchmark.damage_p75) {
    return (
      75 +
      ((damage - benchmark.damage_p75) /
        (benchmark.damage_p90 - benchmark.damage_p75)) *
        15
    )
  }
  if (damage >= benchmark.damage_avg) {
    return (
      50 +
      ((damage - benchmark.damage_avg) /
        (benchmark.damage_p75 - benchmark.damage_avg)) *
        25
    )
  }
  return (damage / benchmark.damage_avg) * 50
}

function getPercentileColor(percentile: number): string {
  if (percentile >= 90) return 'text-yellow-400'
  if (percentile >= 75) return 'text-purple-400'
  if (percentile >= 50) return 'text-blue-400'
  return 'text-[var(--text-secondary)]'
}

function getPercentileLabel(percentile: number): string {
  if (percentile >= 95) return 'Elite'
  if (percentile >= 90) return 'Excellent'
  if (percentile >= 75) return 'Above Average'
  if (percentile >= 50) return 'Average'
  if (percentile >= 25) return 'Below Average'
  return 'Needs Improvement'
}

export function BenchmarkCard({
  benchmark,
  userDamage,
  isPremium = false,
  showTeamInfo = false,
  compact = false,
  className
}: BenchmarkCardProps) {
  if (!benchmark) {
    return (
      <div
        className={clsx(
          'bg-card/50 rounded-lg p-4 text-center text-[var(--text-secondary)]',
          className
        )}
      >
        No benchmark data available
      </div>
    )
  }

  const percentile = userDamage
    ? Math.round(getPercentile(userDamage, benchmark))
    : null
  const vsAvg = userDamage
    ? ((userDamage - benchmark.damage_avg) / benchmark.damage_avg) * 100
    : null

  return (
    <div
      className={clsx(
        'bg-card/50 rounded-lg border border-[var(--card-border)]',
        compact ? 'p-3' : 'p-4',
        className
      )}
    >
      {showTeamInfo && benchmark.team_composition && (
        <div className="mb-3 pb-3 border-b border-[var(--card-border)]">
          <div className="text-sm text-[var(--text-secondary)]">
            Team Composition
          </div>
          <div className="text-white font-medium">
            {benchmark.team_composition}
          </div>
          {benchmark.meta_team && (
            <span className="inline-block mt-1 px-2 py-0.5 text-xs rounded bg-purple-500/20 text-purple-400">
              {benchmark.meta_team}
            </span>
          )}
        </div>
      )}

      {userDamage && percentile !== null && (
        <div className="mb-4 text-center">
          <div className="text-3xl font-bold">
            <span className={getPercentileColor(percentile)}>
              {formatNumber(userDamage)}
            </span>
          </div>
          <div
            className={clsx(
              'text-lg font-semibold',
              getPercentileColor(percentile)
            )}
          >
            Top {100 - percentile}% - {getPercentileLabel(percentile)}
          </div>
          {vsAvg !== null && (
            <div
              className={clsx(
                'text-sm',
                vsAvg >= 0 ? 'text-green-400' : 'text-red-400'
              )}
            >
              {vsAvg >= 0 ? '+' : ''}
              {Math.round(vsAvg)}% vs average
            </div>
          )}
        </div>
      )}

      <div className="space-y-2">
        <div className="flex justify-between items-center text-sm">
          <span className="text-[var(--text-secondary)]">Average</span>
          <span className="text-white font-medium">
            {formatNumber(Math.round(benchmark.damage_avg))}
          </span>
        </div>

        {isPremium ? (
          <>
            <div className="flex justify-between items-center text-sm">
              <span className="text-[var(--text-secondary)]">
                75th Percentile
              </span>
              <span className="text-blue-400 font-medium">
                {formatNumber(Math.round(benchmark.damage_p75))}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-[var(--text-secondary)]">
                90th Percentile
              </span>
              <span className="text-purple-400 font-medium">
                {formatNumber(Math.round(benchmark.damage_p90))}
              </span>
            </div>
            <div className="flex justify-between items-center text-sm">
              <span className="text-[var(--text-secondary)]">Max Recorded</span>
              <span className="text-yellow-400 font-medium">
                {formatNumber(benchmark.damage_max)}
              </span>
            </div>
          </>
        ) : (
          <div className="mt-2 p-2 bg-amber-500/10 border border-amber-500/30 rounded text-amber-400 text-xs text-center">
            Upgrade to Premium to see P75, P90, and Max benchmarks
          </div>
        )}

        <div className="pt-2 mt-2 border-t border-[var(--card-border)] flex justify-between items-center text-xs text-[var(--text-secondary)]">
          <span>Sample size</span>
          <span>{formatNumber(benchmark.attack_count)} attacks</span>
        </div>
      </div>
    </div>
  )
}
