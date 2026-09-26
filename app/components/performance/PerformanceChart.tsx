'use client'

import {
  formatPercentage,
  formatPercentageDiff
} from '@tacticus/app-core/formatters'
import type {
  CompareMode,
  PerformanceMode,
  PreparedPerformanceSummary
} from '@/app/components/performance/types'

interface PerformanceChartProps {
  compareMode: CompareMode
  performanceMode: PerformanceMode
  tokenModeActive: boolean
  showChartLines: boolean
  onToggleChartLines: () => void
  playerSummaries: PreparedPerformanceSummary[]
  chartMax: number
  getBarColor: (value: number) => string
  getTextColor: (value: number) => string
}

// Target Weighting shows raw scores as positive bars with a 1.0 reference line:
// an absolute vs-target metric, not a vs-peer percentage.
const TARGET_SCORE_MIN_MAX = 1.5 // stretch to actual data max above this floor

interface TargetScoreView {
  displayedScore: number
  displayText: string
  stateLabel: string
  barColor: string
  textColor: string
}

function getTargetScoreView(score: number): TargetScoreView {
  const displayedScore = Number.isFinite(score) ? Number(score.toFixed(2)) : NaN

  if (!Number.isFinite(displayedScore) || displayedScore <= 0) {
    return {
      displayedScore,
      displayText: '—',
      stateLabel: 'insufficient data',
      barColor: 'bg-[var(--card-border)]',
      textColor: 'text-secondary-wh40k'
    }
  }

  if (displayedScore > 1.1) {
    return {
      displayedScore,
      displayText: displayedScore.toFixed(2),
      stateLabel: 'well above target',
      barColor: 'bg-emerald-400',
      textColor: 'text-[var(--accent)]'
    }
  }

  if (displayedScore > 1.0) {
    return {
      displayedScore,
      displayText: displayedScore.toFixed(2),
      stateLabel: 'above target',
      barColor: 'bg-[var(--accent)]',
      textColor: 'text-[var(--accent)]'
    }
  }

  if (displayedScore === 1.0) {
    return {
      displayedScore,
      displayText: displayedScore.toFixed(2),
      stateLabel: 'on target',
      barColor: 'bg-[var(--accent)]',
      textColor: 'text-[var(--accent)]'
    }
  }

  if (displayedScore >= 0.95) {
    return {
      displayedScore,
      displayText: displayedScore.toFixed(2),
      stateLabel: 'near target',
      barColor: 'bg-yellow-400',
      textColor: 'text-amber-300'
    }
  }

  if (displayedScore >= 0.9) {
    return {
      displayedScore,
      displayText: displayedScore.toFixed(2),
      stateLabel: 'below target',
      barColor: 'bg-orange-400',
      textColor: 'text-amber-300'
    }
  }

  if (displayedScore >= 0.85) {
    return {
      displayedScore,
      displayText: displayedScore.toFixed(2),
      stateLabel: 'well below target',
      barColor: 'bg-red-500/80',
      textColor: 'text-red-400'
    }
  }

  return {
    displayedScore,
    displayText: displayedScore.toFixed(2),
    stateLabel: 'far below target',
    barColor: 'bg-red-600',
    textColor: 'text-red-400'
  }
}

