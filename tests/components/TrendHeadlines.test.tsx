/** Headlines are the signed regression slope, never "N/A" (CAGR is undefined for zero-crossing series). */
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { HistoricalPerformanceSection } from '@/app/components/playerstats/OverviewTab'
import { GuildPerformanceTrendChart } from '@/app/components/guild-trends/GuildPerformanceTrendChart'
import { GuildReliabilityTrendChart } from '@/app/components/guild-trends/GuildReliabilityTrendChart'
import type { GuildTrendsRow } from '@/app/lib/hooks/queries'

vi.mock('@tacticus/ui-kit', () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CardContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardHeader: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  CardTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  TooltipWrapper: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  )
}))

vi.mock('@tacticus/charting/tooltip', () => ({
  getTooltipStyles: () => ({ contentStyle: {} }),
  DEFAULT_RECHARTS_TOOLTIP_PROPS: { contentStyle: {} },
  asNumericTooltipFormatter: (fn: (v: unknown, n?: unknown) => unknown) => fn
}))

vi.mock('@tacticus/app-core/formatters', () => ({
  formatDamage: vi.fn((v: number) => String(v)),
  formatNumber: vi.fn((v: number) => String(v)),
  formatPercentage: vi.fn((v: number) => `${(v * 100).toFixed(0)}%`),
  formatPercentageDiff: vi.fn((v: number) =>
    v >= 0 ? `+${v.toFixed(0)}%` : `${v.toFixed(0)}%`
  )
}))

vi.mock('@/app/lib/catalogs/rarity-set', () => ({
  getBossLevelFromSetAndRarity: vi.fn(() => 'L4')
}))

// A concrete shape avoids adding to the frozen `unknown` baseline.
type ChartRow = Record<string, string | number | null | undefined>

vi.mock('@/app/components/RechartsWrapper', () => ({
  RadarChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="radar-chart">{children}</div>
  ),
  Radar: () => null,
  PolarGrid: () => null,
  PolarAngleAxis: () => null,
  PolarRadiusAxis: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  Legend: () => null,
  Tooltip: () => null,
  ReferenceLine: () => null,
  ComposedChart: ({
    children,
    data
  }: {
    children: React.ReactNode
    data?: ChartRow[]
  }) => (
    <div data-testid="composed-chart" data-chart={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  LineChart: ({
    children,
    data
  }: {
    children: React.ReactNode
    data?: ChartRow[]
  }) => (
    <div data-testid="line-chart" data-chart={JSON.stringify(data ?? [])}>
      {children}
    </div>
  ),
  Line: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null
}))

// Reversed into the prop (newest-first); hand-computed slopes: vsGuild 6.3, vsCluster -2.0, reliability 25.0.
const chronological = [
  {
    season: 'S100',
    vsGuild: -13,
    vsCluster: 10,
    tokens: 10,
    totalDamage: 1_000_000,
    reliability: 0
  },
  {
    season: 'S101',
    vsGuild: -5,
    vsCluster: 8,
    tokens: 20,
    totalDamage: 3_000_000,
    reliability: 25
  },
  {
    season: 'S102',
    vsGuild: 0,
    vsCluster: 6,
    tokens: 0,
    totalDamage: 0,
    reliability: 50
  },
  {
    season: 'S103',
    vsGuild: 8,
    vsCluster: 4,
    tokens: 20,
    totalDamage: 5_000_000,
    reliability: 75
  },
  {
    season: 'S104',
    vsGuild: 12,
    vsCluster: 2,
    tokens: 25,
    totalDamage: 10_000_000,
    reliability: 100
  }
]

const historicalData = {
  fiveSeasonAvgGuild: 0,
  fiveSeasonAvgCluster: 0,
  radarData: [...chronological].reverse()
}

const renderSection = (hasValidCluster = true) =>
  render(
    <HistoricalPerformanceSection
      data={historicalData}
      hasValidCluster={hasValidCluster}
      selectedSeason="104"
    />
  )

describe('HistoricalPerformanceSection trend headlines', () => {
  it('shows the signed per-season slope for a zero-crossing vs-Guild series, never N/A', () => {
    renderSection()
    expect(screen.getByText('Guild Trend:')).toBeInTheDocument()
    expect(screen.getByText('+6.3%')).toBeInTheDocument()
    expect(screen.queryByText('N/A')).not.toBeInTheDocument()
  })

  it('shows a signed negative slope for a declining vs-Cluster series', () => {
    renderSection()
    expect(screen.getByText('Cluster Trend:')).toBeInTheDocument()
    expect(screen.getByText('-2.0%')).toBeInTheDocument()
  })

  it('hides the cluster headline without a valid cluster', () => {
    renderSection(false)
    expect(screen.queryByText('Cluster Trend:')).not.toBeInTheDocument()
  })

  it('shows the reliability slope even when a season scored 0 (CAGR-undefined case)', () => {
    renderSection()
    expect(screen.getByText('Trend:')).toBeInTheDocument()
    expect(screen.getByText('+25.0')).toBeInTheDocument()
  })

  it('plots the consistency panel VERBATIM from totalDamage (already per-token; null when tokens=0)', () => {
    renderSection()
    const charts = screen.getAllByTestId('composed-chart')
    const consistency = charts
      .map((el) => JSON.parse(el.getAttribute('data-chart') ?? '[]'))
      .find(
        (rows: ChartRow[]) =>
          rows.length > 0 && 'avgDamagePerToken' in (rows[0] ?? {})
      ) as Array<{ season: string; avgDamagePerToken: number | null }>
    expect(consistency).toBeDefined()
    // totalDamage is already per-token; a second division must fail here.
    expect(consistency[0]?.avgDamagePerToken).toBe(1_000_000)
    expect(consistency[2]?.avgDamagePerToken).toBeNull() // 0 tokens → null, no fake zero
    expect(consistency[4]?.avgDamagePerToken).toBe(10_000_000)
  })
})

const guildTrendsRow = (
  season: string,
  overrides: Partial<GuildTrendsRow>
): GuildTrendsRow => ({
  season,
  total_damage: 1_000_000,
  total_battles: 100,
  max_hit: 50_000,
  boss_kills: 10,
  active_players: 25,
  guild_member_count: 30,
  participation_rate: 0.8,
  avg_damage_per_token: 10_000,
  vs_cluster_percent: 0,
  guild_rank_in_cluster: 3,
  total_guilds_in_cluster: 10,
  reliability_score: 80,
  ...overrides
})

describe('guild-trends chart headlines', () => {
  it('GuildPerformanceTrendChart shows the slope for a zero-crossing vs-Cluster series', () => {
    const data = [
      guildTrendsRow('100', { vs_cluster_percent: -5 }),
      guildTrendsRow('101', { vs_cluster_percent: 0 }),
      guildTrendsRow('102', { vs_cluster_percent: 5 })
    ]
    render(<GuildPerformanceTrendChart data={data} />)
    expect(screen.getByText('Trend:')).toBeInTheDocument()
    expect(screen.getByText('+5.0%')).toBeInTheDocument()
    expect(screen.queryByText('N/A')).not.toBeInTheDocument()
  })

  it('GuildReliabilityTrendChart shows a signed declining slope', () => {
    const data = [
      guildTrendsRow('100', { reliability_score: 80 }),
      guildTrendsRow('101', { reliability_score: 70 }),
      guildTrendsRow('102', { reliability_score: 60 })
    ]
    render(<GuildReliabilityTrendChart data={data} />)
    expect(screen.getByText('Trend:')).toBeInTheDocument()
    expect(screen.getByText('-10.0')).toBeInTheDocument()
  })
})
