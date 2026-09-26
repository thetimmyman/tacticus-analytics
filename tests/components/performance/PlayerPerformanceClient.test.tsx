import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import PlayerPerformanceClient from '@/app/components/performance/PlayerPerformanceClient'

const usePlayerPerformanceDataMock = vi.fn()

vi.mock('@/app/components/performance/hooks/usePlayerPerformanceData', () => ({
  usePlayerPerformanceData: (...args: unknown[]) =>
    usePlayerPerformanceDataMock(...args)
}))

vi.mock('@/app/components/performance', () => ({
  PerformanceControls: () => <div data-testid="performance-controls" />,
  PerformanceChart: () => <div data-testid="performance-chart" />,
  PerformanceSummaryWidgets: () => (
    <div data-testid="performance-summary-widgets" />
  ),
  PerformanceBurnStats: () => <div data-testid="performance-burn-stats" />,
  PerformanceRadarCharts: () => <div data-testid="performance-radar-charts" />,
  PerformanceBossDetails: () => <div data-testid="performance-boss-details" />
}))

const baseHookState = {
  compareMode: 'guild',
  setCompareMode: vi.fn(),
  showBossDetail: false,
  setShowBossDetail: vi.fn(),
  showChartLines: false,
  setShowChartLines: vi.fn(),
  show5SeasonAvg: false,
  setShow5SeasonAvg: vi.fn(),
  hideInactivePlayers: true,
  setHideInactivePlayers: vi.fn(),
  bossDetailSearch: '',
  setBossDetailSearch: vi.fn(),
  selectedBossType: 'all',
  setSelectedBossType: vi.fn(),
  bossPerformanceFilter: 'all',
  setBossPerformanceFilter: vi.fn(),
  bossMinBattles: 0,
  setBossMinBattles: vi.fn(),
  performanceMode: 'battle-weighted',
  setPerformanceMode: vi.fn(),
  tokenWeightingMode: 'max',
  setTokenWeightingMode: vi.fn(),
  selectedRarities: ['Legendary', 'Mythic'],
  setSelectedRarities: vi.fn(),
  availableRarities: ['Legendary', 'Mythic'],
  hasCluster: false,
  loading: false,
  playerSummariesArray: [{ displayName: 'Alpha', value: 10 }],
  displayBossStats: [],
  bossDetailTypes: [],
  totalBossRows: 0,
  hasBossFiltersActive: false,
  hiddenPlayerCount: 0,
  chartMax: 100,
  topPlayer: null,
  tokenModeActive: false,
  getBarColor: vi.fn(() => 'bg-[var(--accent)]'),
  getTextColor: vi.fn(() => 'text-[var(--text-primary)]'),
  resetBossDetailFilters: vi.fn(),
  guildVsClusterBossArray: [],
  showNoDataCard: false,
  allHiddenByFilter: false,
  tokenModeUsesApproximation: false,
  tokenModeAvailable: true,
  burnStatsSummary: {
    hasData: true,
    totalBurnedTokens: 2,
    playersWithBurnedTokens: 1,
    totalTimeOverCapSeconds: 1800,
    topBurnedPlayers: []
  },
  burnStatsLoading: false,
  showBurnStatsCard: true
}

describe('PlayerPerformanceClient', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePlayerPerformanceDataMock.mockReturnValue(baseHookState)
  })

  it('renders burn stats card when burn stats are enabled', () => {
    render(<PlayerPerformanceClient selectedGuild="TEST" selectedSeason="81" />)

    expect(screen.getByTestId('performance-burn-stats')).toBeInTheDocument()
  })

  it('hides burn stats card when burn stats are disabled', () => {
    usePlayerPerformanceDataMock.mockReturnValue({
      ...baseHookState,
      showBurnStatsCard: false
    })

    render(<PlayerPerformanceClient selectedGuild="TEST" selectedSeason="81" />)

    expect(
      screen.queryByTestId('performance-burn-stats')
    ).not.toBeInTheDocument()
  })
})