export function PerformanceChart({
  compareMode,
  performanceMode,
  showChartLines,
  onToggleChartLines,
  playerSummaries,
  chartMax,
  getBarColor,
  getTextColor
}: PerformanceChartProps) {
  if (playerSummaries.length === 0) {
    return null
  }

  const isTargetMode = performanceMode === 'target-weighted'

  const compareLabel =
    compareMode === 'cluster'
      ? 'Cluster'
      : compareMode === 'cluster-boss'
        ? 'Cluster (Bosses Only)'
        : compareMode === 'guild'
          ? 'Guild'
          : compareMode === 'guild-boss'
            ? 'Guild (Bosses Only)'
            : 'Cluster'

  const titlePrefix =
    performanceMode === 'token-weighted'
      ? 'Token-Weighted Performance vs'
      : isTargetMode
        ? 'Target-Weighted Performance vs'
        : 'Weighted Average Performance vs'
  const titleSuffix = isTargetMode ? '(raw score; 1.0 = on target)' : '[%]'

  const sortedSummaries = [...playerSummaries].sort(
    (a, b) => b.performanceValue - a.performanceValue
  )

  // X-axis spans 0 → max(1.5, max score); the 1.0 line sits at (1 / xAxisMax) × 100%.
  const maxScore = isTargetMode
    ? sortedSummaries.reduce((m, p) => Math.max(m, p.performanceValue), 0)
    : 0
  const targetXAxisMax = Math.max(
    TARGET_SCORE_MIN_MAX,
    Math.ceil(maxScore * 10) / 10
  )
  const targetReferencePct = (1 / targetXAxisMax) * 100

  return (
    <div className="card-wh40k p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="heading-wh40k mb-0">
          {titlePrefix} {compareLabel} {titleSuffix}
        </h3>
        <button
          onClick={onToggleChartLines}
          className="flex items-center gap-1 text-xs px-2 py-1 rounded border border-gray-600 hover:border-gray-500 text-gray-400 hover:text-gray-300 transition-colors"
          title={showChartLines ? 'Hide lines' : 'Show lines'}
        >
          {showChartLines ? (
            <>
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h16M4 18h16"
                />
              </svg>
              <span>Hide Lines</span>
            </>
          ) : (
            <>
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 6h16M4 12h8"
                />
              </svg>
              <span>Show Lines</span>
            </>
          )}
        </button>
      </div>

      <div className="flex items-center gap-2 pb-2 border-b border-primary-wh40k mb-2">
        <div className="w-24 flex-shrink-0">
          <span className="text-xs font-medium text-accent-wh40k">Player</span>
        </div>
        <div className="flex-1 text-center">
          <span className="text-xs font-medium text-accent-wh40k">
            Performance Chart
          </span>
        </div>
        <div className="w-10 flex-shrink-0 text-center">
          <span className="text-xs font-medium text-accent-wh40k">
            {isTargetMode ? 'Score' : '%'}
          </span>
        </div>
      </div>

      <div className="space-y-0" role="list">
        {sortedSummaries.map((player, index) => {
          const value = player.performanceValue
          const isLast = index === sortedSummaries.length - 1

          if (isTargetMode) {
            const score = value
            const scoreView = getTargetScoreView(score)
            const barWidth = Math.min(100, (score / targetXAxisMax) * 100)
            return (
              <div
                key={
                  player.playerId
                    ? `player-${player.playerId}`
                    : `player-${player.displayName}-${index}`
                }
                className="flex items-center gap-2 py-0"
                role="listitem"
                aria-label={`${player.displayName}: target-weighted score ${scoreView.displayText}, ${scoreView.stateLabel}`}
                style={
                  !isLast && showChartLines
                    ? { borderBottom: '1px solid rgba(156, 163, 175, 0.15)' }
                    : {}
                }
              >
                <div className="w-24 flex-shrink-0">
                  <span className="text-xs font-medium truncate block text-primary-wh40k">
                    {player.displayName}
                  </span>
                </div>

                <div className="flex-1 relative">
                  {/* 1.0 reference line */}
                  <div
                    className="absolute inset-0"
                    style={{ left: `${targetReferencePct}%` }}
                  >
                    <div className="w-px bg-primary-wh40k h-full"></div>
                  </div>

                  <div className="relative flex items-center h-4">
                    <div
                      className={`h-2.5 ${scoreView.barColor} transition-all duration-300`}
                      style={{ width: `${barWidth}%` }}
                      title={`Target-weighted score: ${scoreView.displayText} - ${scoreView.stateLabel}`}
                    ></div>
                  </div>
                </div>

                <div className="w-10 flex-shrink-0 text-center">
                  <span
                    className={`text-xs font-mono ${scoreView.textColor} block`}
                  >
                    {scoreView.displayText}
                    <span className="sr-only"> {scoreView.stateLabel}</span>
                  </span>
                </div>
              </div>
            )
          }

          const barWidth = (Math.abs(value) / chartMax) * 100
          const isPositive = value >= 0

          return (
            <div
              key={
                player.playerId
                  ? `player-${player.playerId}`
                  : `player-${player.displayName}-${index}`
              }
              className="flex items-center gap-2 py-0"
              role="listitem"
              style={
                !isLast && showChartLines
                  ? { borderBottom: '1px solid rgba(156, 163, 175, 0.15)' }
                  : {}
              }
            >
              <div className="w-24 flex-shrink-0">
                <span className="text-xs font-medium truncate block text-primary-wh40k">
                  {player.displayName}
                </span>
              </div>

              <div className="flex-1 relative">
                <div className="absolute inset-0 flex justify-center">
                  <div className="w-px bg-primary-wh40k h-full"></div>
                </div>

                <div className="relative flex items-center justify-center h-4">
                  {isPositive ? (
                    <div className="flex w-full">
                      <div className="w-1/2"></div>
                      <div className="w-1/2 flex">
                        <div
                          className={`h-2.5 ${getBarColor(value)} transition-all duration-300`}
                          style={{ width: `${barWidth}%` }}
                        ></div>
                      </div>
                    </div>
                  ) : (
                    <div className="flex w-full">
                      <div className="w-1/2 flex justify-end">
                        <div
                          className={`h-2.5 ${getBarColor(value)} transition-all duration-300`}
                          style={{ width: `${barWidth}%` }}
                        ></div>
                      </div>
                      <div className="w-1/2"></div>
                    </div>
                  )}
                </div>
              </div>

              <div className="w-10 flex-shrink-0 text-center">
                <span
                  className={`text-xs font-mono ${getTextColor(value)} block`}
                >
                  {formatPercentageDiff(value, 0)}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      <div className="mt-4 pt-4 border-t border-primary-wh40k">
        {isTargetMode ? (
          <div className="relative text-xs text-secondary-wh40k h-4">
            <span className="absolute left-0">0</span>
            <span
              className="absolute"
              style={{
                left: `${targetReferencePct}%`,
                transform: 'translateX(-50%)'
              }}
            >
              1.0 (target)
            </span>
            <span className="absolute right-0">
              {targetXAxisMax.toFixed(1)}
            </span>
          </div>
        ) : (
          <div className="flex justify-between text-xs text-secondary-wh40k">
            <span>-{formatPercentage(chartMax / 100, 0)}</span>
            <span>0%</span>
            <span>+{formatPercentage(chartMax / 100, 0)}</span>
          </div>
        )}
      </div>
    </div>
  )
}
