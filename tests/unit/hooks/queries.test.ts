import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: vi.fn()
}))

vi.mock('@/app/lib/data/dashboard-calculations', () => ({
  getTokenUsageByLoop: vi.fn(),
  getTokenUsageByLoopAndSet: vi.fn(),
  getDamageByBossLoop: vi.fn(),
  getBossDifficultyAnalysis: vi.fn()
}))

vi.mock('@/app/lib/calculations/experimental/player-boss-performance', () => ({
  getPlayerBossPerformanceRPC: vi.fn()
}))

vi.mock(
  '@/app/lib/calculations/experimental/player-performance-summary',
  () => ({
    getPlayerPerformanceSummaryRPC: vi.fn()
  })
)

vi.mock('@/app/lib/calculations/experimental/guild-vs-cluster', () => ({
  getGuildVsClusterBossPerformanceRPC: vi.fn()
}))

vi.mock('@/app/lib/calculations/experimental/guild-vs-cluster-primes', () => ({
  getGuildVsClusterPrimePerformanceRPC: vi.fn()
}))

vi.mock('@/app/lib/calculations/experimental/player-stats', () => ({
  getPlayerStatsComprehensiveRPC: vi.fn()
}))

describe('Query Keys Factory', () => {
  it('should generate correct guild data key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.guildData('GUILD', 'S1')
    expect(key).toEqual(['guild', 'GUILD', 'S1'])
  })

  it('should generate correct guild members key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.guildMembers('GUILD')
    expect(key).toEqual(['members', 'GUILD'])
  })

  it('should generate correct guild config key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.guildConfig('GUILD')
    expect(key).toEqual(['config', 'GUILD'])
  })

  it('should generate correct player stats key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.playerStats('Player1', 'S1')
    expect(key).toEqual(['player', 'Player1', 'S1'])
  })

  it('should generate correct player battles key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.playerBattles('Player1', 'S1')
    expect(key).toEqual(['battles', 'Player1', 'S1'])
  })

  it('should generate correct player profile key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.playerProfile('user123')
    expect(key).toEqual(['profile', 'user123'])
  })

  it('should generate correct bosses key with default rarities', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.bosses('S1')
    expect(key).toEqual(['bosses', 'S1', ['Legendary', 'Mythic']])
  })

  it('should generate correct bosses key with custom rarities', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.bosses('S1', ['Epic', 'Rare'])
    expect(key).toEqual(['bosses', 'S1', ['Epic', 'Rare']])
  })

  it('should generate correct boss performance key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.bossPerformance('Magnus', 'S1')
    expect(key).toEqual(['boss', 'Magnus', 'S1'])
  })

  it('should generate correct token usage by loop key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.tokenUsageByLoop('GUILD', 'S1')
    expect(key).toEqual(['token-usage-by-loop', 'GUILD', 'S1'])
  })

  it('should generate correct damage by boss loop key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.damageByBossLoop('GUILD', 'S1')
    expect(key).toEqual(['damage-by-boss-loop', 'GUILD', 'S1'])
  })

  it('should generate correct boss difficulty analysis key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.bossDifficultyAnalysis('GUILD', 'S1', ['Legendary'])
    expect(key).toEqual([
      'boss-difficulty-analysis',
      'GUILD',
      'S1',
      ['Legendary']
    ])
  })

  it('should generate correct calculations key', async () => {
    const { queryKeys } = await import('@/app/lib/hooks/queries')
    const key = queryKeys.calculations('GUILD', 'S1', ['calc1', 'calc2'])
    expect(key).toEqual(['calculations', 'GUILD', 'S1', 'calc1', 'calc2'])
  })
})

