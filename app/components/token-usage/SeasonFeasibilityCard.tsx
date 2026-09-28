'use client'

/**
 * Forecast summary: spendable tokens before season end and how far down the rotation
 * that reaches. "In bank now" is always the envelope's live fact.
 */

import { memo } from 'react'
import { formatNumber } from '@tacticus/app-core/formatters'
import { formatShortDuration } from './utils'
import type { SeasonForecastEnvelope } from '@/app/lib/season-forecast/forecast-service'
import {
  spendableTokensByEnd,
  lapFeasibilityTone,
  type FeasibilityTone
} from '@/app/lib/season-forecast/boss-feasibility-math'
import {
  displayFinishLap,
  finishFromRotationSim
} from '@/app/lib/season-forecast/lap-projection-display'
import { selectSpendableCapFigures } from '@/app/lib/season-forecast/pace-figures'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'

interface SeasonFeasibilityCardProps {
  forecast: SeasonForecastEnvelope | null
  /** Null → envelope fallback. */
  outlook?: SeasonOutlookProjection | null
}

// Styling per tone; the decision lives in lapFeasibilityTone.
const TONE_STYLE: Record<
  FeasibilityTone,
  { label: string; className: string }
> = {
  on_track: {
    label: 'On track',
    className: 'text-green-400 border-green-400/40 bg-green-400/10'
  },
  watch: {
    label: 'Watch',
    className: 'text-amber-300 border-amber-300/40 bg-amber-300/10'
  },
  at_risk: {
    label: 'At risk',
    className: 'text-red-400 border-red-400/40 bg-red-400/10'
  }
}

function SeasonFeasibilityCard({
  forecast,
  outlook = null
}: SeasonFeasibilityCardProps) {
  if (!forecast) return null

  const { season, tokens, lap_projection: lap } = forecast
  const figures = selectSpendableCapFigures({
    outlook,
    envelope: {
      spendableByEnd: spendableTokensByEnd(tokens),
      capBoundPlayers: tokens.cap_bound_players,
      estimatedCapWaste: tokens.estimated_cap_waste
    }
  })
  const countdown = formatShortDuration(season.seconds_remaining)
  const seasonEnded = season.seconds_remaining <= 0

  // Shared clamp keeps header and pct on one lap; +1 makes the index 1-based.
  const finishLapDisplay = lap ? displayFinishLap(lap) + 1 : null
  const finishPct = lap
    ? Math.round(Math.min(1, Math.max(0, lap.projected_finish_pct)) * 100)
    : null
  // Cache skew can push current_lap past a cached sim finish, so clamp for sim merges
  // only; a genuine RPC shortfall must still tone at_risk.
  const tone = lap
    ? TONE_STYLE[
        lapFeasibilityTone(
          finishFromRotationSim(lap)
            ? { ...lap, projected_finish_lap: displayFinishLap(lap) }
            : lap
        )
      ]
    : null

  return (
    <div
      className="rounded-lg border border-(--card-border) bg-(--card-bg) p-4 space-y-4"
      aria-label="Season token feasibility"
      data-testid="season-feasibility-card"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-secondary-wh40k">
          Spendable tokens by end of season
        </h3>
        {tone && (
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${tone.className}`}
          >
            {tone.label}
          </span>
        )}
      </div>

      <dl className="grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-xs text-(--text-tertiary)">In bank now</dt>
          <dd className="text-lg font-bold text-primary-wh40k">
            {formatNumber(tokens.available_now, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-(--text-tertiary)">
            {seasonEnded
              ? 'Would regen'
              : `New before end${countdown ? ` (${countdown})` : ''}`}
          </dt>
          <dd className="text-lg font-bold text-primary-wh40k">
            +{formatNumber(tokens.yet_to_regen, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-(--text-tertiary)">
            {figures.source === 'pace'
              ? 'Spendable at current pace'
              : 'Total possible'}
          </dt>
          <dd className="text-lg font-bold text-(--accent)">
            {formatNumber(figures.spendableByEnd, 0)}
          </dd>
          {/* Pace is cap-limited and can undercut the bank, so col1 + col2 need not equal col3. */}
          {figures.source === 'pace' && (
            <div className="text-[10px] leading-tight text-(--text-tertiary)">
              cap-limited — not bank + new
            </div>
          )}
        </div>
      </dl>

      {figures.capBoundPlayers > 0 && (
        <p className="text-xs text-amber-300/80">
          {figures.source === 'pace' ? 'At current pace, ' : ''}
          {formatNumber(figures.capBoundPlayers, 0)} player
          {figures.capBoundPlayers === 1 ? '' : 's'} may hit the 3-token cap and
          waste ~{formatNumber(figures.estimatedCapWaste, 0)} token
          {figures.estimatedCapWaste === 1 ? '' : 's'} before end of season.
        </p>
      )}

      <div className="border-t border-(--card-border) pt-3">
        {lap && finishLapDisplay !== null && finishPct !== null ? (
          <p className="text-sm text-secondary-wh40k">
            Projected to reach{' '}
            <span className="font-semibold text-primary-wh40k">
              lap {finishLapDisplay}
            </span>{' '}
            at{' '}
            <span className="font-semibold text-primary-wh40k">
              {finishPct}%
            </span>{' '}
            with these tokens
            <span className="text-(--text-tertiary)">
              {' '}
              · {lap.confidence} confidence
            </span>
            . For the full per-boss plan, open the{' '}
            <a
              href="/boss-assignments/season-planner"
              className="text-(--accent) hover:underline"
            >
              season planner
            </a>
            .
          </p>
        ) : (
          <p className="text-sm text-(--text-tertiary)">
            The rotation projection builds after the guild completes a lap this
            season.
          </p>
        )}
      </div>
    </div>
  )
}

export default memo(SeasonFeasibilityCard)
