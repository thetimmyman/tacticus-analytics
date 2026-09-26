import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PerformanceBurnStats } from '@/app/components/performance/PerformanceBurnStats'

describe('PerformanceBurnStats', () => {
  it('renders loading state', () => {
    render(
      <PerformanceBurnStats
        season="31"
        isLoading
        burnSummary={{
          hasData: false,
          totalBurnedTokens: 0,
          totalOvercappedTokens: 0,
          playersWithBurnedTokens: 0,
          totalTimeOverCapSeconds: 0,
          topBurnedPlayers: []
        }}
      />
    )

    expect(screen.getByText('Token Waste Snapshot')).toBeInTheDocument()
    expect(screen.getByText('Loading burn statistics...')).toBeInTheDocument()
  })

  it('renders empty-data message', () => {
    render(
      <PerformanceBurnStats
        season="31"
        burnSummary={{
          hasData: false,
          totalBurnedTokens: 0,
          totalOvercappedTokens: 0,
          playersWithBurnedTokens: 0,
          totalTimeOverCapSeconds: 0,
          topBurnedPlayers: []
        }}
      />
    )

    expect(
      screen.getByText(
        'Burn statistics are not available for this guild and season yet.'
      )
    ).toBeInTheDocument()
  })

  it('renders burn metrics and impacted players', () => {
    render(
      <PerformanceBurnStats
        season="31"
        burnSummary={{
          hasData: true,
          totalBurnedTokens: 5,
          totalOvercappedTokens: 1,
          playersWithBurnedTokens: 2,
          totalTimeOverCapSeconds: 10800,
          topBurnedPlayers: [
            {
              displayName: 'Alpha',
              burnedTokens: 3,
              overcappedTokens: 1,
              timeOverCapSeconds: 7200
            },
            {
              displayName: 'Bravo',
              burnedTokens: 2,
              overcappedTokens: 0,
              timeOverCapSeconds: 3600
            }
          ]
        }}
      />
    )

    expect(screen.getAllByText('Behind pace').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Overcapped').length).toBeGreaterThan(0)
    expect(screen.getByText('Players Behind Pace 1+')).toBeInTheDocument()
    expect(screen.getByText('Total Time Over Cap')).toBeInTheDocument()
    expect(screen.getByText('Most Impacted Players')).toBeInTheDocument()
    expect(screen.getByText('Alpha')).toBeInTheDocument()
    expect(screen.getByText('Bravo')).toBeInTheDocument()
    expect(screen.getByText('3h')).toBeInTheDocument()
  })
})
