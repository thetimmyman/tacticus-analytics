import type { ReactNode } from 'react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BossPerformanceTrends } from '@/app/components/dashboard/BossPerformanceTrends'
import * as queryHooks from '@/app/lib/hooks/queries'

vi.mock('@/app/lib/hooks/queries', () => ({
  useBossPerformanceMetrics: vi.fn(),
  useBossDifficultyAnalysis: vi.fn(),
  useDamageByBossLoop: vi.fn(),
  useTokenUsageByLoop: vi.fn()
}))

vi.mock('@/app/lib/hooks/usePerformanceOptimized', () => ({
  usePerformanceMonitor: vi.fn(() => ({ start: vi.fn(), end: vi.fn() }))
}))

vi.mock('@/app/components/error', () => ({
  ChartErrorBoundary: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@tacticus/app-core/formatters', () => ({
  formatNumber: vi.fn((value: number) => String(Math.round(value))),
  formatPercentage: vi.fn((value: number) => `${value}%`),
  formatDuration: vi.fn((value: number) => `${value}s`),
  formatDamage: vi.fn((value: number) => `${Math.round(value)}`)
}))

vi.mock('@/app/lib/ml/performance-predictor', () => ({
  buildBossMlInsight: vi.fn(() => ({
    consistencyScore: {
      score: 82,
      rating: 'good',
      description: 'Steady performance'
    },
    trendAnalysis: {
      direction: 'stable',
      strength: 'moderate',
      confidence: 60,
      changeRate: 0
    },
    performanceStats: {
      mean: 0,
      median: 0,
      standardDeviation: 0,
      variance: 0,
      coefficient_of_variation: 0
    },
    hasAnomalies: false,
    riskLevel: 'low',
    sampleSize: 8,
    source: 'historical',
    prediction: {
      expectedDamagePerHit: 0,
      confidenceInterval: [0, 0],
      confidence: 75,
      basis: 'historical',
      sampleSize: 8
    }
  }))
}))

