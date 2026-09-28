'use client'

import { Rarity } from '@tacticus/app-core/rarity-utils'
import { RarityFilterControls } from '@/app/components/filters/RarityFilterControls'
import type {
  CompareMode,
  PerformanceMode,
  TokenWeightingMode
} from '@/app/components/performance/types'

interface PerformanceControlsProps {
  availableRarities: Rarity[]
  selectedRarities: Rarity[]
  onRarityChange: (rarities: Rarity[]) => void
  hideInactivePlayers: boolean
  hiddenPlayerCount: number
  onHideInactiveChange: (nextValue: boolean) => void
  hasCluster: boolean
  compareMode: CompareMode
  onCompareModeChange: (mode: CompareMode) => void
  performanceMode: PerformanceMode
  onPerformanceModeChange: (mode: PerformanceMode) => void
  tokenModeAvailable: boolean
  tokenWeightingMode: TokenWeightingMode
  onTokenWeightingModeChange: (mode: TokenWeightingMode) => void
  tokenModeUsesApproximation: boolean
  showBossDetail: boolean
  onShowBossDetailChange: (nextValue: boolean) => void
  showFiveSeasonAverage: boolean
  onShowFiveSeasonAverageChange: (nextValue: boolean) => void
  targetLoopRange?: {
    availableLoops: number[]
    start: number
    end: number
  } | null
  onTargetLoopRangeChange?: (start: number, end: number) => void
}

