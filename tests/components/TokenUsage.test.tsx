import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import TokenUsage from '@/app/components/TokenUsage'

vi.mock('@tacticus/app-core/performance-monitor', () => ({
  logRender: vi.fn()
}))

vi.mock('@/app/hooks/usePerformance', () => ({
  usePerformance: vi.fn(),
  useAsyncPerformance: vi.fn(),
  useMemoryMonitor: vi.fn()
}))

vi.mock('@tacticus/ui-kit/loading', () => ({
  MechanicusEmptyState: ({
    title,
    description,
    action
  }: {
    title: string
    description: string
    action?: React.ReactNode
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  ),
  TableSkeleton: () => <div data-testid="table-skeleton" />
}))

const mockGRAvailability = vi.hoisted(() => vi.fn())

vi.mock('@/app/components/GRAvailability', () => ({
  default: (props: Record<string, unknown>) => {
    mockGRAvailability(props)
    return <div data-testid="gr-availability" />
  }
}))

vi.mock('@/app/components/filters/RarityFilterControls', () => ({
  RarityFilterControls: () => <div data-testid="rarity-filter-controls" />
}))

const mockTokenUsageData = vi.hoisted(() => ({
  players: [
    {
      playerName: 'Player1',
      tokensUsed: 10,
      tokensAvailable: 2,
      burnedTokensUsage: 1,
      historicalAvg: 8.5
    },
    {
      playerName: 'Player2',
      tokensUsed: 15,
      tokensAvailable: 1,
      burnedTokensUsage: 0,
      historicalAvg: 12
    }
  ],
  bossDistribution: [
    { boss: 'Boss1', tokens: 10 },
    { boss: 'Boss2', tokens: 15 }
  ],
  totalStats: {
    totalTokens: 25,
    avgPerPlayer: 12.5,
    maxTokens: 15,
    minTokens: 10
  },
  availabilityRows: [
    {
      player_id: 'p1',
      display_name: 'Player1',
      tokens_available: 2,
      token_next_in_seconds: 3600,
      bombs_available: 1,
      bomb_next_in_seconds: null,
      api_key_is_valid: true,
      data_source: 'live'
    }
  ],
  loading: false,
  refetch: vi.fn()
}))

vi.mock('@/app/components/token-usage', () => ({
  SummaryStats: () => <div data-testid="summary-stats" />,
  BossDistributionChart: () => <div data-testid="boss-distribution-chart" />,
  PlayerTokenChart: () => <div data-testid="player-token-chart" />,
  RarityDistributionChart: () => (
    <div data-testid="rarity-distribution-chart" />
  ),
  BurnedTokensChart: () => <div data-testid="burned-tokens-chart" />,
  HistoricalChart: () => <div data-testid="historical-chart" />,
  TokenUsageStats: () => <div data-testid="token-usage-stats" />,
  TokenUsageCalculationsFAQ: () => <div data-testid="token-faq" />,
  useTokenUsageData: vi.fn(() => mockTokenUsageData),
  DEFAULT_RARITIES: ['Legendary', 'Mythic']
}))

describe('TokenUsage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.NODE_ENV = 'test'
  })

  it('renders loading state', async () => {
    const { useTokenUsageData } =
      (await import('@/app/components/token-usage')) as any
    vi.mocked(useTokenUsageData).mockReturnValue({
      ...mockTokenUsageData,
      loading: true
    })

    render(<TokenUsage selectedGuild="TESTGUILD" selectedSeason="81" />)
    expect(screen.getByTestId('table-skeleton')).toBeInTheDocument()
  })

  it('renders empty state when no players', async () => {
    const { useTokenUsageData } =
      (await import('@/app/components/token-usage')) as any
    vi.mocked(useTokenUsageData).mockReturnValue({
      ...mockTokenUsageData,
      players: [],
      loading: false
    })

    render(<TokenUsage selectedGuild="TESTGUILD" selectedSeason="81" />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
    expect(screen.getByText('No Token Usage Data')).toBeInTheDocument()
  })

  it('renders all charts when data is available', async () => {
    const { useTokenUsageData } =
      (await import('@/app/components/token-usage')) as any
    vi.mocked(useTokenUsageData).mockReturnValue(mockTokenUsageData)

    render(<TokenUsage selectedGuild="TESTGUILD" selectedSeason="81" />)

    await waitFor(() => {
      expect(screen.getByTestId('summary-stats')).toBeInTheDocument()
      expect(screen.getByTestId('rarity-filter-controls')).toBeInTheDocument()
      expect(screen.getByTestId('gr-availability')).toBeInTheDocument()
      expect(screen.getByTestId('boss-distribution-chart')).toBeInTheDocument()
      expect(screen.getByTestId('player-token-chart')).toBeInTheDocument()
      expect(
        screen.getByTestId('rarity-distribution-chart')
      ).toBeInTheDocument()
      expect(screen.getByTestId('burned-tokens-chart')).toBeInTheDocument()
      expect(screen.getByTestId('historical-chart')).toBeInTheDocument()
      expect(screen.getByTestId('token-usage-stats')).toBeInTheDocument()
      expect(screen.getByTestId('token-faq')).toBeInTheDocument()
    })
  })

  it('normalizes guild code to uppercase', async () => {
    const { useTokenUsageData } =
      (await import('@/app/components/token-usage')) as any
    vi.mocked(useTokenUsageData).mockReturnValue(mockTokenUsageData)

    render(<TokenUsage selectedGuild="testguild" selectedSeason="81" />)

    expect(useTokenUsageData).toHaveBeenCalledWith(
      expect.objectContaining({
        guildCode: 'TESTGUILD'
      })
    )
  })

  it('passes fetched availability rows to GRAvailability for initial render', async () => {
    const { useTokenUsageData } =
      (await import('@/app/components/token-usage')) as any
    vi.mocked(useTokenUsageData).mockReturnValue(mockTokenUsageData)

    render(<TokenUsage selectedGuild="testguild" selectedSeason="81" />)

    expect(mockGRAvailability).toHaveBeenCalledWith(
      expect.objectContaining({
        guildCode: 'TESTGUILD',
        season: '81',
        initialTokenRows: mockTokenUsageData.availabilityRows
      })
    )
  })

  it('handles empty guild code', async () => {
    const { useTokenUsageData } =
      (await import('@/app/components/token-usage')) as any
    vi.mocked(useTokenUsageData).mockReturnValue({
      ...mockTokenUsageData,
      players: []
    })

    render(<TokenUsage selectedGuild="" selectedSeason="81" />)
    expect(screen.getByTestId('empty-state')).toBeInTheDocument()
  })

  it('provides retry functionality on empty state', async () => {
    const mockRefetch = vi.fn()
    const { useTokenUsageData } =
      (await import('@/app/components/token-usage')) as any
    vi.mocked(useTokenUsageData).mockReturnValue({
      ...mockTokenUsageData,
      players: [],
      refetch: mockRefetch
    })

    render(<TokenUsage selectedGuild="TESTGUILD" selectedSeason="81" />)

    const retryButton = screen.getByText('Retry sync')
    expect(retryButton).toBeInTheDocument()
  })
})
