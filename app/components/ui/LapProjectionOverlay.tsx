/**
 * Lap projection panel. Tokens left = available_now + yet_to_regen (do not subtract
 * tokens_into_current_lap again).
 */

import { formatNumber } from '@tacticus/app-core/formatters'
import type {
  SeasonForecastLapProjection,
  SeasonForecastTokens
} from '@/app/lib/season-forecast/forecast-service'
import { computeForecastTokenContract } from '@/app/lib/season-forecast/forecast-math'
import {
  displayFinishLap,
  finishFromRotationSim,
  finishIsStale
} from '@/app/lib/season-forecast/lap-projection-display'

interface LapProjectionOverlayProps {
  lapProjection: SeasonForecastLapProjection | undefined
  tokens: SeasonForecastTokens
  className?: string
}

const BASIS_LABEL: Record<SeasonForecastLapProjection['basis'], string> = {
  wi737_solver: 'WI-737 solver',
  last_n_laps: 'Last N laps avg',
  manual: 'Manual'
}

const CONFIDENCE_TONE: Record<
  SeasonForecastLapProjection['confidence'],
  string
> = {
  low: 'text-[var(--warning)]',
  medium: 'text-[var(--text-secondary)]',
  high: 'text-[var(--success)]'
}

export function LapProjectionOverlay({
  lapProjection,
  tokens,
  className
}: LapProjectionOverlayProps) {
  if (!lapProjection) return null

  const lapDisplay = lapProjection.current_lap + 1 // 0-based loopIndex → "Lap N"
  // Shared clamp: the RPC's shortfall case reports current_lap − 1 while pct
  // describes the current lap.
  const finishLapDisplay = displayFinishLap(lapProjection) + 1
  const finishIsRotationSim = finishFromRotationSim(lapProjection)
  const basisLabel = finishIsRotationSim
    ? 'Rotation sim'
    : BASIS_LABEL[lapProjection.basis]
  const currentPctOfLap =
    lapProjection.projected_lap_cost > 0
      ? lapProjection.tokens_into_current_lap / lapProjection.projected_lap_cost
      : 0
  const tokenContract = computeForecastTokenContract({
    tokensAvailableNow: tokens.available_now,
    tokensExpectedToRegenerate: tokens.yet_to_regen,
    tokensSpentCurrentLap: lapProjection.tokens_into_current_lap
  })
  const tokensLeftToSpend = tokenContract.tokens_remaining_from_now
  const projectedLapCostRounded = formatNumber(
    lapProjection.projected_lap_cost,
    0
  )
  const finishPctLabel =
    lapProjection.projected_finish_pct >= 0.999
      ? 'complete'
      : `+ ${formatNumber(lapProjection.projected_finish_pct * 100, 0)}%`
  // Under cache skew the fill % can describe a passed lap; suppress it like SeasonOutlookCard.
  const finishStale = finishIsStale(lapProjection)

  const Cell = ({
    label,
    value
  }: {
    label: string
    value: React.ReactNode
  }) => (
    <div className="rounded-md border border-[var(--card-border)] bg-[var(--bg-primary)] p-4 space-y-1">
      <div className="text-xs font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
        {label}
      </div>
      <div className="text-base text-[var(--text-primary)]">{value}</div>
    </div>
  )

  return (
    <section
      className={'space-y-3 ' + (className ?? '')}
      data-testid="lap-projection-overlay"
      aria-label="Lap projection summary"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Cell
          label="Current position"
          value={
            <>
              Lap {lapDisplay} ·{' '}
              {formatNumber(lapProjection.tokens_into_current_lap, 0)} / ~
              {projectedLapCostRounded} (
              {formatNumber(currentPctOfLap * 100, 0)}%)
            </>
          }
        />
        <Cell
          label="Projected basis"
          value={
            <span className="inline-flex items-center gap-2">
              <span className="rounded-full border border-[var(--card-border)] px-2 py-0.5 text-xs uppercase tracking-wide text-[var(--text-secondary)]">
                {basisLabel}
              </span>
              <span className="text-xs text-[var(--text-tertiary)]">
                read-only · v1
              </span>
            </span>
          }
        />
        <Cell
          label="Tokens left to spend"
          value={formatNumber(tokensLeftToSpend, 0)}
        />
        <Cell
          label="Projected finish"
          value={
            <span className="text-[var(--accent)] font-semibold">
              Lap {finishLapDisplay}{' '}
              {finishStale ? '· updating' : finishPctLabel}
            </span>
          }
        />
      </div>
      <p className={'text-xs ' + CONFIDENCE_TONE[lapProjection.confidence]}>
        Confidence:{' '}
        <span className="font-semibold">{lapProjection.confidence}</span> —{' '}
        {finishIsRotationSim
          ? 'from the rotation-aware season sim'
          : `based on ${lapProjection.n} completed lap${lapProjection.n === 1 ? '' : 's'} at current difficulty`}
      </p>
    </section>
  )
}