export function PerformanceControls({
  availableRarities,
  selectedRarities,
  onRarityChange,
  hideInactivePlayers,
  hiddenPlayerCount,
  onHideInactiveChange,
  hasCluster,
  compareMode,
  onCompareModeChange,
  performanceMode,
  onPerformanceModeChange,
  tokenModeAvailable,
  tokenWeightingMode,
  onTokenWeightingModeChange,
  tokenModeUsesApproximation,
  showBossDetail,
  onShowBossDetailChange,
  showFiveSeasonAverage,
  onShowFiveSeasonAverageChange,
  targetLoopRange,
  onTargetLoopRangeChange
}: PerformanceControlsProps) {
  const handlePerformanceModeChange = (mode: PerformanceMode) => {
    if (mode === 'token-weighted' && !tokenModeAvailable) {
      return
    }
    onPerformanceModeChange(mode)
  }
  const tokenContextLabel =
    compareMode === 'cluster' || compareMode === 'cluster-boss'
      ? 'Cluster'
      : 'Guild'

  // In Target Weighting the "Boss Only" Compare variants mean mains only, primes excluded.
  const isTargetMode = performanceMode === 'target-weighted'
  const bossOnlyTitle = isTargetMode
    ? 'Main bosses only — primes are excluded from scores, the heatmap, and the tables below.'
    : undefined
  const targetLoopFirst = targetLoopRange?.availableLoops[0]
  const targetLoopLast =
    targetLoopRange?.availableLoops[targetLoopRange.availableLoops.length - 1]
  const targetLoopValues = targetLoopRange?.availableLoops ?? []
  const showTargetLoopRange =
    isTargetMode &&
    !!targetLoopRange &&
    !!onTargetLoopRangeChange &&
    targetLoopFirst !== undefined &&
    targetLoopLast !== undefined &&
    targetLoopFirst < targetLoopLast
  const targetLoopSummary =
    targetLoopRange && targetLoopRange.start === targetLoopRange.end
      ? `Loop ${targetLoopRange.start + 1}`
      : targetLoopRange
        ? `Loops ${targetLoopRange.start + 1}-${targetLoopRange.end + 1}`
        : ''
  const snapTargetStartLoop = (loopIndex: number): number => {
    const snapped = targetLoopValues.find((loop) => loop >= loopIndex)
    return snapped ?? targetLoopLast ?? loopIndex
  }
  const snapTargetEndLoop = (loopIndex: number): number => {
    for (let index = targetLoopValues.length - 1; index >= 0; index -= 1) {
      const loop = targetLoopValues[index]
      if (loop !== undefined && loop <= loopIndex) return loop
    }
    return targetLoopFirst ?? loopIndex
  }

  return (
    <div className="card-wh40k p-4">
      <div className="space-y-4">
        <div>
          <RarityFilterControls
            availableRarities={availableRarities}
            selectedRarities={selectedRarities}
            defaultRarities={['Legendary', 'Mythic']}
            onChange={onRarityChange}
            compact
            label="Rarity Filter"
          />
        </div>

        <div className="flex items-center justify-between px-3 py-2 rounded-lg border border-(--card-border) bg-(--card-bg)">
          <label className="flex items-center gap-2 text-sm text-secondary-wh40k">
            <input
              type="checkbox"
              checked={hideInactivePlayers}
              onChange={(event) => onHideInactiveChange(event.target.checked)}
              className="h-4 w-4 rounded-sm border-(--card-border) bg-(--bg-primary) text-accent-wh40k focus:ring-(--accent)"
            />
            <span className="font-medium text-accent-wh40k">
              Hide inactive members
            </span>
          </label>
          {hideInactivePlayers && hiddenPlayerCount > 0 && (
            <span className="text-xs text-secondary-wh40k">
              {hiddenPlayerCount} hidden
            </span>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-accent-wh40k">
            Scoring Basis:
          </label>
          <div className="grid grid-cols-3 gap-2">
            <button
              onClick={() => handlePerformanceModeChange('battle-weighted')}
              aria-pressed={performanceMode === 'battle-weighted'}
              className={`px-3 py-2 rounded text-sm font-medium transition-all duration-300 border ${
                performanceMode === 'battle-weighted'
                  ? 'bg-accent-wh40k text-(--bg-primary) border-accent-wh40k'
                  : 'bg-card-bg border-primary-wh40k text-primary-wh40k hover:text-accent-wh40k'
              }`}
              type="button"
            >
              Battle Weighting
            </button>
            <button
              onClick={() => handlePerformanceModeChange('token-weighted')}
              aria-pressed={performanceMode === 'token-weighted'}
              className={`px-3 py-2 rounded text-sm font-medium transition-all duration-300 border ${
                performanceMode === 'token-weighted'
                  ? 'bg-accent-wh40k text-(--bg-primary) border-accent-wh40k'
                  : 'bg-card-bg border-primary-wh40k text-primary-wh40k hover:text-accent-wh40k'
              } ${tokenModeAvailable ? '' : 'opacity-60 cursor-not-allowed'}`}
              type="button"
              disabled={!tokenModeAvailable}
            >
              Token Weighting
            </button>
            <button
              onClick={() => handlePerformanceModeChange('target-weighted')}
              aria-pressed={performanceMode === 'target-weighted'}
              className={`px-3 py-2 rounded text-sm font-medium transition-all duration-300 border ${
                performanceMode === 'target-weighted'
                  ? 'bg-accent-wh40k text-(--bg-primary) border-accent-wh40k'
                  : 'bg-card-bg border-primary-wh40k text-primary-wh40k hover:text-accent-wh40k'
              }`}
              type="button"
              title="Ratio of actual damage to expected damage per token (boss HP ÷ anticipated tokens). A score of 1.0 is on target."
            >
              Target Weighting
            </button>
          </div>
          {!tokenModeAvailable && (
            <p className="mt-2 text-xs text-secondary-wh40k">
              Token weighting will activate once season token stats are
              available.
            </p>
          )}
          {tokenModeAvailable && tokenModeUsesApproximation && (
            <p className="mt-2 text-xs text-secondary-wh40k">
              Until season token stats arrive, token weighting uses
              participation share as an approximation.
            </p>
          )}
          {performanceMode === 'token-weighted' && tokenModeAvailable && (
            <div className="mt-3 space-y-2 rounded-lg border border-(--card-border) bg-card/60 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-secondary-wh40k">
                Token Baseline
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onTokenWeightingModeChange('max')}
                  aria-pressed={tokenWeightingMode === 'max'}
                  className={`px-3 py-2 rounded text-sm font-medium transition-all duration-300 border ${
                    tokenWeightingMode === 'max'
                      ? 'bg-accent-wh40k text-(--bg-primary) border-accent-wh40k'
                      : 'bg-card-bg border-primary-wh40k text-primary-wh40k hover:text-accent-wh40k'
                  }`}
                >
                  Max {tokenContextLabel} Tokens Possible
                </button>
                <button
                  type="button"
                  onClick={() => onTokenWeightingModeChange('average')}
                  aria-pressed={tokenWeightingMode === 'average'}
                  className={`px-3 py-2 rounded text-sm font-medium transition-all duration-300 border ${
                    tokenWeightingMode === 'average'
                      ? 'bg-accent-wh40k text-(--bg-primary) border-accent-wh40k'
                      : 'bg-card-bg border-primary-wh40k text-primary-wh40k hover:text-accent-wh40k'
                  }`}
                >
                  Average {tokenContextLabel} Tokens Spent
                </button>
              </div>
              <p className="text-xs text-secondary-wh40k">
                {tokenWeightingMode === 'average'
                  ? 'Divides by the average tokens spent in the selected context to soften low participation penalties.'
                  : 'Divides by the max token availability in the selected context for the strictest participation penalty.'}
              </p>
            </div>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium mb-2 text-accent-wh40k">
            Compare Against:
          </label>
          <div
            className={`grid gap-2 ${hasCluster ? 'grid-cols-2' : 'grid-cols-1'}`}
          >
            <button
              onClick={() => onCompareModeChange('guild')}
              aria-pressed={compareMode === 'guild'}
              className={`px-3 py-2 rounded text-sm font-medium transition-all duration-300 border ${
                compareMode === 'guild'
                  ? 'bg-accent-wh40k text-(--bg-primary) border-accent-wh40k'
                  : 'bg-card-bg border-primary-wh40k text-primary-wh40k hover:text-accent-wh40k'
              }`}
            >
              Compare to Guild
            </button>
            <button
              onClick={() => onCompareModeChange('guild-boss')}
              aria-pressed={compareMode === 'guild-boss'}
              title={bossOnlyTitle}
              className={`px-3 py-2 rounded text-sm font-medium transition-all duration-300 border ${
                compareMode === 'guild-boss'
                  ? 'bg-accent-wh40k text-(--bg-primary) border-accent-wh40k'
                  : 'bg-card-bg border-primary-wh40k text-primary-wh40k hover:text-accent-wh40k'
              }`}
            >
              Boss Only vs Guild
            </button>
            {hasCluster && (
              <>
                <button
                  onClick={() => onCompareModeChange('cluster')}
                  aria-pressed={compareMode === 'cluster'}
                  className={`px-3 py-2 rounded text-sm font-medium transition-all duration-300 border ${
                    compareMode === 'cluster'
                      ? 'bg-accent-wh40k text-(--bg-primary) border-accent-wh40k'
                      : 'bg-card-bg border-primary-wh40k text-primary-wh40k hover:text-accent-wh40k'
                  }`}
                >
                  Compare to Cluster
                </button>
                <button
                  onClick={() => onCompareModeChange('cluster-boss')}
                  aria-pressed={compareMode === 'cluster-boss'}
                  title={bossOnlyTitle}
                  className={`px-3 py-2 rounded text-sm font-medium transition-all duration-300 border ${
                    compareMode === 'cluster-boss'
                      ? 'bg-accent-wh40k text-(--bg-primary) border-accent-wh40k'
                      : 'bg-card-bg border-primary-wh40k text-primary-wh40k hover:text-accent-wh40k'
                  }`}
                >
                  Boss Only vs Cluster
                </button>
              </>
            )}
          </div>
        </div>

        {showTargetLoopRange &&
          targetLoopRange &&
          onTargetLoopRangeChange &&
          targetLoopFirst !== undefined &&
          targetLoopLast !== undefined && (
            <fieldset className="space-y-3 rounded-lg border border-(--card-border) bg-card/60 p-3">
              <legend className="sr-only">Loop Range</legend>
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-secondary-wh40k">
                  Loop Range
                </p>
                <span className="text-xs font-mono text-accent-wh40k">
                  {targetLoopSummary}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="space-y-1 text-xs text-secondary-wh40k">
                  <span className="flex items-center justify-between">
                    <span>From</span>
                    <span
                      aria-hidden="true"
                      className="font-mono text-primary-wh40k"
                    >
                      Loop {targetLoopRange.start + 1}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={targetLoopFirst + 1}
                    max={targetLoopLast + 1}
                    step={1}
                    value={targetLoopRange.start + 1}
                    aria-label="From target loop"
                    aria-valuetext={`Loop ${targetLoopRange.start + 1}`}
                    onChange={(event) => {
                      const nextStart = snapTargetStartLoop(
                        Number(event.target.value) - 1
                      )
                      onTargetLoopRangeChange(
                        Math.min(nextStart, targetLoopRange.end),
                        targetLoopRange.end
                      )
                    }}
                    className="h-2 w-full accent-(--accent)"
                  />
                </label>
                <label className="space-y-1 text-xs text-secondary-wh40k">
                  <span className="flex items-center justify-between">
                    <span>To</span>
                    <span
                      aria-hidden="true"
                      className="font-mono text-primary-wh40k"
                    >
                      Loop {targetLoopRange.end + 1}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={targetLoopFirst + 1}
                    max={targetLoopLast + 1}
                    step={1}
                    value={targetLoopRange.end + 1}
                    aria-label="To target loop"
                    aria-valuetext={`Loop ${targetLoopRange.end + 1}`}
                    onChange={(event) => {
                      const nextEnd = snapTargetEndLoop(
                        Number(event.target.value) - 1
                      )
                      onTargetLoopRangeChange(
                        targetLoopRange.start,
                        Math.max(nextEnd, targetLoopRange.start)
                      )
                    }}
                    className="h-2 w-full accent-(--accent)"
                  />
                </label>
              </div>
            </fieldset>
          )}

        <div className="space-y-2">
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={showBossDetail}
              onChange={(event) => onShowBossDetailChange(event.target.checked)}
              className="rounded-sm border-primary-wh40k bg-card-bg text-accent-wh40k"
            />
            <span className="text-sm font-medium text-primary-wh40k">
              Show Boss-by-Boss Detail
            </span>
          </label>
          <label className="flex items-center space-x-2">
            <input
              type="checkbox"
              checked={showFiveSeasonAverage}
              onChange={(event) =>
                onShowFiveSeasonAverageChange(event.target.checked)
              }
              className="rounded-sm border-primary-wh40k bg-card-bg text-accent-wh40k"
            />
            <span className="text-sm font-medium text-primary-wh40k">
              Show 5-Season Averages (Not Including Current)
            </span>
          </label>
        </div>
      </div>
    </div>
  )
}
