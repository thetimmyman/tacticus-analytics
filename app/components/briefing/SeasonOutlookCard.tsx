'use client'

/**
 * "Season outlook" lap chart. Without `lap_projection` (before the first lap) it shows
 * a season-progress bar; per-lap costs are never invented.
 */

import Link from 'next/link'
import { TrendingUp, ChevronRight, AlertTriangle } from 'lucide-react'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { formatNumber } from '@tacticus/app-core/formatters'
import { SEASON_ACTIVE_SECONDS } from '@/app/lib/season-forecast/forecast-math'
import type {
  SeasonForecastEnvelope,
  SeasonForecastLapProjection,
  ForecastConfidence
} from '@/app/lib/season-forecast/forecast-service'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'
// Shared so every lap-projection surface numbers laps the same way.
import {
  mergeLapProjection,
  displayFinishLap,
  finishIsStale
} from '@/app/lib/season-forecast/lap-projection-display'

interface SeasonOutlookCardProps {
  forecast: SeasonForecastEnvelope | null
  /** Supersedes the envelope's snapshot numbers; absent → neutral progress view. */
  outlook: SeasonOutlookProjection | null
  isOfficer: boolean
  guildCode: string
}

const CONFIDENCE_COLOR: Record<ForecastConfidence, string> = {
  low: 'var(--text-secondary)',
  medium: 'var(--info)',
  high: 'var(--success)'
}

function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) return 'season ended'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h`
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(1, n))
}

interface LapBar {
  lap: number
  /** Actually-done fraction, 0..1. */
  solid: number
  /** Projected fraction, 0..1. */
  ghost: number
  kind: 'done' | 'live' | 'projected' | 'finish'
  /** Label above the bar (real numbers only). */
  value: string
}

/** Rounds to a full lap (avoids a contradictory "+100%"). */
export function finishIsComplete(lp: SeasonForecastLapProjection): boolean {
  return Math.round(clamp01(lp.projected_finish_pct) * 100) >= 100
}

const MAX_PROJECTED_BARS = 5

/**
 * Up to 4 recent laps, the live lap, capped intermediate laps and always the finish
 * bar: clipping the finish would contradict the headline.
 */
export function buildLapBars(lp: SeasonForecastLapProjection): LapBar[] {
  const cur = lp.current_lap
  const cost = lp.projected_lap_cost > 0 ? lp.projected_lap_cost : 0
  const finish = displayFinishLap(lp)
  const pct = clamp01(lp.projected_finish_pct)
  const liveSolid = cost > 0 ? clamp01(lp.tokens_into_current_lap / cost) : 0
  const start = Math.max(0, cur - 4) // a few completed laps → a fuller, honest chart

  const bars: LapBar[] = []

  for (let L = start; L < cur; L++) {
    bars.push({ lap: L, solid: 1, ghost: 1, kind: 'done', value: '✓' })
  }

  // Live lap: ghost = projected fill when finishing this lap, else 1.
  bars.push({
    lap: cur,
    solid: liveSolid,
    ghost: finish === cur ? Math.max(liveSolid, pct) : Math.max(liveSolid, 1),
    kind: 'live',
    value:
      cost > 0
        ? `${lp.tokens_into_current_lap}/${Math.round(cost)}`
        : `${lp.tokens_into_current_lap}`
  })

  if (finish > cur) {
    const lastIntermediate = Math.min(finish - 1, cur + MAX_PROJECTED_BARS)
    for (let L = cur + 1; L <= lastIntermediate; L++) {
      bars.push({ lap: L, solid: 0, ghost: 1, kind: 'projected', value: '' })
    }
    bars.push({
      lap: finish,
      solid: 0,
      ghost: pct,
      kind: 'finish',
      value: `${Math.round(pct * 100)}%`
    })
  }

  return bars
}

const GHOST_FILL =
  'repeating-linear-gradient(135deg, color-mix(in srgb, var(--accent) 28%, transparent), color-mix(in srgb, var(--accent) 28%, transparent) 5px, transparent 5px, transparent 10px)'

function LapChart({
  lp,
  stale = false
}: {
  lp: SeasonForecastLapProjection
  stale?: boolean
}) {
  const bars = buildLapBars(lp)
  const tagFor = (kind: LapBar['kind']) =>
    kind === 'live'
      ? 'live'
      : kind === 'finish'
        ? 'finish'
        : kind === 'projected'
          ? 'proj'
          : ''

  // A stale finish drops "at N%" from the aria-label, matching the visual "updating".
  const ariaLabel = stale
    ? `Projected laps: currently lap ${lp.current_lap + 1}, finish projection updating`
    : `Projected laps: currently lap ${lp.current_lap + 1}, projected to reach lap ${displayFinishLap(lp) + 1} at ${Math.round(clamp01(lp.projected_finish_pct) * 100)}%`

  return (
    <div
      className="mt-3 grid items-end gap-1.5 sm:gap-2"
      style={{
        gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`,
        height: '128px'
      }}
      role="img"
      aria-label={ariaLabel}
    >
      {bars.map((b) => (
        <div
          key={b.lap}
          className="flex h-full flex-col items-center justify-end"
        >
          <strong className="mb-1 text-[10px] font-semibold tabular-nums text-secondary-wh40k">
            {b.value || ' '}
          </strong>
          <div
            className={`relative w-full max-w-[44px] overflow-hidden rounded-md border ${
              b.kind === 'live'
                ? 'border-accent-wh40k'
                : 'border-(--card-border)'
            }`}
            style={{
              height: '84px',
              background: 'rgba(var(--card-bg-rgb), 0.5)'
            }}
          >
            {/* ghost = projected extent */}
            <div
              className="absolute inset-x-0 bottom-0"
              style={{ height: `${b.ghost * 100}%`, background: GHOST_FILL }}
            />
            {/* solid = actually done */}
            <div
              className="absolute inset-x-0 bottom-0 rounded-t-[3px]"
              style={{
                height: `${b.solid * 100}%`,
                backgroundColor: 'var(--accent)'
              }}
            />
          </div>
          <span className="mt-1 max-w-full text-center text-[9px] uppercase leading-tight tracking-wide text-(--text-tertiary)">
            L{b.lap + 1}
            {tagFor(b.kind) ? ` · ${tagFor(b.kind)}` : ''}
          </span>
        </div>
      ))}
    </div>
  )
}

