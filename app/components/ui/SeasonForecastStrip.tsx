'use client'

/**
 * Season forecast strip: time remaining, tokens yet to regen, tokens remaining. Bombs
 * are never folded into tokens.
 */

import { useEffect, useMemo, useRef } from 'react'
import { MetricCard } from '@/app/components/ui/MetricCard'
import { useHasMounted } from '@/app/lib/hooks/useHasMounted'
import { formatNumber } from '@tacticus/app-core/formatters'
import type {
  SeasonForecastBombs,
  SeasonForecastSeason,
  SeasonForecastTokens
} from '@/app/lib/season-forecast/forecast-service'
import { selectSpendableCapFigures } from '@/app/lib/season-forecast/pace-figures'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'

interface SeasonForecastStripProps {
  season: SeasonForecastSeason
  tokens: SeasonForecastTokens
  bombs: SeasonForecastBombs
  /** Pace-model figures when present; otherwise the envelope's. */
  outlook?: SeasonOutlookProjection | null
  totalPlayers: number
  className?: string
}

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return 'Season ended'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  if (days > 0) return `${days}d ${hours}h ${minutes}m`
  if (hours > 0) return `${hours}h ${minutes}m ${secs}s`
  if (minutes > 0) return `${minutes}m ${secs}s`
  return `${secs}s`
}

/**
 * Countdown updates textContent via a ref, not React state; it re-renders only
 * when the envelope changes.
 */
function LiveCountdown({
  initialSecondsRemaining
}: {
  initialSecondsRemaining: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const startedAtRef = useRef<number>(Date.now())
  const initialRef = useRef<number>(initialSecondsRemaining)

  useEffect(() => {
    startedAtRef.current = Date.now()
    initialRef.current = initialSecondsRemaining
    if (ref.current) {
      ref.current.textContent = formatCountdown(initialSecondsRemaining)
    }
  }, [initialSecondsRemaining])

  useEffect(() => {
    const tick = () => {
      const elapsed = (Date.now() - startedAtRef.current) / 1000
      const remaining = Math.max(0, initialRef.current - elapsed)
      if (ref.current) {
        ref.current.textContent = formatCountdown(remaining)
      }
    }
    const id = window.setInterval(tick, 1000)
    tick()
    return () => window.clearInterval(id)
  }, [])

  return <span ref={ref}>{formatCountdown(initialSecondsRemaining)}</span>
}

export function SeasonForecastStrip({
  season,
  tokens,
  bombs,
  outlook = null,
  totalPlayers,
  className
}: SeasonForecastStripProps) {
  const hasMounted = useHasMounted()

  const figures = selectSpendableCapFigures({
    outlook,
    envelope: {
      spendableByEnd: tokens.capacity,
      capBoundPlayers: tokens.cap_bound_players,
      estimatedCapWaste: tokens.estimated_cap_waste
    }
  })

  const endsAtLabel = useMemo(() => {
    if (!hasMounted) return 'shortly'
    try {
      const date = new Date(season.ends_at)
      if (Number.isNaN(date.getTime())) return 'shortly'
      return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      })
    } catch {
      return 'shortly'
    }
  }, [hasMounted, season.ends_at])

  const capWasteLabel =
    figures.estimatedCapWaste > 0
      ? `~${formatNumber(figures.estimatedCapWaste, 0)} tokens lost`
      : 'no estimated waste'

  return (
    <div
      className={'grid grid-cols-1 sm:grid-cols-3 gap-3 ' + (className ?? '')}
      data-testid="season-forecast-strip"
    >
      <MetricCard
        label="Time remaining"
        value={
          <LiveCountdown initialSecondsRemaining={season.seconds_remaining} />
        }
        hint={`Season ${season.number} ends ${endsAtLabel}`}
      />
      <MetricCard
        label="Tokens yet to regen"
        value={formatNumber(tokens.yet_to_regen, 0)}
        hint={
          <>
            {formatNumber(figures.capBoundPlayers, 0)} of{' '}
            {formatNumber(totalPlayers, 0)} players will cap · {capWasteLabel}
          </>
        }
      />
      <MetricCard
        label="Tokens remaining"
        value={formatNumber(figures.spendableByEnd, 0)}
        tone="accent"
        className="border-[color-mix(in_srgb,var(--accent)_40%,transparent)]"
        hint={
          figures.source === 'pace' ? (
            <>at current pace · {formatNumber(bombs.capacity, 0)} bombs</>
          ) : (
            <>
              {formatNumber(tokens.available_now, 0)} now +{' '}
              {formatNumber(tokens.yet_to_regen, 0)} incoming ·{' '}
              {formatNumber(bombs.capacity, 0)} bombs
            </>
          )
        }
      />
    </div>
  )
}
