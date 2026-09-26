import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePlayerPerformanceData } from '@/app/components/performance/hooks/usePlayerPerformanceData'
import type { TokenPerformanceData } from '@/app/(dashboard)/guild-management/upcoming-assignments/types'

const useDataContextMock = vi.fn()
const usePlayerBossPerformanceMock = vi.fn()
const usePlayerPerformanceSummaryMock = vi.fn()
const useGuildVsClusterBossPerformanceMock = vi.fn()
const usePerformanceCalculationsMock = vi.fn()
const useRecalculatedSummariesMock = vi.fn()
const useQueryMock = vi.fn()
const buildTokenRatioMapsFromStatsMock = vi.fn()
const deriveParticipationShareRatiosFromSummariesMock = vi.fn()
const mergeTokenRatioMapMock = vi.fn()
const dbRpcMock = vi.fn()

type MockArgs = readonly unknown[]
type MockRow = Record<string, unknown>
type QueryKey = ReadonlyArray<string> | string
type QueryConfig = {
  queryKey?: QueryKey
  queryFn?: (context?: { signal?: AbortSignal }) => Promise<unknown>
  enabled?: boolean
}

let tokenStatsData: MockRow | null = null
let tokenBurnStatsData: MockRow[] = []
let rosterMembershipData = new Map<string, boolean>()
let rosterMembershipLoaded = true
let fiveSeasonData: MockRow[] = []
let tokenBurnQueryConfig: QueryConfig | null = null
let targetWeightedQueryConfig: QueryConfig | null = null
let targetWeightedData: TokenPerformanceData | undefined

vi.mock('@/app/lib/hooks/useDataContext', () => ({
  useDataContext: () => useDataContextMock()
}))

vi.mock('@/app/lib/hooks/queries', () => ({
  usePlayerBossPerformance: (...args: MockArgs) =>
    usePlayerBossPerformanceMock(...args),
  usePlayerPerformanceSummary: (...args: MockArgs) =>
    usePlayerPerformanceSummaryMock(...args),
  useGuildVsClusterBossPerformance: (...args: MockArgs) =>
    useGuildVsClusterBossPerformanceMock(...args)
}))

vi.mock('@/app/components/performance', () => ({
  usePerformanceCalculations: (...args: MockArgs) =>
    usePerformanceCalculationsMock(...args),
  useRecalculatedSummaries: (...args: MockArgs) =>
    useRecalculatedSummariesMock(...args)
}))

vi.mock('@tanstack/react-query', () => ({
  useQuery: (config: QueryConfig) => useQueryMock(config)
}))

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => ({ rpc: dbRpcMock })
}))

vi.mock('@tacticus/app-core/token-weighting', () => ({
  buildTokenRatioMapsFromStats: (...args: MockArgs) =>
    buildTokenRatioMapsFromStatsMock(...args),
  deriveParticipationShareRatiosFromSummaries: (...args: MockArgs) =>
    deriveParticipationShareRatiosFromSummariesMock(...args),
  mergeTokenRatioMap: (...args: MockArgs) => mergeTokenRatioMapMock(...args)
}))

