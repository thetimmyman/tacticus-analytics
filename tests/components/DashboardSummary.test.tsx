import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import DashboardSummary from '@/app/components/DashboardSummary'
import * as queryHooks from '@/app/lib/hooks/queries'

vi.mock('@/app/lib/hooks/queries', () => ({
  useTokenUsageByLoop: vi.fn(() => ({ data: [], isLoading: false })),
  useTokenUsageByLoopAndSet: vi.fn(() => ({
    data: { chartData: [], levelKeys: [] },
    isLoading: false
  })),
  useDamageByBossLoop: vi.fn(() => ({ data: [], isLoading: false })),
  useBossPerformanceMetrics: vi.fn(() => ({ data: [], isLoading: false })),
  useGuildVsClusterBoss: vi.fn(() => ({ data: [], isLoading: false })),
  useGuildVsClusterPrime: vi.fn(() => ({ data: [], isLoading: false })),
  useTotalDamage: vi.fn(() => ({
    data: { total_damage: 1000000 },
    isLoading: false
  })),
  useMaxLoop: vi.fn(() => ({ data: { max_loop: 5 }, isLoading: false }))
}))

vi.mock('@/app/hooks/useDebounce', () => ({
  useDebounce: vi.fn((value) => value)
}))

vi.mock('@/app/lib/hooks/usePerformanceOptimized', () => ({
  usePerformanceMonitor: vi.fn(() => ({ start: vi.fn(), end: vi.fn() }))
}))

vi.mock('@/app/components/visualizations/ProgressBar', () => ({
  ProgressBar: ({
    label,
    avgValue,
    maxValue,
    vsClusterPercent
  }: {
    label: string
    avgValue: number
    maxValue: number
    vsClusterPercent?: number
  }) => (
    <div data-testid="progress-bar">
      {label} {avgValue} {maxValue} {vsClusterPercent ?? ''}
    </div>
  ),
  StackedProgressBar: ({ label, total }: { label: string; total: number }) => (
    <div data-testid="stacked-progress-bar">
      {label} total:{total}
    </div>
  )
}))

vi.mock('@/app/components/RechartsWrapper', () => ({
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  PieChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="pie-chart">{children}</div>
  ),
  Pie: () => null,
  Cell: () => null,
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
  ),
  Line: () => null,
  Legend: () => null,
  BarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="bar-chart">{children}</div>
  ),
  Bar: () => null,
  LabelList: () => null,
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  )
}))

vi.mock('@/app/components/LazyBattleLog', () => ({
  default: () => <div data-testid="lazy-battle-log" />
}))

vi.mock('@/app/components/dashboard/BossPerformanceTrends', () => ({
  BossPerformanceTrends: () => <div data-testid="boss-performance-trends" />
}))

vi.mock('@/app/components/dashboard/SystemHealthWidget', () => ({
  SystemHealthWidget: () => <div data-testid="system-health-widget" />
}))

vi.mock('@/app/components/filters/RarityFilterControls', () => ({
  RarityFilterControls: () => <div data-testid="rarity-filter-controls" />
}))

vi.mock('@/app/components/SeasonSelector', () => ({
  default: () => <div data-testid="season-selector" />
}))

vi.mock('@/app/components/error', () => ({
  DataErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ChartErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@tacticus/app-core/formatters', () => ({
  formatNumber: vi.fn((v) => String(v)),
  formatDamage: vi.fn((v) => `${(v / 1000000).toFixed(1)}M`),
  formatPercentage: vi.fn((v) => `${(v * 100).toFixed(0)}%`)
}))

vi.mock('@tacticus/charting/theme', () => ({
  getChartPalette: vi.fn(() => ['#ff0000', '#00ff00', '#0000ff'])
}))

vi.mock('@tacticus/charting', () => ({
  getTooltipStyles: vi.fn(() => ({ contentStyle: {} })),
  DEFAULT_AXIS_STYLES: {},
  DEFAULT_GRID_STYLES: {},
  CHART_MARGINS: { default: { top: 5, right: 30, left: 20, bottom: 5 } }
}))

vi.mock('@tacticus/app-core/rarity-utils', () => ({
  getRarityPrefix: vi.fn((r) => r.charAt(0)),
  normalizeRarity: vi.fn((r) => r),
  Rarity: {}
}))

