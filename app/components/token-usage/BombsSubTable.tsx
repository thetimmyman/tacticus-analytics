'use client'

/**
 * Bombs are a parallel consumable (flat damage, cap 1, own regen), never folded
 * into tokens. Renders nothing without an envelope or with the gate off.
 */

import { memo } from 'react'
import { formatNumber } from '@tacticus/app-core/formatters'
import type { SeasonForecastEnvelope } from '@/app/lib/season-forecast/forecast-service'

interface BombsSubTableProps {
  forecast: SeasonForecastEnvelope | null
}

function BombsSubTable({ forecast }: BombsSubTableProps) {
  if (!forecast) return null
  const { bombs } = forecast

  return (
    <div
      className="rounded-md border border-(--card-border) bg-(--bg-primary) p-3 space-y-2"
      data-testid="bombs-sub-table"
      aria-label="Bomb pool summary"
    >
      <div className="text-xs font-semibold uppercase tracking-wide text-secondary-wh40k">
        Bomb pool · separate from tokens
      </div>
      <dl className="grid grid-cols-3 gap-2 text-sm">
        <div>
          <dt className="text-xs text-(--text-tertiary)">Ready now</dt>
          <dd className="font-semibold text-primary-wh40k">
            {formatNumber(bombs.available_now, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-(--text-tertiary)">Yet to regen</dt>
          <dd className="font-semibold text-primary-wh40k">
            {formatNumber(bombs.yet_to_regen, 0)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-(--text-tertiary)">By season end</dt>
          <dd className="font-semibold text-(--accent)">
            {formatNumber(bombs.capacity, 0)}
          </dd>
        </div>
      </dl>
    </div>
  )
}

export default memo(BombsSubTable)
