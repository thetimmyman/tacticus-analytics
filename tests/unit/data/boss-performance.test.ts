import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  db: vi.fn()
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

describe('Boss Performance Data Module', () => {
  const mockRpc = vi.fn()
  const mockSupabase = { rpc: mockRpc }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('getBossPerformance', () => {
    it('should return empty object when no data exists', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: [], error: null })

      const { getBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getBossPerformance('GUILD', 'S1')

      expect(result).toEqual({})
      expect(mockRpc).toHaveBeenCalledWith('get_player_boss_performance', {
        guild_code_param: 'GUILD',
        season_param: 'S1'
      })
    })

    it('should throw error when guild code is missing', async () => {
      const { getBossPerformance } =
        await import('@/app/lib/data/boss-performance')

      await expect(getBossPerformance('', 'S1')).rejects.toThrow(
        'Guild code and season are required'
      )
    })

    it('should throw error when season is missing', async () => {
      const { getBossPerformance } =
        await import('@/app/lib/data/boss-performance')

      await expect(getBossPerformance('GUILD', '')).rejects.toThrow(
        'Guild code and season are required'
      )
    })

    it('should group performance data by player', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: 15,
          player_vs_cluster_avg: 10,
          boss_preference: 'strong'
        },
        {
          display_name: 'Player1',
          boss_name: 'Avatar',
          player_vs_guild_avg: -5,
          player_vs_cluster_avg: -3,
          boss_preference: 'weak'
        },
        {
          display_name: 'Player2',
          boss_name: 'Magnus',
          player_vs_guild_avg: 5,
          player_vs_cluster_avg: 8,
          boss_preference: 'neutral'
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getBossPerformance('GUILD', 'S1')

      expect(result).toHaveProperty('Player1')
      expect(result).toHaveProperty('Player2')
      expect(result['Player1']).toHaveLength(2)
      expect(result['Player2']).toHaveLength(1)
    })

    it('should group reserved player names as own data properties', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)
      mockRpc.mockResolvedValue({
        data: [
          {
            display_name: '__proto__',
            boss_name: 'Magnus',
            player_vs_guild_avg: 15,
            player_vs_cluster_avg: 10,
            boss_preference: 'strong'
          }
        ],
        error: null
      })

      const { getBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getBossPerformance('GUILD', 'S1')

      expect(Object.hasOwn(result, '__proto__')).toBe(true)
      expect(result['__proto__']).toHaveLength(1)
      expect(Object.hasOwn(Object.prototype, 'Magnus')).toBe(false)
    })

    it('should handle null boss preference as neutral', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: 0,
          player_vs_cluster_avg: 0,
          boss_preference: null
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getBossPerformance('GUILD', 'S1')

      expect(result['Player1'][0].preference).toBe('neutral')
    })

    it('should handle null performance values as 0', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: null,
          player_vs_cluster_avg: null,
          boss_preference: 'neutral'
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getBossPerformance('GUILD', 'S1')

      expect(result['Player1'][0].player_vs_guild_avg).toBe(0)
      expect(result['Player1'][0].player_vs_cluster_avg).toBe(0)
    })

    it('should throw error when RPC fails', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: null, error: new Error('RPC failed') })

      const { getBossPerformance } =
        await import('@/app/lib/data/boss-performance')

      await expect(getBossPerformance('GUILD', 'S1')).rejects.toThrow(
        'Failed to fetch boss performance'
      )
    })
  })

  describe('getPlayerBossPerformance', () => {
    it('should return performance data for specific player', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: 15,
          player_vs_cluster_avg: 10,
          boss_preference: 'strong'
        },
        {
          display_name: 'Player2',
          boss_name: 'Magnus',
          player_vs_guild_avg: 5,
          player_vs_cluster_avg: 8,
          boss_preference: 'neutral'
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getPlayerBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getPlayerBossPerformance('GUILD', 'S1', 'Player1')

      expect(result).toHaveLength(1)
      expect(result[0].boss_name).toBe('Magnus')
      expect(result[0].player_vs_guild_avg).toBe(15)
    })

    it('should throw error when player name is missing', async () => {
      const { getPlayerBossPerformance } =
        await import('@/app/lib/data/boss-performance')

      await expect(getPlayerBossPerformance('GUILD', 'S1', '')).rejects.toThrow(
        'Guild code, season, and player name are required'
      )
    })

    it('should return empty array when player not found', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: 15,
          player_vs_cluster_avg: 10,
          boss_preference: 'strong'
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getPlayerBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getPlayerBossPerformance(
        'GUILD',
        'S1',
        'NonExistent'
      )

      expect(result).toHaveLength(0)
    })
  })

  describe('getHistoricalBossPerformance', () => {
    it('should return empty object when guild code is missing', async () => {
      const { getHistoricalBossPerformance } =
        await import('@/app/lib/data/boss-performance')

      await expect(getHistoricalBossPerformance('')).rejects.toThrow(
        'Guild code is required'
      )
    })

    it('should call flexible RPC first', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: 15,
          battle_count: 10,
          has_sufficient_data: true
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getHistoricalBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      await getHistoricalBossPerformance('GUILD')

      expect(mockRpc).toHaveBeenCalledWith(
        'get_player_boss_performance_flexible',
        {
          guild_code_param: 'GUILD',
          min_battles_param: 1
        }
      )
    })

    it('should fall back to historical RPC when flexible does not exist', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      mockRpc
        .mockResolvedValueOnce({
          data: null,
          error: { message: 'function does not exist' }
        })
        .mockResolvedValueOnce({ data: [], error: null })

      const { getHistoricalBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      await getHistoricalBossPerformance('GUILD')

      expect(mockRpc).toHaveBeenCalledTimes(2)
      expect(mockRpc).toHaveBeenNthCalledWith(
        2,
        'get_player_boss_performance_historical',
        {
          guild_code_param: 'GUILD'
        }
      )
    })

    it('should return empty object when both RPCs fail', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      mockRpc.mockResolvedValue({
        data: null,
        error: { message: 'Connection error' }
      })

      const { getHistoricalBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getHistoricalBossPerformance('GUILD')

      expect(result).toEqual({})
    })

    it('should set player_vs_guild_avg to 0 when has_sufficient_data is false', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: 25,
          battle_count: 2,
          has_sufficient_data: false
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getHistoricalBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getHistoricalBossPerformance('GUILD')

      expect(result['Player1'][0].player_vs_guild_avg).toBe(0)
      expect(result['Player1'][0].has_sufficient_data).toBe(false)
    })

    it('should include battle_count in results', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: 15,
          battle_count: 50,
          has_sufficient_data: true
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getHistoricalBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getHistoricalBossPerformance('GUILD')

      expect(result['Player1'][0].battle_count).toBe(50)
    })

    it('should preserve reserved player names in historical results', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)
      mockRpc.mockResolvedValue({
        data: [
          {
            display_name: '__proto__',
            boss_name: 'Magnus',
            player_vs_guild_avg: 15,
            battle_count: 1,
            has_sufficient_data: true
          }
        ],
        error: null
      })

      const { getHistoricalBossPerformance } =
        await import('@/app/lib/data/boss-performance')
      const result = await getHistoricalBossPerformance('GUILD')

      expect(Object.hasOwn(result, '__proto__')).toBe(true)
      expect(result['__proto__']?.[0]?.boss_name).toBe('Magnus')
    })
  })

  describe('getBossPerformanceSummary', () => {
    it('should calculate correct summary statistics', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: 30,
          player_vs_cluster_avg: 25,
          boss_preference: 'strong'
        },
        {
          display_name: 'Player1',
          boss_name: 'Avatar',
          player_vs_guild_avg: 20,
          player_vs_cluster_avg: 15,
          boss_preference: 'strong'
        },
        {
          display_name: 'Player2',
          boss_name: 'Magnus',
          player_vs_guild_avg: -30,
          player_vs_cluster_avg: -25,
          boss_preference: 'weak'
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getBossPerformanceSummary } =
        await import('@/app/lib/data/boss-performance')
      const result = await getBossPerformanceSummary('GUILD', 'S1')

      expect(result.totalPlayers).toBe(2)
      expect(result.strongPerformers).toContain('Player1')
      expect(result.weakPerformers).toContain('Player2')
    })

    it('should return zeros when no data exists', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)
      mockRpc.mockResolvedValue({ data: [], error: null })

      const { getBossPerformanceSummary } =
        await import('@/app/lib/data/boss-performance')
      const result = await getBossPerformanceSummary('GUILD', 'S1')

      expect(result.totalPlayers).toBe(0)
      expect(result.averageGuildPerformance).toBe(0)
      expect(result.averageClusterPerformance).toBe(0)
      expect(result.strongPerformers).toHaveLength(0)
      expect(result.weakPerformers).toHaveLength(0)
    })

    it('should classify neutral performers correctly', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: 10,
          player_vs_cluster_avg: 5,
          boss_preference: 'neutral'
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getBossPerformanceSummary } =
        await import('@/app/lib/data/boss-performance')
      const result = await getBossPerformanceSummary('GUILD', 'S1')

      expect(result.strongPerformers).not.toContain('Player1')
      expect(result.weakPerformers).not.toContain('Player1')
    })

    it('should calculate average performance correctly', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const mockData = [
        {
          display_name: 'Player1',
          boss_name: 'Magnus',
          player_vs_guild_avg: 20,
          player_vs_cluster_avg: 10,
          boss_preference: 'neutral'
        },
        {
          display_name: 'Player2',
          boss_name: 'Magnus',
          player_vs_guild_avg: 10,
          player_vs_cluster_avg: 20,
          boss_preference: 'neutral'
        }
      ]
      mockRpc.mockResolvedValue({ data: mockData, error: null })

      const { getBossPerformanceSummary } =
        await import('@/app/lib/data/boss-performance')
      const result = await getBossPerformanceSummary('GUILD', 'S1')

      expect(result.averageGuildPerformance).toBe(15)
      expect(result.averageClusterPerformance).toBe(15)
    })
  })
})
