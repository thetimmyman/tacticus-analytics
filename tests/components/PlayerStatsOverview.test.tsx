import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PlayerOverview } from '@/app/components/playerstats/OverviewTab'

vi.mock('@tacticus/ui-kit', () => ({
  TooltipWrapper: ({
    children,
    content
  }: {
    children: React.ReactNode
    content: string
  }) => <div title={content}>{children}</div>
}))

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
  LineChart: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="line-chart">{children}</div>
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

const mockPlayerStats = {
  playerId: 'player-123',
  playerName: 'TestPlayer',
  totalDamage: 100000000,
  avgDamagePerHit: 2000000,
  tokensUsed: 45,
  bombsUsed: 0,
  legendaryTokensUsed: 0,
  legendaryBombsUsed: 0,
  kills: 0,
  sweeps: 0,
  oneShots: 0,
  crashes: 0,
  vsGuildAvg: 0.15,
  vsClusterAvg: 0.08,
  bossStats: {},
  primeStats: {},
  historicalTokens: { '81': 45, '80': 42 },
  guildRanking: 5,
  totalPlayersInGuild: 30,
  clusterRanking: 15,
  totalPlayersInCluster: 100,
  historicalPerformance: {
    '81': { vsGuild: 0.15, vsCluster: 0.08 },
    '80': { vsGuild: 0.12, vsCluster: 0.05 }
  }
} as unknown as ComponentProps<typeof PlayerOverview>['playerStats']

