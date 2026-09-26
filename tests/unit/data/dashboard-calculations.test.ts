import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  authenticatedDbClient: vi.fn()
}))

const { mockDashboardLogger } = vi.hoisted(() => ({
  mockDashboardLogger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: vi.fn(() => mockDashboardLogger)
}))

describe('Dashboard Calculations Module', () => {
  const mockRpc = vi.fn()
  const mockSupabase = { rpc: mockRpc }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('getTokenUsageByLoop', () => {
    it('should return empty object when RPC fails', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: null, error: new Error('RPC failed') })

      const { getTokenUsageByLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = getTokenUsageByLoop('GUILD', 'S1')

      await expect(result).resolves.toEqual({})
    })

    it('should return empty object when no data exists', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: [], error: null })

      const { getTokenUsageByLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getTokenUsageByLoop('GUILD', 'S1')

      expect(result).toEqual({})
    })

    it('should transform RPC data correctly', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)

      const mockData = [
        { loop_index: 0, bosses: 5, primes: 2, rarities: ['Legendary'] },
        {
          loop_index: 1,
          bosses: 8,
          primes: 4,
          rarities: ['Legendary', 'Mythic']
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getTokenUsageByLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getTokenUsageByLoop('GUILD', 'S1')

      expect(result[0]).toEqual({
        bosses: 5,
        primes: 2,
        rarities: ['Legendary'],
        displayLoop: 0
      })
      expect(result[1]).toEqual({
        bosses: 8,
        primes: 4,
        rarities: ['Legendary', 'Mythic'],
        displayLoop: 1
      })
    })

    it('should pass correct RPC parameters', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: [], error: null })

      const { getTokenUsageByLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      await getTokenUsageByLoop('MYGUILD', 'S5', ['Mythic'])

      expect(mockRpc).toHaveBeenCalledWith('get_token_usage_by_loop', {
        p_guild_code: 'MYGUILD',
        p_season: 'S5',
        p_rarities: ['Mythic']
      })
    })

    it('should use default rarities when not provided', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: [], error: null })

      const { getTokenUsageByLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      await getTokenUsageByLoop('GUILD', 'S1')

      expect(mockRpc).toHaveBeenCalledWith('get_token_usage_by_loop', {
        p_guild_code: 'GUILD',
        p_season: 'S1',
        p_rarities: ['Legendary', 'Mythic']
      })
    })

    it('should handle null rarities in data', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)

      const mockData = [{ loop_index: 0, bosses: 5, primes: 2, rarities: null }]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getTokenUsageByLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getTokenUsageByLoop('GUILD', 'S1')

      expect(result[0].rarities).toEqual([])
    })
  })

  describe('getTokenUsageByLoopAndSet', () => {
    it('should reject when RPC fails so React Query can retry', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: null, error: new Error('RPC failed') })

      const { getTokenUsageByLoopAndSet } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = getTokenUsageByLoopAndSet('GUILD', 'S1')

      await expect(result).rejects.toThrow('RPC failed')
    })

    it('should aggregate token counts by loop and set', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)

      const mockData = [
        { loop_index: 0, set_key: 'Set1', token_count: 10 },
        { loop_index: 0, set_key: 'Set2', token_count: 5 },
        { loop_index: 1, set_key: 'Set1', token_count: 8 }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getTokenUsageByLoopAndSet } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getTokenUsageByLoopAndSet('GUILD', 'S1')

      expect(result[0]).toEqual({ Set1: 10, Set2: 5, total: 15 })
      expect(result[1]).toEqual({ Set1: 8, total: 8 })
    })

    it('should log warning when data is empty', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: [], error: null })

      const { getTokenUsageByLoopAndSet } =
        await import('@/app/lib/data/dashboard-calculations')
      await getTokenUsageByLoopAndSet('GUILD', 'S1')

      expect(mockDashboardLogger.warn).toHaveBeenCalled()
    })
  })

  describe('getDamageByBossLoop', () => {
    it('should return empty result when RPC fails', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: null, error: new Error('RPC failed') })

      const { getDamageByBossLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getDamageByBossLoop('GUILD', 'S1')

      expect(result).toEqual({ data: [], bosses: [], detailedData: [] })
    })

    it('should group damage data by loop', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)

      const mockData = [
        {
          loop_index: 0,
          boss_display_name: 'M1 Magnus',
          avg_damage: 1000000,
          is_prime: false
        },
        {
          loop_index: 0,
          boss_display_name: 'L5 Avatar',
          avg_damage: 500000,
          is_prime: false
        },
        {
          loop_index: 1,
          boss_display_name: 'M1 Magnus',
          avg_damage: 1200000,
          is_prime: false
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getDamageByBossLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getDamageByBossLoop('GUILD', 'S1')

      expect(result.data).toHaveLength(2)
      expect(result.data[0].loop).toBe(0)
      expect(result.data[0]['M1 Magnus']).toBe(1000000)
      expect(result.data[0]['L5 Avatar']).toBe(500000)
    })

    it('should calculate average for all primes', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)

      const mockData = [
        {
          loop_index: 0,
          boss_display_name: 'Prime 1',
          avg_damage: 100000,
          is_prime: true
        },
        {
          loop_index: 0,
          boss_display_name: 'Prime 2',
          avg_damage: 200000,
          is_prime: true
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getDamageByBossLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getDamageByBossLoop('GUILD', 'S1')

      expect(result.data[0]['All Primes']).toBe(150000)
      expect(result.bosses).toContain('All Primes')
    })

    it('should sort bosses correctly (M before L, higher levels first)', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)

      const mockData = [
        {
          loop_index: 0,
          boss_display_name: 'L3 Avatar',
          avg_damage: 300000,
          is_prime: false
        },
        {
          loop_index: 0,
          boss_display_name: 'M1 Magnus',
          avg_damage: 1000000,
          is_prime: false
        },
        {
          loop_index: 0,
          boss_display_name: 'L5 SilentKing',
          avg_damage: 500000,
          is_prime: false
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getDamageByBossLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getDamageByBossLoop('GUILD', 'S1')

      expect(result.bosses[0]).toBe('M1 Magnus')
      expect(result.bosses[1]).toBe('L5 SilentKing')
      expect(result.bosses[2]).toBe('L3 Avatar')
    })

    it('should sort loops in ascending order', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)

      const mockData = [
        {
          loop_index: 2,
          boss_display_name: 'Boss',
          avg_damage: 300,
          is_prime: false
        },
        {
          loop_index: 0,
          boss_display_name: 'Boss',
          avg_damage: 100,
          is_prime: false
        },
        {
          loop_index: 1,
          boss_display_name: 'Boss',
          avg_damage: 200,
          is_prime: false
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getDamageByBossLoop } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getDamageByBossLoop('GUILD', 'S1')

      expect(result.data[0].loop).toBe(0)
      expect(result.data[1].loop).toBe(1)
      expect(result.data[2].loop).toBe(2)
    })
  })

  describe('getBossDifficultyAnalysis', () => {
    it('should return empty array when RPC fails', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: null, error: new Error('RPC failed') })

      const { getBossDifficultyAnalysis } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getBossDifficultyAnalysis('GUILD', 'S1')

      expect(result).toEqual([])
    })

    it('should transform RPC data to expected format', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)

      const mockData = [
        {
          boss_name: 'Magnus',
          display_name: 'M1 Magnus',
          rarity: 'Mythic',
          set_num: 1,
          encounter_id: 100,
          avg_attempts: 2.5,
          avg_time_minutes: 15.3,
          hit_count: 50,
          total_damage: 50000000,
          completed_loops: 8,
          total_loops: 10,
          completion_rate: 80.0,
          avg_damage_per_attempt: 1000000
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getBossDifficultyAnalysis } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getBossDifficultyAnalysis('GUILD', 'S1')

      expect(result).toHaveLength(1)
      expect(result[0]).toEqual({
        name: 'Magnus',
        displayName: 'M1 Magnus',
        tier: 'Mythic',
        set: 1,
        rarity: 'Mythic',
        encounterId: 100,
        attempts: 2.5,
        timeMinutes: 15.3,
        hitCount: 50,
        totalDamage: 50000000,
        completedLoops: 8,
        totalLoops: 10,
        completionRate: 80.0,
        avgDamagePerAttempt: 1000000
      })
    })

    it('should pass rarities filter to RPC', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: [], error: null })

      const { getBossDifficultyAnalysis } =
        await import('@/app/lib/data/dashboard-calculations')
      await getBossDifficultyAnalysis('GUILD', 'S1', ['Mythic'])

      expect(mockRpc).toHaveBeenCalledWith('get_boss_difficulty_analysis', {
        p_guild_code: 'GUILD',
        p_season: 'S1',
        p_rarities: ['Mythic']
      })
    })

    it('should handle multiple bosses', async () => {
      const { authenticatedDbClient } = await import('@/app/lib/db/client')
      vi.mocked(authenticatedDbClient).mockReturnValue(mockSupabase as never)

      const mockData = [
        {
          boss_name: 'Magnus',
          display_name: 'M1 Magnus',
          rarity: 'Mythic',
          set_num: 1,
          encounter_id: 100,
          avg_attempts: 2,
          avg_time_minutes: 10,
          hit_count: 50,
          total_damage: 50000000,
          completed_loops: 10,
          total_loops: 10,
          completion_rate: 100,
          avg_damage_per_attempt: 1000000
        },
        {
          boss_name: 'Avatar',
          display_name: 'L5 Avatar',
          rarity: 'Legendary',
          set_num: 2,
          encounter_id: 200,
          avg_attempts: 3,
          avg_time_minutes: 12,
          hit_count: 30,
          total_damage: 30000000,
          completed_loops: 8,
          total_loops: 10,
          completion_rate: 80,
          avg_damage_per_attempt: 800000
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getBossDifficultyAnalysis } =
        await import('@/app/lib/data/dashboard-calculations')
      const result = await getBossDifficultyAnalysis('GUILD', 'S1')

      expect(result).toHaveLength(2)
      expect(result[0].name).toBe('Magnus')
      expect(result[1].name).toBe('Avatar')
    })
  })
})
