import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { PerformanceSummaryWidgets } from '@/app/components/performance/PerformanceSummaryWidgets'
import type { PreparedPerformanceSummary } from '@/app/components/performance/types'

const buildSummary = (
  overrides: Partial<PreparedPerformanceSummary> = {}
): PreparedPerformanceSummary => ({
  displayName: 'Player One',
  avg_vs_cluster: 0,
  avg_vs_guild: 0,
  avg_vs_cluster_boss_only: 0,
  avg_vs_guild_boss_only: 0,
  total_battles: 1,
  bosses_played: 1,
  primes_played: 0,
  boss_hits: 1,
  prime_hits: 0,
  performanceValue: 10,
  basePerformanceValue: 8,
  tokenRatioApplied: 1,
  ...overrides
})

describe('PerformanceSummaryWidgets', () => {
  it('returns null when no player summaries', () => {
    render(
      <PerformanceSummaryWidgets
        playerSummaries={[]}
        topPlayer={null}
        compareMode="guild"
        performanceMode="battle-weighted"
        tokenModeActive={false}
        tokenModeUsesApproximation={false}
        tokenWeightingMode="max"
      />
    )

    expect(screen.queryByText('Performance Summary')).not.toBeInTheDocument()
  })

  it('renders token baseline details for active token mode', () => {
    const playerSummaries = [
      buildSummary({
        displayName: 'Alpha',
        performanceValue: 12,
        basePerformanceValue: 10
      }),
      buildSummary({
        displayName: 'Bravo',
        performanceValue: -4,
        basePerformanceValue: -2
      })
    ]

    render(
      <PerformanceSummaryWidgets
        playerSummaries={playerSummaries}
        topPlayer={playerSummaries[0]}
        compareMode="cluster"
        performanceMode="token-weighted"
        tokenModeActive
        tokenModeUsesApproximation
        tokenWeightingMode="average"
      />
    )

    expect(screen.getByText('Performance Summary')).toBeInTheDocument()

    const aboveSection = screen.getByText('Above Average').parentElement
    expect(aboveSection).not.toBeNull()
    expect(
      within(aboveSection as HTMLElement).getByText('1')
    ).toBeInTheDocument()

    const belowSection = screen.getByText('Below Average').parentElement
    expect(belowSection).not.toBeNull()
    expect(
      within(belowSection as HTMLElement).getByText('1')
    ).toBeInTheDocument()

    expect(
      screen.getByText('Baseline: Cluster average tokens spent.')
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        'Token weighting currently uses participation share until season token stats land.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Qualified Players: 2')).toBeInTheDocument()

    const topLine = screen.getByText(/Top Performer/)
    expect(topLine).toHaveTextContent('Token Weighting (Cluster Average)')
    expect(topLine).toHaveTextContent('Alpha')
    expect(topLine).toHaveTextContent('raw +10%')
  })

  it('warns when token mode is inactive', () => {
    const playerSummaries = [
      buildSummary({ displayName: 'Solo', performanceValue: 5 })
    ]

    render(
      <PerformanceSummaryWidgets
        playerSummaries={playerSummaries}
        topPlayer={playerSummaries[0]}
        compareMode="guild"
        performanceMode="token-weighted"
        tokenModeActive={false}
        tokenModeUsesApproximation={false}
        tokenWeightingMode="max"
      />
    )

    expect(screen.getByText(/Token stats unavailable/)).toBeInTheDocument()
    expect(screen.queryByText(/Baseline:/)).not.toBeInTheDocument()
  })
})