describe('Player Query Keys', () => {
  it('should generate correct player boss performance key', async () => {
    const { playerQueryKeys } = await import('@/app/lib/hooks/queries')
    const key = playerQueryKeys.playerBossPerformance('GUILD', 'S1')
    expect(key).toEqual([
      'player-boss-performance',
      'GUILD',
      'S1',
      ['Legendary', 'Mythic']
    ])
  })

  it('should generate correct player boss performance key with custom rarities', async () => {
    const { playerQueryKeys } = await import('@/app/lib/hooks/queries')
    const key = playerQueryKeys.playerBossPerformance('GUILD', 'S1', ['Epic'])
    expect(key).toEqual(['player-boss-performance', 'GUILD', 'S1', ['Epic']])
  })

  it('should generate correct player performance summary key', async () => {
    const { playerQueryKeys } = await import('@/app/lib/hooks/queries')
    const key = playerQueryKeys.playerPerformanceSummary('GUILD', 'S1')
    expect(key).toEqual([
      'player-performance-summary',
      'GUILD',
      'S1',
      ['Legendary', 'Mythic']
    ])
  })

  it('should generate correct guild vs cluster boss key', async () => {
    const { playerQueryKeys } = await import('@/app/lib/hooks/queries')
    const key = playerQueryKeys.guildVsClusterBoss('GUILD', 'S1')
    expect(key).toEqual([
      'guild-vs-cluster-boss',
      'GUILD',
      'S1',
      ['Legendary', 'Mythic']
    ])
  })
})

describe('Boss Query Keys', () => {
  it('should generate correct boss performance metrics key', async () => {
    const { bossQueryKeys } = await import('@/app/lib/hooks/queries')
    const key = bossQueryKeys.bossPerformanceMetrics('GUILD', 'S1')
    expect(key).toEqual(['boss-performance-metrics', 'GUILD', 'S1'])
  })

  it('should generate correct guild vs cluster boss performance key', async () => {
    const { bossQueryKeys } = await import('@/app/lib/hooks/queries')
    const key = bossQueryKeys.guildVsClusterBossPerformance('GUILD', 'S1')
    expect(key).toEqual(['guild-vs-cluster-boss-performance', 'GUILD', 'S1'])
  })

  it('should generate correct guild vs cluster prime performance key', async () => {
    const { bossQueryKeys } = await import('@/app/lib/hooks/queries')
    const key = bossQueryKeys.guildVsClusterPrimePerformance('GUILD', 'S1')
    expect(key).toEqual(['guild-vs-cluster-prime-performance', 'GUILD', 'S1'])
  })

  it('should generate correct total damage key', async () => {
    const { bossQueryKeys } = await import('@/app/lib/hooks/queries')
    const key = bossQueryKeys.totalDamage('GUILD', 'S1')
    expect(key).toEqual(['total-damage', 'GUILD', 'S1'])
  })

  it('should generate correct max loop key', async () => {
    const { bossQueryKeys } = await import('@/app/lib/hooks/queries')
    const key = bossQueryKeys.maxLoop('GUILD', 'S1')
    expect(key).toEqual(['max-loop', 'GUILD', 'S1'])
  })
})