describe('PlayerOverview', () => {
  const mockTokenAvailability = {
    tokens: 3,
    bombs: 1,
    dataSource: 'live',
    burnedTokens: 0
  }

  const defaultProps = {
    playerStats: mockPlayerStats,
    tokenAvailability: mockTokenAvailability,
    hasValidCluster: true,
    selectedSeason: '81',
    playerName: 'TestPlayer'
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  const renderOverview = (
    props: ComponentProps<typeof PlayerOverview> = defaultProps
  ) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    return render(
      <QueryClientProvider client={queryClient}>
        <PlayerOverview {...props} />
      </QueryClientProvider>
    )
  }

  it('renders player overview with stats', () => {
    renderOverview()
    expect(screen.getAllByText('100.0M')[0]).toBeInTheDocument()
  })

  it('carries the guild rank on the metric it ranks, not a separate tile', () => {
    renderOverview()
    const tile = screen.getByText('vs GUILD').parentElement?.parentElement
    expect(tile).toHaveTextContent('#5')
    expect(tile).toHaveTextContent('of 30 in guild')
    expect(screen.queryByText('Guild Rank')).not.toBeInTheDocument()
  })

  it('carries the cluster rank on the vs-cluster tile', () => {
    renderOverview({ ...defaultProps, hasValidCluster: true })
    const tile = screen.getByText('vs Cluster Avg').parentElement?.parentElement
    expect(tile).toHaveTextContent('#15')
    expect(tile).toHaveTextContent('of 100 in cluster')
    expect(screen.queryByText('Cluster Rank')).not.toBeInTheDocument()
  })

  it('keeps the guild rank visible when the comparison value is zero', () => {
    renderOverview({
      ...defaultProps,
      playerStats: {
        ...mockPlayerStats,
        vsGuildAvg: 0,
        historicalPerformance: {}
      }
    })
    const tile = screen.getByText('vs GUILD').parentElement?.parentElement
    expect(tile).toHaveTextContent('#5')
    expect(tile).toHaveTextContent('of 30 in guild')
  })

  it('hides cluster ranking when hasValidCluster is false', () => {
    renderOverview({ ...defaultProps, hasValidCluster: false })
    expect(screen.queryByText(/cluster rank/i)).not.toBeInTheDocument()
  })

  it('shows boss detail section', () => {
    renderOverview()
    expect(
      screen.getByText(
        'No boss performance data recorded for this player in the selected season.'
      )
    ).toBeInTheDocument()
  })

  it('displays vs guild percentage', () => {
    renderOverview()
    const vsGuildStat = screen.getByText('vs GUILD').parentElement
    expect(vsGuildStat).toHaveTextContent('+15%')
  })

  it('displays vs cluster percentage', () => {
    renderOverview()
    const vsClusterStat = screen.getByText('vs Cluster Avg').parentElement
    expect(vsClusterStat).toHaveTextContent('+8%')
  })

  it('renders stats without historical data', () => {
    renderOverview()
    expect(screen.getByText('100.0M')).toBeInTheDocument()
  })

  it('handles missing token availability gracefully', () => {
    renderOverview({ ...defaultProps, tokenAvailability: null })
    expect(
      screen.getByText('Tokens Available').parentElement
    ).toHaveTextContent('--')
    expect(screen.getByText('Bombs Available').parentElement).toHaveTextContent(
      '--'
    )
  })

  it('displays token availability when provided', () => {
    renderOverview()
    expect(
      screen.getByText('Tokens Available').parentElement
    ).toHaveTextContent('3/3')
    expect(screen.getByText('Bombs Available').parentElement).toHaveTextContent(
      '1/1'
    )
  })

  it('renders the performance summary heading', () => {
    renderOverview()
    expect(screen.getByText('Performance Summary')).toBeInTheDocument()
  })

  it('handles zero rankings gracefully', () => {
    const propsWithZeroRankings = {
      ...defaultProps,
      playerStats: {
        ...mockPlayerStats,
        guildRanking: 0,
        clusterRanking: 0
      }
    }
    renderOverview(propsWithZeroRankings)
  })

  it('uses historical data for current season when main stats are zero', () => {
    const propsWithZeroStats = {
      ...defaultProps,
      playerStats: {
        ...mockPlayerStats,
        vsGuildAvg: 0,
        vsClusterAvg: 0
      }
    }
    renderOverview(propsWithZeroStats)
    const vsGuildStat = screen.getByText('vs GUILD').parentElement
    expect(vsGuildStat).toHaveTextContent('+15%')
  })

  it('leads with the Standing section, in tile format, where the banner was', () => {
    renderOverview()

    const standingSection =
      screen.getByText('Standing').parentElement?.parentElement
    expect(standingSection).toBeTruthy()
    const vsGuild = within(standingSection as HTMLElement).getByText('vs GUILD')
    expect(vsGuild.parentElement).toHaveTextContent('+15%')
    expect(
      within(standingSection as HTMLElement).getByText('vs Cluster Avg')
    ).toBeInTheDocument()

    const damageLabel = screen.getByText('Damage')
    const standingLabel = screen.getByText('Standing')
    expect(
      standingLabel.compareDocumentPosition(damageLabel) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()

    expect(
      screen.queryByText(/Season performance vs GUILD average/)
    ).not.toBeInTheDocument()
  })

  it('does not render a Reliability Score tile even when the RPC returned one', () => {
    renderOverview({
      ...defaultProps,
      playerStats: {
        ...mockPlayerStats,
        reliability: {
          reliability_score: 87.4,
          consistency_rating: 'Very Consistent',
          battles_analyzed: 20
        }
      } as ComponentProps<typeof PlayerOverview>['playerStats']
    })
    expect(screen.queryByText('Reliability Score')).not.toBeInTheDocument()
    expect(screen.queryByText(/\/100/)).not.toBeInTheDocument()
  })

  it('groups all summary metrics without losing any values', () => {
    renderOverview()

    const damageSection =
      screen.getByText('Damage').parentElement?.parentElement
    const economySection =
      screen.getByText('Economy').parentElement?.parentElement
    const standingSection =
      screen.getByText('Standing').parentElement?.parentElement
    expect(damageSection).toBeTruthy()
    expect(economySection).toBeTruthy()
    expect(standingSection).toBeTruthy()

    for (const label of [
      'Total Damage',
      'Avg Damage/Hit',
      'Avg Score',
      'One-Shots',
      'Sweeps'
    ]) {
      expect(
        within(damageSection as HTMLElement).getByText(label)
      ).toBeInTheDocument()
    }

    for (const label of [
      'Tokens Used',
      'Tokens Available',
      'Still Reachable',
      'Burn Timer',
      'Bombs Used',
      'Bombs Available'
    ]) {
      expect(
        within(economySection as HTMLElement).getByText(label)
      ).toBeInTheDocument()
    }

    for (const label of ['vs GUILD', 'vs Cluster Avg']) {
      expect(
        within(standingSection as HTMLElement).getByText(label)
      ).toBeInTheDocument()
    }

    const guildTile = screen.getByText('vs GUILD').parentElement?.parentElement
    expect(guildTile).toHaveTextContent('#5')
    expect(guildTile).toHaveTextContent('of 30 in guild')
    const clusterTile =
      screen.getByText('vs Cluster Avg').parentElement?.parentElement
    expect(clusterTile).toHaveTextContent('#15')
    expect(clusterTile).toHaveTextContent('of 100 in cluster')
  })
})

describe('PlayerOverview cap budget tiles', () => {
  const HOUR = 3600
  const FIXED_NOW = Date.UTC(2026, 7, 6, 12, 0, 0)
  // 6h + three 12h intervals + 2h slack; seasonEnd sits one 15-minute battle lockout later.
  const SECONDS_TO_DEADLINE = 6 * HOUR + 3 * 12 * HOUR + 2 * HOUR
  const LOCKOUT = 15 * 60

  const renderWithTokens = (
    tokenAvailability: Record<string, unknown> | null
  ) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    return render(
      <QueryClientProvider client={queryClient}>
        <PlayerOverview
          playerStats={mockPlayerStats}
          tokenAvailability={
            tokenAvailability as ComponentProps<
              typeof PlayerOverview
            >['tokenAvailability']
          }
          hasValidCluster
          selectedSeason="81"
          playerName="TestPlayer"
        />
      </QueryClientProvider>
    )
  }

  // Real timers: RTL's waitFor does not advance fake timers, deadlocking react-query.
  let currentNow = FIXED_NOW

  beforeEach(() => {
    currentNow = FIXED_NOW
    vi.spyOn(Date, 'now').mockImplementation(() => currentNow)
    global.fetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            seasonNumber: 81,
            seasonStart: FIXED_NOW - 8 * 24 * HOUR * 1000,
            seasonEnd: FIXED_NOW + (SECONDS_TO_DEADLINE + LOCKOUT) * 1000,
            source: 'loki-globalconfig'
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
    ) as unknown as typeof fetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // Season cap = 3 + floor(236/12) = 22.
  const SEASON_CAP = 22

  it('derives the cap budget, still-reachable, and status from the season window', async () => {
    renderWithTokens({
      tokens: 1,
      bombs: 1,
      dataSource: 'live',
      tokensUsed: 5,
      // max_possible is the guild's top-spender count, not a cap; it must be ignored.
      maxPossible: 6,
      nextTokenSeconds: 6 * HOUR,
      burnedTokens: 0
    })

    await waitFor(() =>
      expect(screen.getByText('02:00:00')).toBeInTheDocument()
    )
    expect(screen.getByText(`10/${SEASON_CAP}`)).toBeInTheDocument()
    // Both numbers come from the token snapshot, never playerStats.
    expect(screen.getByText(`5/${SEASON_CAP}`)).toBeInTheDocument()
    expect(screen.queryByText(`45/${SEASON_CAP}`)).not.toBeInTheDocument()
    expect(screen.queryByText('10/6')).not.toBeInTheDocument()
    const tokensAvailable = screen.getByText('Tokens Available')
      .parentElement as HTMLElement
    expect(
      within(tokensAvailable).getByText('Regenerating')
    ).toBeInTheDocument()
    expect(screen.queryByText('Status')).not.toBeInTheDocument()
    expect(screen.getByText('frozen — only runs at 3/3')).toBeInTheDocument()
    expect(screen.getByText('Live · +1 in 06:00:00')).toBeInTheDocument()
  })

  it('never renders a used count above the cap it is measured against', async () => {
    renderWithTokens({
      tokens: 1,
      bombs: 1,
      dataSource: 'live',
      tokensUsed: 5,
      maxPossible: 6,
      nextTokenSeconds: 6 * HOUR,
      burnedTokens: 0
    })

    const usedTile = () =>
      screen.getByText('Tokens Used').parentElement as HTMLElement
    await waitFor(() => expect(usedTile()).toHaveTextContent(`5/${SEASON_CAP}`))

    const match = usedTile().textContent?.match(/(\d+)\/(\d+)/)
    expect(match).toBeTruthy()
    const [, used, cap] = match as RegExpMatchArray
    expect(Number(used)).toBeLessThanOrEqual(Number(cap))
  })

  it('falls back to the stats count when there is no token snapshot to read', () => {
    renderWithTokens(null)
    expect(screen.getByText('Tokens Used').parentElement).toHaveTextContent(
      '45'
    )
  })

  it('flags the amber near-cap band one token short of the cap', async () => {
    renderWithTokens({
      tokens: 2,
      bombs: 1,
      dataSource: 'live',
      tokensUsed: 5,
      maxPossible: 28,
      nextTokenSeconds: 6 * HOUR,
      burnedTokens: 0
    })

    await waitFor(() =>
      expect(screen.getByText('Near cap')).toBeInTheDocument()
    )
    expect(screen.getByText('Near cap')).toHaveClass('text-amber-300')
    expect(screen.queryByText('Regenerating')).not.toBeInTheDocument()
  })

  it('holds the budget steady while regenerating and ticks the countdown instead', async () => {
    renderWithTokens({
      tokens: 1,
      bombs: 1,
      dataSource: 'live',
      tokensUsed: 5,
      maxPossible: 6,
      nextTokenSeconds: 6 * HOUR,
      burnedTokens: 0,
      fetchedAtMs: FIXED_NOW
    })

    await waitFor(() =>
      expect(screen.getByText('02:00:00')).toBeInTheDocument()
    )
    expect(screen.getByText('Live · +1 in 06:00:00')).toBeInTheDocument()

    currentNow += 5000
    await waitFor(
      () =>
        expect(screen.getByText('Live · +1 in 05:59:55')).toBeInTheDocument(),
      { timeout: 4000 }
    )
    expect(screen.getByText('02:00:00')).toBeInTheDocument()
    expect(screen.queryByText('01:59:55')).not.toBeInTheDocument()
  })

  it('ticks the budget down while the player sits at the cap', async () => {
    renderWithTokens({
      tokens: 3,
      bombs: 1,
      dataSource: 'live',
      tokensUsed: 5,
      maxPossible: 28,
      nextTokenSeconds: null,
      burnedTokens: 0
    })

    // Scoped to the tile because the bomb timer also shows 8h in this fixture.
    const burnTimer = () =>
      screen.getByText('Burn Timer').parentElement as HTMLElement
    await waitFor(() =>
      expect(within(burnTimer()).getByText('08:00:00')).toBeInTheDocument()
    )
    expect(screen.getByText('At cap — burning')).toBeInTheDocument()
    expect(screen.queryByText(/\+1 in /)).not.toBeInTheDocument()

    currentNow += 5000
    await waitFor(
      () =>
        expect(within(burnTimer()).getByText('07:59:55')).toBeInTheDocument(),
      { timeout: 4000 }
    )
  })

  // Bomb cap = 1 + floor(236/18) = 14.
  const BOMB_CAP = 14

  it('derives the bomb cap, still-reachable, and burn timer from the same window', async () => {
    renderWithTokens({
      tokens: 3,
      bombs: 1,
      dataSource: 'live',
      tokensUsed: 5,
      maxPossible: 28,
      nextTokenSeconds: null,
      nextBombSeconds: null,
      burnedTokens: 0
    })

    await waitFor(() =>
      expect(screen.getByText(`0/${BOMB_CAP}`)).toBeInTheDocument()
    )
    // Holding the bomb is sitting at the cap (its clock starts on use).
    expect(screen.getByText(`3/${BOMB_CAP}`)).toBeInTheDocument()
    const bombsAvailable = screen.getByText('Bombs Available')
      .parentElement as HTMLElement
    expect(
      within(bombsAvailable).getByText('In hand — burning')
    ).toBeInTheDocument()
    expect(
      screen.getByText('burning — drop the bomb to stop the clock')
    ).toBeInTheDocument()
    const bombBurn = screen.getByText('Bomb Burn Timer')
      .parentElement as HTMLElement
    expect(within(bombBurn).getByText('08:00:00')).toBeInTheDocument()
  })

  it('runs the bomb countdown while the bomb is on cooldown, not while held', async () => {
    renderWithTokens({
      tokens: 3,
      bombs: 0,
      dataSource: 'live',
      tokensUsed: 5,
      maxPossible: 28,
      nextTokenSeconds: null,
      nextBombSeconds: 5 * HOUR,
      burnedTokens: 0,
      fetchedAtMs: FIXED_NOW
    })

    const bombsAvailable = () =>
      screen.getByText('Bombs Available').parentElement as HTMLElement
    await waitFor(() =>
      expect(
        within(bombsAvailable()).getByText('On cooldown')
      ).toBeInTheDocument()
    )
    expect(within(bombsAvailable()).getByText('0/1')).toBeInTheDocument()
    expect(
      within(bombsAvailable()).getByText('Live · +1 in 05:00:00')
    ).toBeInTheDocument()

    const bombBurn = () =>
      screen.getByText('Bomb Burn Timer').parentElement as HTMLElement
    const frozen = bombBurn().textContent
    currentNow += 5000
    await waitFor(
      () =>
        expect(
          within(bombsAvailable()).getByText('Live · +1 in 04:59:55')
        ).toBeInTheDocument(),
      { timeout: 4000 }
    )
    expect(bombBurn().textContent).toBe(frozen)
  })

  it('renders placeholders rather than zeros without a token snapshot', async () => {
    renderWithTokens(null)

    const burnTimer = screen.getByText('Burn Timer').parentElement
    const reachable = screen.getByText('Still Reachable').parentElement
    expect(burnTimer).toHaveTextContent('--')
    expect(reachable).toHaveTextContent('--')
    expect(screen.getByText('Bomb Burn Timer').parentElement).toHaveTextContent(
      '--'
    )
    expect(screen.getByText('Bombs Reachable').parentElement).toHaveTextContent(
      '--'
    )
    expect(screen.queryByText('On cooldown')).not.toBeInTheDocument()
    expect(screen.queryByText('In hand — burning')).not.toBeInTheDocument()
    // No snapshot, no status pip: a grey dot would still be a claim.
    expect(screen.queryByText('Regenerating')).not.toBeInTheDocument()
    expect(screen.queryByText('Near cap')).not.toBeInTheDocument()
    expect(screen.queryByText(/already out of reach/)).not.toBeInTheDocument()
  })
})
