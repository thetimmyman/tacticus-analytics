import { describe, it, expect, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import SummaryStats from '@/app/components/token-usage/SummaryStats'

vi.mock('@tacticus/app-core/formatters', () => ({
  formatNumber: (value: number, decimals?: number) => {
    if (typeof decimals === 'number') {
      return Number(value).toFixed(decimals)
    }
    return String(value)
  }
}))

const makePlayer = (overrides: Partial<any>) => ({
  userId: 'u1',
  displayName: 'Alpha',
  totalTokens: 0,
  bossTokens: 0,
  primeTokens: 0,
  avgTokensPerLoop: 0,
  efficiency: 0,
  tokensByRarity: {
    common: 0,
    uncommon: 0,
    rare: 0,
    epic: 0,
    legendary: 0,
    mythic: 0
  },
  ...overrides
})

describe('SummaryStats', () => {
  it('renders stats, data sources, and average regen', () => {
    const players = [
      makePlayer({
        userId: 'u1',
        dataSource: 'live',
        tokensAvailable: 2,
        tokenNextSeconds: 3600
      }),
      makePlayer({
        userId: 'u2',
        dataSource: 'calculated',
        tokensAvailable: 1,
        tokenNextSeconds: 1800
      }),
      makePlayer({ userId: 'u3', dataSource: 'default', tokensAvailable: 3 }),
      makePlayer({ userId: 'u4', tokensAvailable: 0 })
    ]

    render(
      <SummaryStats
        totalStats={{
          totalTokens: 42,
          maxTokens: 7,
          averageUsage: 3.5,
          tokensAvailableAvg: 1.2,
          bombsAvailableCount: 2
        }}
        totalTokensAvailable={9}
        totalBurned={4}
        players={players}
        showBurned
      />
    )

    expect(screen.getByText('Total Tokens')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('Max by Player')).toBeInTheDocument()
    expect(screen.getByText('7')).toBeInTheDocument()
    expect(screen.getByText('Average Usage')).toBeInTheDocument()
    expect(screen.getByText('3.5')).toBeInTheDocument()
    expect(screen.getByText('Avg Tokens Available')).toBeInTheDocument()
    expect(screen.getByText('1.2')).toBeInTheDocument()
    expect(screen.getByText('Total Tokens Available')).toBeInTheDocument()
    expect(screen.getByText('9')).toBeInTheDocument()
    const bombsCard = screen
      .getByText('Bombs Ready (count)')
      .closest('.stat-card-wh40k')
    expect(bombsCard).not.toBeNull()
    expect(within(bombsCard as HTMLElement).getByText('2')).toBeInTheDocument()

    expect(screen.queryByText('5-Season Veterans')).toBeNull()
    expect(screen.getByText('Behind pace')).toBeInTheDocument()
    expect(screen.getByText('4')).toBeInTheDocument()

    expect(screen.getByText('Data Sources:')).toBeInTheDocument()
    expect(screen.getByText('1 Live')).toBeInTheDocument()
    expect(screen.getByText('1 Estimated')).toBeInTheDocument()
    expect(screen.getByText('2 Default')).toBeInTheDocument()
    expect(screen.getByText('1 capped (3/3)')).toBeInTheDocument()
    expect(screen.getByText('Avg regen: 45m')).toBeInTheDocument()
  })

  it('omits average regen when no eligible players', () => {
    const players = [
      makePlayer({
        userId: 'u1',
        dataSource: 'live',
        tokensAvailable: 3,
        tokenNextSeconds: 3600
      }),
      makePlayer({
        userId: 'u2',
        dataSource: 'calculated',
        tokensAvailable: 3,
        tokenNextSeconds: null
      })
    ]

    render(
      <SummaryStats
        totalStats={{
          totalTokens: 10,
          maxTokens: 5,
          averageUsage: 2.5,
          tokensAvailableAvg: 3,
          bombsAvailableCount: 0
        }}
        totalTokensAvailable={6}
        totalBurned={0}
        players={players}
      />
    )

    expect(screen.queryByText(/Avg regen:/)).not.toBeInTheDocument()
  })
})
