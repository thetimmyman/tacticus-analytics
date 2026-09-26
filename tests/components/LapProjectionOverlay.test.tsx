import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LapProjectionOverlay } from '@/app/components/ui/LapProjectionOverlay'
import type {
  SeasonForecastLapProjection,
  SeasonForecastTokens
} from '@/app/lib/season-forecast/forecast-service'

describe('LapProjectionOverlay', () => {
  it('shows future remaining tokens without subtracting current-lap spend again', () => {
    const lapProjection: SeasonForecastLapProjection = {
      current_lap: 6,
      tokens_into_current_lap: 24,
      projected_lap_cost: 125,
      basis: 'last_n_laps',
      n: 2,
      projected_finish_lap: 6,
      projected_finish_pct: 0.47,
      confidence: 'medium'
    }
    const tokens: SeasonForecastTokens = {
      available_now: 34,
      yet_to_regen: 138,
      capacity: 172,
      cap_bound_players: 0,
      estimated_cap_waste: 0
    }

    render(
      <LapProjectionOverlay lapProjection={lapProjection} tokens={tokens} />
    )

    expect(screen.getByText('Tokens left to spend')).toBeInTheDocument()
    expect(screen.getByText('172')).toBeInTheDocument()
    expect(screen.queryByText('148')).toBeNull()
  })
})