describe('usePlayerPerformanceData', () => {
  beforeEach(() => {
    tokenStatsData = null
    tokenBurnStatsData = []
    rosterMembershipData = new Map<string, boolean>()
    rosterMembershipLoaded = true
    fiveSeasonData = []
    tokenBurnQueryConfig = null
    targetWeightedQueryConfig = null
    targetWeightedData = undefined
    dbRpcMock.mockReset()

    useDataContextMock.mockReturnValue({
      context: { clusterCode: null },
      loading: false
    })

    usePlayerBossPerformanceMock.mockReturnValue({ data: [], isLoading: false })
    usePlayerPerformanceSummaryMock.mockReturnValue({
      data: [],
      isLoading: false
    })
    useGuildVsClusterBossPerformanceMock.mockReturnValue({
      data: [],
      isLoading: false
    })

    usePerformanceCalculationsMock.mockReturnValue({
      playerSummaries: [],
      filteredBossStats: [],
      bossDetailTypes: [],
      totalBossRows: 0,
      hasBossFiltersActive: false,
      hiddenPlayerCount: 0,
      chartMax: 0,
      topPlayer: null,
      tokenModeActive: false
    })

    useRecalculatedSummariesMock.mockReturnValue([])

    buildTokenRatioMapsFromStatsMock.mockReturnValue({
      max: new Map(),
      average: new Map()
    })

    deriveParticipationShareRatiosFromSummariesMock.mockReturnValue(new Map())

    mergeTokenRatioMapMock.mockImplementation(
      (primary: Map<string, number>, fallback: Map<string, number>) => {
        const merged = new Map(fallback)
        primary.forEach((value, key) => merged.set(key, value))
        return merged
      }
    )

    useQueryMock.mockImplementation((config: QueryConfig) => {
      const key = Array.isArray(config.queryKey)
        ? config.queryKey[0]
        : config.queryKey
      if (key === 'five-season-averages') {
        return { data: fiveSeasonData, isLoading: false }
      }
      if (key === 'roster-membership') {
        return { data: rosterMembershipData, isSuccess: rosterMembershipLoaded }
      }
      if (key === 'token-stats') {
        return { data: tokenStatsData, isLoading: false }
      }
      if (key === 'token-burn-stats') {
        tokenBurnQueryConfig = config
        return { data: tokenBurnStatsData, isLoading: false }
      }
      if (key === 'target-weighted-token-performance') {
        targetWeightedQueryConfig = config
        return { data: targetWeightedData, isLoading: false }
      }
      return { data: undefined }
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('sets loading when any dependency is loading', () => {
    usePlayerBossPerformanceMock.mockReturnValue({ data: [], isLoading: true })

    const { result } = renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    expect(result.current.loading).toBe(true)
  })

  it('exposes cluster context data when available', () => {
    useDataContextMock.mockReturnValue({
      context: { clusterCode: 'CL-1' },
      loading: false
    })
    const clusterData = [{ label: 'Cluster' }]
    useGuildVsClusterBossPerformanceMock.mockReturnValue({
      data: clusterData,
      isLoading: false
    })

    const { result } = renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    expect(result.current.hasCluster).toBe(true)
    expect(result.current.guildVsClusterBossArray).toEqual(clusterData)
  })

  it('flags hidden-only results when no data is visible', () => {
    usePerformanceCalculationsMock.mockReturnValue({
      playerSummaries: [],
      filteredBossStats: [],
      bossDetailTypes: [],
      totalBossRows: 0,
      hasBossFiltersActive: false,
      hiddenPlayerCount: 2,
      chartMax: 0,
      topPlayer: null,
      tokenModeActive: false
    })

    const { result } = renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    expect(result.current.showNoDataCard).toBe(true)
    expect(result.current.allHiddenByFilter).toBe(true)
  })

  it('falls back to an alternate token weighting mode when needed', async () => {
    tokenStatsData = [{ guild_code: 'GUILD' }]
    buildTokenRatioMapsFromStatsMock.mockReturnValue({
      max: new Map([['player-1', 1]]),
      average: new Map()
    })
    usePerformanceCalculationsMock.mockReturnValue({
      playerSummaries: [{ displayName: 'Test' }],
      filteredBossStats: [],
      bossDetailTypes: [],
      totalBossRows: 0,
      hasBossFiltersActive: false,
      hiddenPlayerCount: 0,
      chartMax: 0,
      topPlayer: null,
      tokenModeActive: true
    })

    const { result } = renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    act(() => {
      result.current.setPerformanceMode('token-weighted')
      result.current.setTokenWeightingMode('average')
    })

    await waitFor(() => {
      expect(result.current.tokenWeightingMode).toBe('max')
    })

    expect(result.current.tokenModeAvailable).toBe(true)
    expect(result.current.tokenModeUsesApproximation).toBe(false)
  })

  it('filters target-weighted calculation data by selected loop range', async () => {
    targetWeightedData = {
      'player-1': {
        BossA_L1: {
          playerId: 'player-1',
          displayName: 'Alpha',
          score: 1,
          tier: 'officer_target',
          tokensSpent: 4,
          expectedTokens: 4,
          actualDamage: 400,
          expectedDamage: 400,
          perLoop: {
            0: {
              loopIndex: 0,
              score: 0.8,
              tokensSpent: 2,
              actualDamage: 160
            },
            1: {
              loopIndex: 1,
              score: 1.2,
              tokensSpent: 2,
              actualDamage: 240
            }
          }
        }
      }
    }

    const { result } = renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    act(() => {
      result.current.setPerformanceMode('target-weighted')
    })

    await waitFor(() => {
      expect(result.current.targetLoopRange).toMatchObject({
        start: 0,
        end: 1
      })
    })

    act(() => {
      result.current.setTargetLoopRange(1, 1)
    })

    await waitFor(() => {
      const latestArgs = usePerformanceCalculationsMock.mock.calls.at(
        -1
      )?.[0] as
        | {
            summaries?: Array<{ displayName: string; playerId?: string }>
            targetWeightedScoresByPlayer?: Map<string, number>
          }
        | undefined
      const alpha = latestArgs?.summaries?.find(
        (summary) => summary.displayName === 'Alpha'
      )
      const score = latestArgs?.targetWeightedScoresByPlayer?.get(
        alpha?.playerId ?? ''
      )
      expect(score).toBeCloseTo(1.2)
    })

    expect(
      result.current.targetWeightedRaw?.['player-1']?.BossA_L1?.tokensSpent
    ).toBe(2)
  })

  it('snaps sparse target loop ranges and omits players without selected-loop data', async () => {
    useRecalculatedSummariesMock.mockReturnValue([
      {
        playerId: 'player-1',
        displayName: 'Alpha'
      },
      {
        playerId: 'player-2',
        displayName: 'Bravo'
      },
      {
        playerId: 'raw-key-collision',
        displayName: 'Delta'
      }
    ])
    targetWeightedData = {
      'player-1': {
        BossA_L1: {
          playerId: 'player-1',
          displayName: 'Alpha',
          score: 0.8,
          tier: 'officer_target',
          tokensSpent: 2,
          expectedTokens: 2,
          actualDamage: 160,
          expectedDamage: 200,
          perLoop: {
            0: {
              loopIndex: 0,
              score: 0.8,
              tokensSpent: 2,
              actualDamage: 160
            }
          }
        }
      },
      'player-2': {
        BossA_L3: {
          playerId: 'player-2',
          displayName: 'Bravo',
          score: 1.3,
          tier: 'officer_target',
          tokensSpent: 3,
          expectedTokens: 3,
          actualDamage: 390,
          expectedDamage: 300,
          perLoop: {
            2: {
              loopIndex: 2,
              score: 1.3,
              tokensSpent: 3,
              actualDamage: 390
            }
          }
        }
      },
      'raw-key-collision': {
        BossB_L3: {
          displayName: 'Gamma',
          score: 1.1,
          tier: 'officer_target',
          tokensSpent: 1,
          expectedTokens: 1,
          actualDamage: 110,
          expectedDamage: 100,
          perLoop: {
            2: {
              loopIndex: 2,
              score: 1.1,
              tokensSpent: 1,
              actualDamage: 110
            }
          }
        }
      },
      NoScore: {
        BossC_L3: {
          displayName: 'No Score',
          score: null,
          tier: 'officer_target',
          tokensSpent: 1,
          expectedTokens: null,
          actualDamage: 75,
          expectedDamage: null,
          perLoop: {
            2: {
              loopIndex: 2,
              score: null,
              tokensSpent: 1,
              actualDamage: 75
            }
          }
        }
      }
    }

    const { result } = renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    act(() => {
      result.current.setPerformanceMode('target-weighted')
    })

    await waitFor(() => {
      expect(result.current.targetLoopRange).toMatchObject({
        start: 0,
        end: 2
      })
    })

    act(() => {
      result.current.setTargetLoopRange(1, 1)
    })

    await waitFor(() => {
      expect(result.current.targetLoopRange).toMatchObject({
        start: 2,
        end: 2
      })
    })

    await waitFor(() => {
      const latestArgs = usePerformanceCalculationsMock.mock.calls.at(
        -1
      )?.[0] as
        | {
            summaries?: Array<{ displayName: string; playerId?: string }>
            targetWeightedScoresByPlayer?: Map<string, number>
          }
        | undefined
      const summaries = latestArgs?.summaries ?? []
      const bravo = summaries.find((summary) => summary.displayName === 'Bravo')
      const gamma = summaries.find((summary) => summary.displayName === 'Gamma')
      const noScore = summaries.find(
        (summary) => summary.displayName === 'No Score'
      )
      expect(summaries.map((summary) => summary.displayName)).toEqual([
        'Bravo',
        'Gamma',
        'No Score'
      ])
      expect(summaries.some((summary) => summary.displayName === 'Delta')).toBe(
        false
      )
      expect(bravo?.playerId).toMatch(/^target-weighted:/)
      expect(gamma?.playerId).toMatch(/^target-weighted:/)
      expect(noScore?.playerId).toMatch(/^target-weighted:/)
      expect(
        latestArgs?.targetWeightedScoresByPlayer?.get(bravo?.playerId ?? '')
      ).toBeCloseTo(1.3)
      expect(
        latestArgs?.targetWeightedScoresByPlayer?.get(gamma?.playerId ?? '')
      ).toBeCloseTo(1.1)
      expect(
        latestArgs?.targetWeightedScoresByPlayer?.get('player-1')
      ).toBeUndefined()
      expect(
        latestArgs?.targetWeightedScoresByPlayer?.get('raw-key-collision')
      ).toBeUndefined()
      expect(
        latestArgs?.targetWeightedScoresByPlayer?.get(noScore?.playerId ?? '')
      ).toBeUndefined()
    })

    expect(result.current.targetWeightedRaw?.['player-1']).toBeUndefined()
    expect(
      result.current.targetWeightedRaw?.['player-2']?.BossA_L3?.tokensSpent
    ).toBe(3)
    expect(
      result.current.targetWeightedRaw?.['raw-key-collision']?.BossB_L3
        ?.tokensSpent
    ).toBe(1)
    expect(
      result.current.targetWeightedRaw?.NoScore?.BossC_L3?.tokensSpent
    ).toBe(1)
  })

  it('keeps full-season target data when per-loop coverage is incomplete', async () => {
    targetWeightedData = {
      'player-1': {
        BossA_L1: {
          playerId: 'player-1',
          displayName: 'Alpha',
          score: 1,
          tier: 'officer_target',
          tokensSpent: 4,
          expectedTokens: 4,
          actualDamage: 400,
          expectedDamage: 400,
          perLoop: {
            0: {
              loopIndex: 0,
              score: 0.8,
              tokensSpent: 2,
              actualDamage: 160
            }
          }
        }
      }
    }

    const { result } = renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    act(() => {
      result.current.setPerformanceMode('target-weighted')
      result.current.setTargetLoopRange(0, 0)
    })

    await waitFor(() => {
      const latestArgs = usePerformanceCalculationsMock.mock.calls.at(
        -1
      )?.[0] as
        | {
            summaries?: Array<{ displayName: string; playerId?: string }>
            targetWeightedScoresByPlayer?: Map<string, number>
          }
        | undefined
      const alpha = latestArgs?.summaries?.find(
        (summary) => summary.displayName === 'Alpha'
      )
      const score = latestArgs?.targetWeightedScoresByPlayer?.get(
        alpha?.playerId ?? ''
      )
      expect(score).toBeCloseTo(1)
    })

    expect(result.current.targetLoopRange).toBeNull()
    expect(
      result.current.targetWeightedRaw?.['player-1']?.BossA_L1?.tokensSpent
    ).toBe(4)
  })

  it('builds burn summary stats scoped to visible player summaries', () => {
    tokenBurnStatsData = [
      {
        player_id: 'player-1',
        display_name: 'Alpha',
        burned_tokens: 3,
        time_over_cap_seconds: 3600
      },
      {
        player_id: 'player-2',
        display_name: 'Bravo',
        burned_tokens: 0,
        time_over_cap_seconds: 900
      },
      {
        player_id: 'player-3',
        display_name: 'Gamma',
        burned_tokens: 2,
        time_over_cap_seconds: 7200
      }
    ]

    usePerformanceCalculationsMock.mockReturnValue({
      playerSummaries: [
        { playerId: 'player-1', displayName: 'Alpha', performanceValue: 12 },
        { playerId: 'player-2', displayName: 'Bravo', performanceValue: -1 }
      ],
      filteredBossStats: [],
      bossDetailTypes: [],
      totalBossRows: 0,
      hasBossFiltersActive: false,
      hiddenPlayerCount: 0,
      chartMax: 0,
      topPlayer: null,
      tokenModeActive: false
    })

    const { result } = renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    expect(result.current.burnStatsSummary.hasData).toBe(true)
    expect(result.current.burnStatsSummary.totalBurnedTokens).toBe(3)
    expect(result.current.burnStatsSummary.playersWithBurnedTokens).toBe(1)
    expect(result.current.burnStatsSummary.totalTimeOverCapSeconds).toBe(4500)
    expect(result.current.burnStatsSummary.topBurnedPlayers).toHaveLength(2)
    expect(result.current.burnStatsSummary.topBurnedPlayers[0]).toMatchObject({
      displayName: 'Alpha',
      burnedTokens: 3
    })
  })

  it('enables the token-burn query for the default season view', () => {
    renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    expect(tokenBurnQueryConfig?.enabled).toBe(true)
  })

  it('disables the token-burn query while five-season mode is active', () => {
    const { result } = renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    act(() => {
      result.current.setShow5SeasonAvg(true)
    })

    expect(tokenBurnQueryConfig?.enabled).toBe(false)
  })

  it('recomputes burn rows with live cooldown data in the token-burn query', async () => {
    dbRpcMock.mockResolvedValue({
      data: [
        {
          player_id: 'leader',
          display_name: 'Leader',
          tokens_used: 11,
          burned_tokens: 0,
          time_over_cap_seconds: 0
        },
        {
          player_id: 'follower',
          display_name: 'Follower',
          tokens_used: 10,
          burned_tokens: 9,
          time_over_cap_seconds: 0
        }
      ],
      error: null
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          players: [
            {
              player_id: 'leader',
              display_name: 'Leader',
              tokens_used: 11,
              tokens_available: 1,
              token_next_in_seconds: null
            },
            {
              player_id: 'follower',
              display_name: 'Follower',
              tokens_used: 10,
              tokens_available: 1,
              token_next_in_seconds: 6 * 60 * 60
            }
          ]
        })
      }))
    )

    renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    const rows = (await tokenBurnQueryConfig?.queryFn?.({})) as MockRow[]

    expect(rows.find((row) => row.player_id === 'follower')).toMatchObject({
      burned_tokens: 0
    })
    expect(dbRpcMock).toHaveBeenCalledWith('get_token_usage_for_guild', {
      p_guild_code: 'GUILD',
      p_season: '1'
    })
  })

  it('uses player_id before display name aliases in live token availability', async () => {
    dbRpcMock.mockResolvedValue({
      data: [
        {
          player_id: 'leader',
          display_name: 'Leader',
          tokens_used: 11,
          burned_tokens: 0,
          time_over_cap_seconds: 0
        },
        {
          player_id: 'p2',
          display_name: 'Bravo',
          tokens_used: 10,
          burned_tokens: 9,
          time_over_cap_seconds: 0
        },
        {
          player_id: 'p1',
          display_name: 'p2',
          tokens_used: 1,
          burned_tokens: 0,
          time_over_cap_seconds: 0
        }
      ],
      error: null
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          players: [
            {
              player_id: 'leader',
              display_name: 'Leader',
              tokens_used: 11,
              tokens_available: 1,
              token_next_in_seconds: null
            },
            {
              player_id: 'p2',
              display_name: 'Bravo',
              tokens_used: 10,
              tokens_available: 1,
              token_next_in_seconds: 6 * 60 * 60
            },
            {
              player_id: 'p1',
              display_name: 'p2',
              tokens_used: 1,
              tokens_available: 0,
              token_next_in_seconds: null
            }
          ]
        })
      }))
    )

    renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    const rows = (await tokenBurnQueryConfig?.queryFn?.({})) as MockRow[]

    expect(rows.find((row) => row.player_id === 'p2')).toMatchObject({
      display_name: 'Bravo',
      burned_tokens: 0
    })
  })

  it('uses player_id before display name aliases in burn summary lookup', () => {
    tokenBurnStatsData = [
      {
        player_id: 'p2',
        display_name: 'Bravo',
        burned_tokens: 5,
        time_over_cap_seconds: 0
      },
      {
        player_id: 'p1',
        display_name: 'p2',
        burned_tokens: 1,
        time_over_cap_seconds: 0
      }
    ]
    usePerformanceCalculationsMock.mockReturnValue({
      playerSummaries: [{ playerId: 'p2', displayName: 'Bravo' }],
      filteredBossStats: [],
      bossDetailTypes: [],
      totalBossRows: 0,
      hasBossFiltersActive: false,
      hiddenPlayerCount: 0,
      chartMax: 0,
      topPlayer: null,
      tokenModeActive: false
    })

    const { result } = renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    expect(result.current.burnStatsSummary.totalBurnedTokens).toBe(5)
    expect(result.current.burnStatsSummary.topBurnedPlayers[0]).toMatchObject({
      playerId: 'p2',
      displayName: 'Bravo',
      burnedTokens: 5
    })
  })

  it('passes the token-burn query abort signal to live availability fetches', async () => {
    dbRpcMock.mockResolvedValue({ data: [], error: null })
    const controller = new AbortController()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ players: [] })
    }))
    vi.stubGlobal('fetch', fetchMock)

    renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    await tokenBurnQueryConfig?.queryFn?.({ signal: controller.signal })

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/guild-tokens?guild=GUILD&season=1',
      { signal: controller.signal }
    )
  })

  it('rethrows aborted live availability fetches instead of falling back', async () => {
    dbRpcMock.mockResolvedValue({ data: [], error: null })
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(abortError))
    )

    renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    await expect(tokenBurnQueryConfig?.queryFn?.({})).rejects.toBe(abortError)
  })

  it('falls back to RPC availability when live token availability fails', async () => {
    dbRpcMock.mockResolvedValue({
      data: [
        {
          player_id: 'leader',
          display_name: 'Leader',
          tokens_used: 11,
          tokens_available: 1,
          token_next_in_seconds: null,
          burned_tokens: 0,
          time_over_cap_seconds: 0
        },
        {
          player_id: 'follower',
          display_name: 'Follower',
          tokens_used: 10,
          tokens_available: 1,
          token_next_in_seconds: 6 * 60 * 60,
          burned_tokens: 9,
          time_over_cap_seconds: 0
        }
      ],
      error: null
    })
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        json: async () => ({})
      }))
    )

    renderHook(() =>
      usePlayerPerformanceData({ selectedGuild: 'GUILD', selectedSeason: '1' })
    )

    const rows = (await tokenBurnQueryConfig?.queryFn?.({})) as MockRow[]

    expect(rows.find((row) => row.player_id === 'follower')).toMatchObject({
      burned_tokens: 0
    })
  })

  // A compareMode-coercing effect must fail these.
  describe('target-weighted primes scope (derived from compareMode)', () => {
    it('derives targetIncludePrimes from compareMode and preserves the baseline when toggled', () => {
      const { result } = renderHook(() =>
        usePlayerPerformanceData({
          selectedGuild: 'GUILD',
          selectedSeason: '1'
        })
      )
      act(() => {
        result.current.setPerformanceMode('target-weighted')
      })

      expect(result.current.compareMode).toBe('guild')
      expect(result.current.targetIncludePrimes).toBe(true)

      act(() => {
        result.current.setCompareMode('guild-boss')
      })
      expect(result.current.compareMode).toBe('guild-boss')
      expect(result.current.targetIncludePrimes).toBe(false)

      act(() => {
        result.current.setCompareMode('cluster-boss')
      })
      expect(result.current.targetIncludePrimes).toBe(false)
      act(() => {
        result.current.setTargetIncludePrimes(true)
      })
      expect(result.current.compareMode).toBe('cluster')
      expect(result.current.targetIncludePrimes).toBe(true)
      act(() => {
        result.current.setTargetIncludePrimes(false)
      })
      expect(result.current.compareMode).toBe('cluster-boss')
    })

    it('threads the derived primes flag into the target-weighted query key', () => {
      const { result } = renderHook(() =>
        usePlayerPerformanceData({
          selectedGuild: 'GUILD',
          selectedSeason: '1'
        })
      )
      act(() => {
        result.current.setPerformanceMode('target-weighted')
      })

      const keyPrimesFlag = () =>
        (
          targetWeightedQueryConfig?.queryKey as readonly unknown[] | undefined
        )?.[6]

      expect(keyPrimesFlag()).toBe(true)

      act(() => {
        result.current.setCompareMode('guild-boss')
      })
      expect(keyPrimesFlag()).toBe(false)

      act(() => {
        result.current.setTargetIncludePrimes(true)
      })
      expect(keyPrimesFlag()).toBe(true)
    })
  })
})