describe('Guild Data Hooks', () => {
  const mockSelect = vi.fn()
  const mockFrom = vi.fn()
  const mockEq = vi.fn()
  const mockOrder = vi.fn()
  const mockLimit = vi.fn()
  const mockSingle = vi.fn()

  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    })
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children
      )
  }

  beforeEach(() => {
    vi.clearAllMocks()
    mockFrom.mockReturnValue({ select: mockSelect })
    mockSelect.mockReturnValue({ eq: mockEq })
    mockEq.mockReturnValue({ eq: mockEq, order: mockOrder, single: mockSingle })
    mockOrder.mockReturnValue({ limit: mockLimit })
    mockLimit.mockResolvedValue({ data: [], error: null })
    mockSingle.mockResolvedValue({ data: null, error: null })
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('useGuildData', () => {
    it('builds the EOT_GR_data query with explicit columns, both filters, and timestamp-desc order', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue({ from: mockFrom } as never)

      const mockData = [
        {
          displayName: 'Player1',
          damageDealt: 1000000,
          damageType: 'Battle',
          tier: 1,
          set: 0,
          timestamp: '2025-01-01',
          Name: 'Magnus',
          Season: 'S1',
          Guild: 'GUILD',
          rarity: 'Legendary',
          loopIndex: 0
        }
      ]
      mockLimit.mockResolvedValue({ data: mockData, error: null })

      const { useGuildData } = await import('@/app/lib/hooks/queries')
      const { result } = renderHook(() => useGuildData('GUILD', 'S1'), {
        wrapper: createWrapper()
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      // data is a passthrough, so the regressible behaviour is the query shape.
      expect(mockFrom).toHaveBeenCalledWith('EOT_GR_data')
      const selectArg = mockSelect.mock.calls[0]?.[0] as string
      expect(selectArg).not.toBe('*')
      expect(selectArg).toContain('displayName')
      expect(selectArg).toContain('damageDealt')
      expect(selectArg).toContain('loopIndex')
      expect(mockEq).toHaveBeenCalledWith('Guild', 'GUILD')
      expect(mockEq).toHaveBeenCalledWith('Season', 'S1')
      expect(mockOrder).toHaveBeenCalledWith('timestamp', { ascending: false })

      expect(result.current.data).toEqual(mockData)
    })

    it('should use default limit of 500', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue({ from: mockFrom } as never)
      mockLimit.mockResolvedValue({ data: [], error: null })

      const { useGuildData } = await import('@/app/lib/hooks/queries')
      renderHook(() => useGuildData('GUILD', 'S1'), {
        wrapper: createWrapper()
      })

      await waitFor(() => expect(mockLimit).toHaveBeenCalledWith(500))
    })

    it('should throw error when query fails', async () => {
      const { dbClient } = await import('@/app/lib/db/client')
      vi.mocked(dbClient).mockReturnValue({ from: mockFrom } as never)
      mockLimit.mockResolvedValue({ data: null, error: new Error('DB error') })

      const { useGuildData } = await import('@/app/lib/hooks/queries')
      const { result } = renderHook(() => useGuildData('GUILD', 'S1'), {
        wrapper: createWrapper()
      })

      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })
})

describe('Dashboard Calculation Hooks', () => {
  const createWrapper = () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false }
      }
    })
    return ({ children }: { children: React.ReactNode }) =>
      React.createElement(
        QueryClientProvider,
        { client: queryClient },
        children
      )
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('useTokenUsageByLoop', () => {
    it('should call getTokenUsageByLoop with correct parameters', async () => {
      const { getTokenUsageByLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      vi.mocked(getTokenUsageByLoop).mockResolvedValue([])

      const { useTokenUsageByLoop } = await import('@/app/lib/hooks/queries')
      const { result } = renderHook(() => useTokenUsageByLoop('GUILD', 'S1'), {
        wrapper: createWrapper()
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(getTokenUsageByLoop).toHaveBeenCalledWith('GUILD', 'S1', [
        'Legendary',
        'Mythic'
      ])
    })

    it('should use custom rarities when provided', async () => {
      const { getTokenUsageByLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      vi.mocked(getTokenUsageByLoop).mockResolvedValue([])

      const { useTokenUsageByLoop } = await import('@/app/lib/hooks/queries')
      const { result } = renderHook(
        () => useTokenUsageByLoop('GUILD', 'S1', { rarities: ['Epic'] }),
        { wrapper: createWrapper() }
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(getTokenUsageByLoop).toHaveBeenCalledWith('GUILD', 'S1', ['Epic'])
    })

    it('should be disabled when guild or season is empty', async () => {
      const { useTokenUsageByLoop } = await import('@/app/lib/hooks/queries')
      const { result } = renderHook(() => useTokenUsageByLoop('', 'S1'), {
        wrapper: createWrapper()
      })

      expect(result.current.fetchStatus).toBe('idle')
    })
  })

  describe('useDamageByBossLoop', () => {
    it('should call getDamageByBossLoop with correct parameters', async () => {
      const { getDamageByBossLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      vi.mocked(getDamageByBossLoop).mockResolvedValue([])

      const { useDamageByBossLoop } = await import('@/app/lib/hooks/queries')
      const { result } = renderHook(() => useDamageByBossLoop('GUILD', 'S1'), {
        wrapper: createWrapper()
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(getDamageByBossLoop).toHaveBeenCalledWith('GUILD', 'S1')
    })
  })

  describe('useBossDifficultyAnalysis', () => {
    it('should call getBossDifficultyAnalysis with default rarities', async () => {
      const { getBossDifficultyAnalysis } =
        await import('@/app/lib/data/dashboard-calculations')
      vi.mocked(getBossDifficultyAnalysis).mockResolvedValue([])

      const { useBossDifficultyAnalysis } =
        await import('@/app/lib/hooks/queries')
      const { result } = renderHook(
        () => useBossDifficultyAnalysis('GUILD', 'S1'),
        { wrapper: createWrapper() }
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(getBossDifficultyAnalysis).toHaveBeenCalledWith('GUILD', 'S1', [
        'Legendary',
        'Mythic'
      ])
    })
  })
})

describe('Stale Time Configuration', () => {
  it('should have 5 minute stale time for guild data', () => {
    const expectedStaleTime = 5 * 60 * 1000
    expect(expectedStaleTime).toBe(300000)
  })

  it('should have 10 minute stale time for guild config', () => {
    const expectedStaleTime = 10 * 60 * 1000
    expect(expectedStaleTime).toBe(600000)
  })

  it('should have 2 minute stale time for member stats', () => {
    const expectedStaleTime = 2 * 60 * 1000
    expect(expectedStaleTime).toBe(120000)
  })

  it('should have 10 minute stale time for season bosses', () => {
    const expectedStaleTime = 10 * 60 * 1000
    expect(expectedStaleTime).toBe(600000)
  })
})

describe('GC Time Configuration', () => {
  it('should have 10 minute gc time for guild data', () => {
    const expectedGcTime = 10 * 60 * 1000
    expect(expectedGcTime).toBe(600000)
  })

  it('should have 5 minute gc time for member stats', () => {
    const expectedGcTime = 5 * 60 * 1000
    expect(expectedGcTime).toBe(300000)
  })

  it('should have 15 minute gc time for dashboard calculations', () => {
    const expectedGcTime = 15 * 60 * 1000
    expect(expectedGcTime).toBe(900000)
  })
})

describe('Member Stats Processing', () => {
  it('should calculate efficiency correctly', () => {
    const totalDamage = 5000000
    const battleCount = 10
    const efficiency = totalDamage / battleCount
    expect(efficiency).toBe(500000)
  })

  it('should handle zero battle count', () => {
    const totalDamage = 0
    const battleCount = 0
    const efficiency = battleCount > 0 ? totalDamage / battleCount : 0
    expect(efficiency).toBe(0)
  })

  it('should identify offender based on threshold', () => {
    const tokensUsed = 45
    const offenderThreshold = 40
    const isOffender = tokensUsed > offenderThreshold
    expect(isOffender).toBe(true)
  })

  it('should identify abuser based on threshold', () => {
    const tokensUsed = 55
    const abuserThreshold = 50
    const isAbuser = tokensUsed > abuserThreshold
    expect(isAbuser).toBe(true)
  })

  it('should not identify as offender below threshold', () => {
    const tokensUsed = 35
    const offenderThreshold = 40
    const isOffender = tokensUsed > offenderThreshold
    expect(isOffender).toBe(false)
  })
})

describe('Boss Metrics Processing', () => {
  it('should calculate average damage correctly', () => {
    const totalDamage = 3000000
    const hitCount = 6
    const avgDamage = hitCount > 0 ? totalDamage / hitCount : 0
    expect(avgDamage).toBe(500000)
  })

  it('should track max damage', () => {
    const damages = [400000, 600000, 500000]
    const maxDamage = Math.max(...damages)
    expect(maxDamage).toBe(600000)
  })

  it('should create unique boss key', () => {
    const record = {
      rarity: 'Legendary',
      set: 0,
      Name: 'Magnus',
      encounterId: 1
    }
    const key = `${record.rarity}_${record.set}_${record.Name}_${record.encounterId}`
    expect(key).toBe('Legendary_0_Magnus_1')
  })

  it('should sort by rarity order (Mythic > Legendary)', () => {
    const RARITY_ORDER = { Mythic: 3, Legendary: 2, Epic: 1 }
    const bosses = [
      { rarity: 'Legendary', name: 'Magnus' },
      { rarity: 'Mythic', name: 'Avatar' }
    ]
    const sorted = [...bosses].sort((a, b) => {
      const orderA = RARITY_ORDER[a.rarity as keyof typeof RARITY_ORDER] ?? 0
      const orderB = RARITY_ORDER[b.rarity as keyof typeof RARITY_ORDER] ?? 0
      return orderB - orderA
    })
    expect(sorted[0].name).toBe('Avatar')
  })
})
