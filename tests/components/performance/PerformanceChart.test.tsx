import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PerformanceChart } from '@/app/components/performance/PerformanceChart'

function renderTargetScore(score: number) {
  const { container } = render(
    <PerformanceChart
      compareMode="guild"
      performanceMode="target-weighted"
      tokenModeActive={false}
      showChartLines={false}
      onToggleChartLines={vi.fn()}
      playerSummaries={[
        {
          playerId: 'player-1',
          displayName: 'Target Player',
          avg_vs_cluster: 0,
          avg_vs_guild: 0,
          avg_vs_cluster_boss_only: 0,
          avg_vs_guild_boss_only: 0,
          total_battles: 1,
          bosses_played: 1,
          primes_played: 0,
          boss_hits: 1,
          prime_hits: 0,
          performanceValue: score,
          basePerformanceValue: score,
          tokenRatioApplied: 1
        }
      ]}
      chartMax={100}
      getBarColor={() => 'bg-red-600'}
      getTextColor={() => 'text-red-400'}
    />
  )

  const displayedScore = score.toFixed(2)
  const bar = container.querySelector(
    `[title^="Target-weighted score: ${displayedScore}"]`
  )
  expect(bar).not.toBeNull()
  return bar!
}

describe('PerformanceChart', () => {
  it.each([
    [0.89, 'bg-red-500/80'],
    [0.895, 'bg-orange-400'],
    [0.9, 'bg-orange-400'],
    [0.94, 'bg-orange-400'],
    [0.95, 'bg-yellow-400'],
    [0.99, 'bg-yellow-400'],
    [1.0, 'bg-accent-wh40k'],
    [1.1, 'bg-accent-wh40k'],
    [1.11, 'bg-emerald-400']
  ])(
    'classifies target-weighted score %s with display-aligned color %s',
    (score, expectedClass) => {
      const bar = renderTargetScore(score)

      expect(bar).toHaveClass(expectedClass)
      if (score >= 0.9 && score < 1.0) {
        expect(bar).not.toHaveClass('bg-red-500/80')
      }
    }
  )

  it('uses the rounded display score for target status text', () => {
    const bar = renderTargetScore(0.996)

    expect(bar).toHaveAttribute(
      'title',
      'Target-weighted score: 1.00 - on target'
    )
    expect(screen.getByText('on target')).toBeInTheDocument()
  })

  it('uses valid list semantics in battle-weighted mode', () => {
    render(
      <PerformanceChart
        compareMode="guild"
        performanceMode="battle-weighted"
        tokenModeActive={false}
        showChartLines={false}
        onToggleChartLines={vi.fn()}
        playerSummaries={[
          {
            playerId: 'player-1',
            displayName: 'Alpha',
            avg_vs_cluster: 0,
            avg_vs_guild: 10,
            avg_vs_cluster_boss_only: 0,
            avg_vs_guild_boss_only: 0,
            total_battles: 1,
            bosses_played: 1,
            primes_played: 0,
            boss_hits: 1,
            prime_hits: 0,
            performanceValue: 10,
            basePerformanceValue: 10,
            tokenRatioApplied: 1
          },
          {
            playerId: 'player-2',
            displayName: 'Bravo',
            avg_vs_cluster: 0,
            avg_vs_guild: -5,
            avg_vs_cluster_boss_only: 0,
            avg_vs_guild_boss_only: 0,
            total_battles: 1,
            bosses_played: 1,
            primes_played: 0,
            boss_hits: 1,
            prime_hits: 0,
            performanceValue: -5,
            basePerformanceValue: -5,
            tokenRatioApplied: 1
          }
        ]}
        chartMax={40}
        getBarColor={() => 'bg-red-600'}
        getTextColor={() => 'text-red-400'}
      />
    )

    expect(screen.getByRole('list')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })
})