function SeasonOutlookCard({
  forecast,
  outlook,
  isOfficer,
  guildCode
}: SeasonOutlookCardProps) {
  const hasMounted = useHasMounted()
  const lp = forecast?.lap_projection ?? null
  const mergedLp = mergeLapProjection(lp, outlook)
  // Prefer the sim's countdown so the card survives an envelope timeout; then envelope, then 0.
  const secs =
    outlook?.secondsRemaining ?? forecast?.season.seconds_remaining ?? 0
  const startMs = Date.parse(forecast?.season.starts_at ?? '')
  const endMs = Date.parse(forecast?.season.ends_at ?? '')
  const windowSecs =
    Number.isFinite(startMs) && Number.isFinite(endMs) && endMs > startMs
      ? (endMs - startMs) / 1000
      : SEASON_ACTIVE_SECONDS
  const progress = clamp01(1 - secs / windowSecs)

  const finish = outlook?.finish ?? null
  const finishPct = finish
    ? Math.round(clamp01(finish.pctIntoFinalStage) * 100)
    : 0
  // Same clamped lap as the chart so headline and chart agree.
  const headlineLap =
    finish && mergedLp
      ? displayFinishLap(mergedLp) + 1
      : (finish?.loopIndex ?? 0) + 1
  // A cached sim finish behind the envelope's current_lap describes a passed lap; hide its details.
  const finishStale = !!(finish && mergedLp && finishIsStale(mergedLp))
  const finishDetailed = !!(finish && mergedLp && !finishStale)
  // Same pace model as the waste tile.
  const capBoundPlayers = outlook?.playersAtCapRisk ?? 0

  return (
    <section
      className="rounded-xl border border-(--card-border) bg-card/30 p-4"
      aria-label="Season outlook"
      data-testid="season-outlook-card"
    >
      <div className="mb-1 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-primary-wh40k">
          <TrendingUp className="h-4 w-4 text-(--accent)" aria-hidden />
          Season outlook
        </h2>
        <span className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
          Guild forecast
        </span>
      </div>

      {!forecast && !outlook ? (
        <p className="text-xs text-secondary-wh40k">
          Season forecast becomes available once the guild has completed laps
          this season.
        </p>
      ) : (
        <>
          {/* Projected finish (when known) and countdown. */}
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              {finish ? (
                <>
                  <p className="text-2xl font-bold leading-tight text-(--accent)">
                    Lap {headlineLap}
                    {finishDetailed ? ` · ${finish.bossName}` : ''}
                  </p>
                  <p className="text-[11px] text-(--text-tertiary)">
                    {finishDetailed
                      ? `projected finish · ${finishPct >= 100 ? 'lap cleared' : `+${finishPct}% into lap`}`
                      : 'projected finish · updating'}{' '}
                    ·{' '}
                    <span
                      style={{ color: CONFIDENCE_COLOR[outlook!.confidence] }}
                    >
                      {outlook!.confidence} confidence
                    </span>
                  </p>
                </>
              ) : (
                <>
                  <p className="text-sm font-semibold text-primary-wh40k">
                    Season underway
                  </p>
                  <p className="text-[11px] text-(--text-tertiary)">
                    full forecast builds after the guild completes a lap
                  </p>
                </>
              )}
            </div>
            <div className="shrink-0 border-l border-[color-mix(in_srgb,var(--card-border)_60%,transparent)] pl-3 text-right">
              <p className="text-xl font-bold tabular-nums text-primary-wh40k">
                {hasMounted ? formatTimeRemaining(secs) : '—'}
              </p>
              <p className="text-[9px] uppercase tracking-wider text-(--text-tertiary)">
                Time left
              </p>
            </div>
          </div>

          {finish && mergedLp ? (
            <LapChart lp={mergedLp} stale={finishStale} />
          ) : (
            /* No sim finish: neutral bar; the envelope's snapshot-model finish is deliberately hidden. */
            <div className="mt-3">
              <div className="h-2 w-full overflow-hidden rounded-full bg-[rgba(var(--card-bg-rgb),0.6)]">
                <div
                  className="h-full rounded-full bg-accent-wh40k"
                  style={{ width: `${progress * 100}%` }}
                />
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-(--text-tertiary)">
                <span>Season start</span>
                <span>{Math.round(progress * 100)}% elapsed</span>
                <span>End</span>
              </div>
            </div>
          )}

          {/* Season-token economy: used / still spendable / waste. */}
          {outlook && (
            <div className="mt-3 grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-[color-mix(in_srgb,var(--card-border)_60%,transparent)] bg-(--bg-primary) p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
                  Tokens used
                </p>
                <p className="text-lg font-bold text-primary-wh40k">
                  {formatNumber(
                    Math.min(outlook.tokensUsed, outlook.seasonBudget),
                    0
                  )}
                </p>
                <p className="text-[9px] text-(--text-tertiary)">
                  of {formatNumber(outlook.seasonBudget, 0)} this season
                </p>
              </div>
              <div className="rounded-lg border border-[color-mix(in_srgb,var(--card-border)_60%,transparent)] bg-(--bg-primary) p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
                  Tokens left
                </p>
                <p className="text-lg font-bold text-primary-wh40k">
                  {formatNumber(outlook.tokensRemaining, 0)}
                </p>
                <p className="text-[9px] text-(--text-tertiary)">
                  still spendable
                </p>
              </div>
              <div className="rounded-lg border border-[color-mix(in_srgb,var(--card-border)_60%,transparent)] bg-(--bg-primary) p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-(--text-tertiary)">
                  Waste risk
                </p>
                <p className="text-lg font-bold text-primary-wh40k">
                  {formatNumber(outlook.projectedWaste, 0)}
                </p>
                <p className="text-[9px] text-(--text-tertiary)">
                  at current pace
                </p>
              </div>
            </div>
          )}

          {/* `budget` exists only when officers set targets inside the projected span. */}
          {outlook?.budget && (
            <p className="mt-2 text-[11px] text-(--text-tertiary)">
              Plan spends{' '}
              <span className="font-semibold text-secondary-wh40k">
                {formatNumber(outlook.budget.projectedSpendTokens, 0)}
              </span>{' '}
              vs officer budget{' '}
              <span className="font-semibold text-secondary-wh40k">
                {formatNumber(outlook.budget.targetBudgetTokens, 0)}
              </span>
              {outlook.budget.projectedSpendVsBudgetTokens !== 0
                ? ` (${outlook.budget.projectedSpendVsBudgetTokens > 0 ? '+' : ''}${formatNumber(outlook.budget.projectedSpendVsBudgetTokens, 0)})`
                : ' (on budget)'}
            </p>
          )}

          {capBoundPlayers > 0 && (
            <p className="mt-3 flex items-center gap-1.5 rounded-md border border-[color-mix(in_srgb,var(--warning)_30%,transparent)] bg-[color-mix(in_srgb,var(--warning)_10%,transparent)] px-2.5 py-1.5 text-[11px] text-secondary-wh40k">
              <AlertTriangle
                className="h-3.5 w-3.5 text-(--warning)"
                aria-hidden
              />
              <span>
                <span className="font-semibold text-primary-wh40k">
                  {capBoundPlayers}
                </span>{' '}
                player{capBoundPlayers === 1 ? '' : 's'} may cap tokens before
                season end
              </span>
            </p>
          )}

          {isOfficer && guildCode && (
            <Link
              href={`/token-usage?guild=${encodeURIComponent(guildCode)}`}
              className="mt-3 inline-flex items-center gap-1 text-xs text-(--accent) hover:underline"
            >
              Open forecast detail
              <ChevronRight className="h-3 w-3" aria-hidden />
            </Link>
          )}
        </>
      )}
    </section>
  )
}

export default SeasonOutlookCard