describe('BossPerformanceTrends', () => {
  const mockedQueries = vi.mocked(queryHooks)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders loading state', () => {
    mockedQueries.useBossPerformanceMetrics.mockReturnValue({
      data: undefined,
      isLoading: true
    })
    mockedQueries.useBossDifficultyAnalysis.mockReturnValue({
      data: [],
      isLoading: false
    })
    // @ts-expect-error - mock types are partial
    mockedQueries.useDamageByBossLoop.mockReturnValue({
      data: undefined,
      isLoading: true
    })
    // @ts-expect-error - mock types are partial
    mockedQueries.useTokenUsageByLoop.mockReturnValue({
      data: undefined,
      isLoading: true
    })

    render(<BossPerformanceTrends selectedGuild="TEST" selectedSeason="1" />)

    expect(screen.getByText('Boss Performance Trends')).toBeInTheDocument()
  })

  it('renders empty state when no metrics are available', () => {
    mockedQueries.useBossPerformanceMetrics.mockReturnValue({
      data: [],
      isLoading: false
    })
    mockedQueries.useBossDifficultyAnalysis.mockReturnValue({
      data: [],
      isLoading: false
    })
    // @ts-expect-error - mock types are partial
    mockedQueries.useDamageByBossLoop.mockReturnValue({
      data: { data: [], bosses: [] },
      isLoading: false
    })
    // @ts-expect-error - mock types are partial
    mockedQueries.useTokenUsageByLoop.mockReturnValue({
      data: {},
      isLoading: false
    })

    render(<BossPerformanceTrends selectedGuild="TEST" selectedSeason="1" />)

    expect(
      screen.getByText('No boss performance data available for this season')
    ).toBeInTheDocument()
  })

  it('filters by target type selection', () => {
    mockedQueries.useBossPerformanceMetrics.mockReturnValue({
      data: [
        {
          bossName: 'Mortar',
          encounterId: 0,
          rarity: 'Legendary',
          set: 0,
          avgDamage: 10000,
          hitCount: 60,
          totalDamage: 600000,
          maxDamage: 20000
        },
        {
          bossName: 'Prime X',
          encounterId: 1,
          rarity: 'Mythic',
          set: 1,
          avgDamage: 40000,
          hitCount: 4,
          totalDamage: 160000,
          maxDamage: 50000
        }
      ],
      isLoading: false
    })
    mockedQueries.useBossDifficultyAnalysis.mockReturnValue({
      data: [
        {
          name: 'Mortar',
          rarity: 'Legendary',
          set: 0,
          encounterId: 0,
          timeMinutes: 12,
          completedLoops: 1
        }
      ],
      isLoading: false
    })
    // @ts-expect-error - mock types are partial
    mockedQueries.useDamageByBossLoop.mockReturnValue({
      data: {
        data: [{ loop: 0, 'L1 Mortar': 10000 }],
        bosses: ['L1 Mortar']
      },
      isLoading: false
    })
    // @ts-expect-error - mock types are partial
    mockedQueries.useTokenUsageByLoop.mockReturnValue({
      data: {
        0: { bosses: 60, primes: 0, rarities: ['Legendary'], displayLoop: 0 }
      },
      isLoading: false
    })

    render(<BossPerformanceTrends selectedGuild="TEST" selectedSeason="1" />)

    expect(screen.getByText('Boss Performance Analysis')).toBeInTheDocument()
    expect(screen.getByText('L1 Mortar')).toBeInTheDocument()
    expect(screen.getByText('M2 Prime X')).toBeInTheDocument()

    fireEvent.change(screen.getByDisplayValue('All Targets'), {
      target: { value: 'bosses' }
    })

    expect(screen.getByDisplayValue('Bosses Only')).toBeInTheDocument()
    expect(screen.queryByText('M2 Prime X')).not.toBeInTheDocument()
  })

  it('expands the loop analysis table and boss detail rows through the extracted sections', () => {
    mockedQueries.useBossPerformanceMetrics.mockReturnValue({
      data: [
        {
          bossName: 'Mortar',
          encounterId: 0,
          rarity: 'Legendary',
          set: 0,
          avgDamage: 10000,
          hitCount: 60,
          totalDamage: 600000,
          maxDamage: 20000
        }
      ],
      isLoading: false
    })
    mockedQueries.useBossDifficultyAnalysis.mockReturnValue({
      data: [
        {
          name: 'Mortar',
          rarity: 'Legendary',
          set: 0,
          encounterId: 0,
          timeMinutes: 12,
          completedLoops: 1
        }
      ],
      isLoading: false
    })
    // @ts-expect-error - mock types are partial
    mockedQueries.useDamageByBossLoop.mockReturnValue({
      data: {
        data: [{ loop: 0, 'L1 Mortar': 10000 }],
        bosses: ['L1 Mortar'],
        detailedData: [
          {
            loop: 0,
            bossName: 'L1 Mortar',
            avgDamage: 10000,
            maxDamage: 20000,
            totalDamage: 600000,
            hitCount: 60,
            startTime: '2026-08-01T00:00:00Z',
            endTime: '2026-08-01T00:12:00Z',
            isPrime: false
          }
        ]
      },
      isLoading: false
    })
    // @ts-expect-error - mock types are partial
    mockedQueries.useTokenUsageByLoop.mockReturnValue({
      data: {
        0: { bosses: 60, primes: 0, rarities: ['Legendary'], displayLoop: 0 }
      },
      isLoading: false
    })

    render(<BossPerformanceTrends selectedGuild="TEST" selectedSeason="1" />)

    expect(screen.queryByText('Perf. Well')).not.toBeInTheDocument()
    fireEvent.click(screen.getByTitle('Click to toggle detailed loop analysis'))
    expect(screen.getByText('Perf. Well')).toBeInTheDocument()
    expect(screen.getByText('Loop 1')).toBeInTheDocument()

    expect(screen.queryByText('Total Dmg')).not.toBeInTheDocument()
    fireEvent.click(screen.getByText('L1 Mortar'))
    expect(screen.getByText('Total Dmg')).toBeInTheDocument()
    expect(screen.getAllByText('Loop 1')).toHaveLength(2)
    expect(screen.getByText('720s')).toBeInTheDocument()
  })
})