vi.mock('@tacticus/ui-kit/loading', () => ({
  MechanicusEmptyState: ({
    title,
    description
  }: {
    title: string
    description: string
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  )
}))

describe('DashboardSummary', () => {
  const mockedQueries = vi.mocked(queryHooks)

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.resolve({}) })
    ) as any

    mockedQueries.useTokenUsageByLoop.mockReturnValue({
      data: {},
      isLoading: false
    })
    mockedQueries.useTokenUsageByLoopAndSet.mockReturnValue({
      data: {},
      isLoading: false
    })
    mockedQueries.useDamageByBossLoop.mockReturnValue({
      data: { data: [], bosses: [] },
      isLoading: false
    })
    mockedQueries.useBossPerformanceMetrics.mockReturnValue({
      data: [],
      isLoading: false
    })
    mockedQueries.useGuildVsClusterBoss.mockReturnValue({
      data: [],
      isLoading: false
    })
    mockedQueries.useGuildVsClusterPrime.mockReturnValue({
      data: [],
      isLoading: false
    })
    mockedQueries.useTotalDamage.mockReturnValue({
      data: 1000000,
      isLoading: false
    })
    mockedQueries.useMaxLoop.mockReturnValue({ data: 0, isLoading: false })
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('renders with required props', async () => {
    render(
      <DashboardSummary
        selectedGuild="TESTGUILD"
        selectedSeason="81"
        hasCluster={true}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('rarity-filter-controls')).toBeInTheDocument()
    })
  })

  it('renders without cluster support', async () => {
    render(
      <DashboardSummary
        selectedGuild="TESTGUILD"
        selectedSeason="81"
        hasCluster={false}
      />
    )

    await waitFor(() => {
      expect(screen.getByTestId('rarity-filter-controls')).toBeInTheDocument()
    })
  })

  it('handles empty guild gracefully', async () => {
    render(<DashboardSummary selectedGuild="" selectedSeason="81" />)

    expect(screen.getByText('Loading dashboard data...')).toBeInTheDocument()
  })

  it('displays performance trends component', async () => {
    render(<DashboardSummary selectedGuild="TESTGUILD" selectedSeason="81" />)

    await waitFor(() => {
      expect(screen.getByTestId('boss-performance-trends')).toBeInTheDocument()
    })
  })

  it('shows empty states when charts load without boss data', () => {
    vi.useFakeTimers()

    render(
      <DashboardSummary
        selectedGuild="TESTGUILD"
        selectedSeason="81"
        hasCluster={true}
      />
    )

    act(() => {
      vi.runAllTimers()
    })

    expect(screen.getByText('No Boss data Available')).toBeInTheDocument()
    expect(screen.getByText('No Prime data Available')).toBeInTheDocument()
  })

  it('renders progress bars and charts when data is available', () => {
    vi.useFakeTimers()

    mockedQueries.useBossPerformanceMetrics.mockReturnValue({
      data: [
        {
          bossName: 'Boss Alpha',
          tier: 2,
          set: 1,
          rarity: 'Legendary',
          avgDamage: 1000,
          maxDamage: 2000,
          hitCount: 5,
          encounterId: 0
        },
        {
          primeName: 'Prime Omega',
          tier: 1,
          set: 0,
          rarity: 'Mythic',
          avgDamage: 500,
          maxDamage: 800,
          hitCount: 2,
          encounterId: 1
        }
      ],
      isLoading: false
    })
    mockedQueries.useGuildVsClusterBoss.mockReturnValue({
      data: [
        {
          boss_name: 'Boss Alpha',
          set: 1,
          rarity: 'Legendary',
          encounter_type: 'Boss',
          vs_cluster_percent: 0.25
        }
      ],
      isLoading: false
    })
    mockedQueries.useGuildVsClusterPrime.mockReturnValue({
      data: [
        {
          prime_name: 'Prime Omega',
          set: 0,
          rarity: 'Mythic',
          vs_cluster_percent: 0.4
        }
      ],
      isLoading: false
    })
    mockedQueries.useTokenUsageByLoop.mockReturnValue({
      data: {
        0: { bosses: 2, primes: 1, rarities: ['Legendary'] },
        2: { bosses: 1, primes: 0, rarities: [] }
      },
      isLoading: false
    })
    mockedQueries.useTokenUsageByLoopAndSet.mockReturnValue({
      data: {
        0: { total: 3, L1: 1, L2: 2 },
        2: { total: 1, M1: 1 }
      },
      isLoading: false
    })
    mockedQueries.useDamageByBossLoop.mockReturnValue({
      data: {
        data: [
          { loop: 0, 'Boss Alpha': 1000 },
          { loop: 2, 'Boss Alpha': 1200 }
        ],
        bosses: ['Boss Alpha']
      },
      isLoading: false
    })
    mockedQueries.useMaxLoop.mockReturnValue({ data: 2, isLoading: false })

    render(
      <DashboardSummary
        selectedGuild="TESTGUILD"
        selectedSeason="81"
        hasCluster={true}
      />
    )

    act(() => {
      vi.runAllTimers()
    })

    expect(screen.getAllByTestId('progress-bar')).toHaveLength(2)
    expect(screen.getAllByTestId('stacked-progress-bar')).toHaveLength(2)
    expect(screen.getByTestId('bar-chart')).toBeInTheDocument()
    expect(screen.getByTestId('line-chart')).toBeInTheDocument()
    expect(screen.getByTestId('composed-chart')).toBeInTheDocument()
    expect(screen.getByText('Total: 4')).toBeInTheDocument()
    expect(screen.getByText('1.0M')).toBeInTheDocument()
  })
})
