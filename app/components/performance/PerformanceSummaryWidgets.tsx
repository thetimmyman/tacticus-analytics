'use client'

import { formatPercentageDiff } from '@tacticus/app-core/formatters'
import type {
  CompareMode,
  PerformanceMode,
  PreparedPerformanceSummary,
  TokenWeightingMode
} from '@/app/components/performance/types'

interface PerformanceSummaryWidgetsProps {
  playerSummaries: PreparedPerformanceSummary[]
  topPlayer: PreparedPerformanceSummary | null
  compareMode: CompareMode
  performanceMode: PerformanceMode
  tokenModeActive: boolean
  tokenModeUsesApproximation: boolean
  tokenWeightingMode: TokenWeightingMode
}

export function PerformanceSummaryWidgets({
  playerSummaries,
  topPlayer,
  compareMode,
  performanceMode,
  tokenModeActive,
  tokenModeUsesApproximation,
  tokenWeightingMode
}: PerformanceSummaryWidgetsProps) {
  if (playerSummaries.length === 0) {
    return null
  }

  const aboveAverageCount = playerSummaries.filter(
    (player) => player.performanceValue > 0
  ).length
  const belowAverageCount = playerSummaries.filter(
    (player) => player.performanceValue < 0
  ).length
  const contextLabel =
    compareMode === 'cluster' || compareMode === 'cluster-boss'
      ? 'Cluster'
      : 'Guild'
  const baselineLabel =
    tokenWeightingMode === 'average'
      ? `${contextLabel} average tokens spent`
      : `${contextLabel} max tokens possible`
  const weightingLabel =
    performanceMode === 'token-weighted'
      ? `Token Weighting (${contextLabel} ${tokenWeightingMode === 'average' ? 'Average' : 'Max'})`
      : 'Battle Weighting'
  const showRawComparison =
    performanceMode === 'token-weighted' && tokenModeActive

  return (
    <div className="card-wh40k p-4">
      <h3 className="heading-wh40k">Performance Summary</h3>
      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <div className="text-green-400 font-medium">Above Average</div>
          <div className="text-lg font-bold text-accent-wh40k">
            {aboveAverageCount}
          </div>
        </div>
        <div>
          <div className="text-red-400 font-medium">Below Average</div>
          <div className="text-lg font-bold text-accent-wh40k">
            {belowAverageCount}
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-primary-wh40k">
        <div className="text-xs text-secondary-wh40k space-y-1">
          {topPlayer && (
            <div>
              Top Performer ({weightingLabel}):{' '}
              <span className="font-medium text-primary-wh40k">
                {topPlayer.displayName}
              </span>{' '}
              ({formatPercentageDiff(topPlayer.performanceValue, 0)}
              {showRawComparison
                ? ` / raw ${formatPercentageDiff(topPlayer.basePerformanceValue, 0)}`
                : ''}
              )
            </div>
          )}
          <div>Qualified Players: {playerSummaries.length}</div>
          {performanceMode === 'token-weighted' && tokenModeActive && (
            <>
              <div className="text-(--text-tertiary)">
                Baseline: {baselineLabel}.
              </div>
              {tokenModeUsesApproximation ? (
                <div className="text-(--text-tertiary)">
                  Token weighting currently uses participation share until
                  season token stats land.
                </div>
              ) : (
                <div className="text-(--text-tertiary)">
                  Token weighting reflects reported token spend with live token
                  stats.
                </div>
              )}
            </>
          )}
          {performanceMode === 'token-weighted' && !tokenModeActive && (
            <div className="text-(--warning-text)">
              Token stats unavailable &mdash; showing battle-weighted results.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
