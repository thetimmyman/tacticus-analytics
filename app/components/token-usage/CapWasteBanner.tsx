'use client'

/**
 * Cap-waste warning: pace-model figures when present, else the envelope heuristic.
 * Dismissible per guild + season; memoized so availability updates skip the chart.
 */

import { memo, useEffect, useState } from 'react'
import { InlineAlert } from '@/app/components/ui'
import type {
  SeasonForecastTokens,
  SeasonForecastEnvelope
} from '@/app/lib/season-forecast/forecast-service'
import { selectSpendableCapFigures } from '@/app/lib/season-forecast/pace-figures'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'

interface CapWasteBannerProps {
  forecast: SeasonForecastEnvelope | null
  /** Rotation outlook for pace-model figures; null → envelope fallback. */
  outlook?: SeasonOutlookProjection | null
  guildCode: string
  season: string
}

const dismissalKey = (guild: string, season: string): string =>
  `wi767:cap-waste-banner-dismissed:${guild}:${season}`

function CapWasteBanner({
  forecast,
  outlook = null,
  guildCode,
  season
}: CapWasteBannerProps) {
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    try {
      const key = dismissalKey(guildCode, season)

      setDismissed(window.sessionStorage.getItem(key) === '1')
    } catch {
      setDismissed(false)
    }
  }, [guildCode, season])

  if (!forecast || dismissed) return null

  const { tokens } = forecast
  const figures = selectSpendableCapFigures({
    outlook,
    envelope: {
      spendableByEnd: tokens.available_now + tokens.yet_to_regen,
      capBoundPlayers: tokens.cap_bound_players ?? 0,
      estimatedCapWaste: tokens.estimated_cap_waste ?? 0
    }
  })
  const capBoundPlayers = figures.capBoundPlayers
  if (capBoundPlayers <= 0) return null

  const handleDismiss = () => {
    try {
      window.sessionStorage.setItem(dismissalKey(guildCode, season), '1')
    } catch {
      // sessionStorage unavailable: dismiss for this render only.
    }
    setDismissed(true)
  }

  return (
    <InlineAlert
      tone="warning"
      title={`${capBoundPlayers} player${capBoundPlayers === 1 ? '' : 's'} will likely cap before season end`}
      action={
        <button
          type="button"
          onClick={handleDismiss}
          className="text-xs text-secondary-wh40k underline hover:text-primary-wh40k"
        >
          Dismiss for this session
        </button>
      }
    >
      {figures.source === 'pace' ? (
        <>
          ~{figures.estimatedCapWaste} tokens projected lost at the guild&apos;s
          current spending pace (rotation outlook model).
        </>
      ) : (
        <>
          ~{figures.estimatedCapWaste} tokens projected lost. Heuristic: these
          players have <code>time_over_cap_seconds &gt; 0</code> historically
          AND are projected to hit the 3-token cap before the season ends.
        </>
      )}
    </InlineAlert>
  )
}

export default memo(CapWasteBanner)
export type { SeasonForecastTokens }
