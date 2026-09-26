import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { BossDetailSection } from '@/app/components/playerstats/BossDetailSection'
import type { BossStatDetail } from '@/app/components/playerstats/types'

// Boss vs prime entries at the two BossPerformanceTable call sites: a swap type-checks.

vi.mock('@tacticus/app-core/formatters', () => ({
  formatDamage: vi.fn((v) => `${(v / 1000000).toFixed(1)}M`),
  formatNumber: vi.fn((v) => String(v)),
  formatPercentage: vi.fn((v) => `${(v * 100).toFixed(0)}%`),
  formatPercentageDiff: vi.fn((v) =>
    v >= 0 ? `+${(v * 100).toFixed(0)}%` : `${(v * 100).toFixed(0)}%`
  )
}))

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
  ComposedChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="composed-chart">{children}</div>
  ),
  Line: () => null,
  Bar: () => null,
  CartesianGrid: () => null,
  XAxis: () => null,
  YAxis: () => null
}))

vi.mock('@/app/lib/catalogs/rarity-set', () => ({
  getBossLevelFromSetAndRarity: vi.fn(() => 'L4')
}))

const statDetail = (
  overrides: Partial<BossStatDetail> = {}
): BossStatDetail => ({
  damage: 5000000,
  tokens: 10,
  avgDamage: 500000,
  biggestHit: 900000,
  vsClusterAvg: 5,
  vsGuildAvg: 10,
  crashes: 1,
  sweeps: 2,
  oneShots: 3,
  totalTokens: 10,
  totalDamageWithSweeps: 5000000,
  avgDamageWithSweeps: 500000,
  set: 0,
  rarity: 'Legendary',
  ...overrides
})

describe('BossDetailSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderSection = () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    return render(
      <QueryClientProvider client={queryClient}>
        <BossDetailSection
          bossStats={{ AlphaBoss_L: statDetail() }}
          primeStats={{ PrimusPrime_L: statDetail() }}
          hasValidCluster={true}
          playerName="TestPlayer"
        />
      </QueryClientProvider>
    )
  }

  const sectionFor = (title: string) => {
    const heading = screen.getByRole('heading', { name: title })
    const section = heading.parentElement
    if (!section) throw new Error(`No section container for "${title}"`)
    return section
  }

  it('renders boss entries under Boss Performance and prime entries under Prime Performance', () => {
    renderSection()

    const bossSection = sectionFor('Boss Performance')
    expect(
      within(bossSection).getAllByText('AlphaBoss').length
    ).toBeGreaterThan(0)
    expect(within(bossSection).queryAllByText('PrimusPrime')).toHaveLength(0)

    const primeSection = sectionFor('Prime Performance')
    expect(
      within(primeSection).getAllByText('PrimusPrime').length
    ).toBeGreaterThan(0)
    expect(within(primeSection).queryAllByText('AlphaBoss')).toHaveLength(0)
  })

  it('expands a boss row on click', () => {
    renderSection()

    const bossSection = sectionFor('Boss Performance')
    expect(
      within(bossSection).queryByText('No loop details available for this boss')
    ).not.toBeInTheDocument()

    const row = within(bossSection)
      .getAllByText('AlphaBoss')
      .map((el) => el.closest('tr'))
      .find((tr) => tr !== null)
    expect(row).toBeTruthy()
    fireEvent.click(row!)

    expect(
      within(bossSection).getByText('No loop details available for this boss')
    ).toBeInTheDocument()
  })
})
