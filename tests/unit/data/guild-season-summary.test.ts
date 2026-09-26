import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  db: vi.fn()
}))

describe('Guild Season Summary Module', () => {
  let mockSupabase: {
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()

    mockSupabase = {
      rpc: vi.fn()
    }
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('getGuildSeasonSummary', () => {
    it('should fetch and return guild season summary', async () => {
      const mockData = [
        {
          total_damage: 5000000,
          total_battles: 250,
          max_hit: 120000,
          boss_kills: 15,
          recent_activity: 42,
          avg_damage_per_hour: 8500.5
        }
      ]

      mockSupabase.rpc.mockResolvedValue({ data: mockData, error: null })

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSeasonSummary } =
        await import('@/app/lib/data/guild-season-summary')
      const result = await getGuildSeasonSummary('TEST', '85')

      expect(result).toEqual({
        total_damage: 5000000,
        total_battles: 250,
        max_hit: 120000,
        boss_kills: 15,
        recent_activity: 42,
        avg_damage_per_hour: 8500.5
      })
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'get_guild_season_summary',
        {
          p_guild_code: 'TEST',
          p_season: '85'
        }
      )
    })

    it('should throw error when guild is not provided', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSeasonSummary } =
        await import('@/app/lib/data/guild-season-summary')

      await expect(getGuildSeasonSummary('', '85')).rejects.toThrow(
        'Guild and season are required'
      )
    })

    it('should throw error when season is not provided', async () => {
      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSeasonSummary } =
        await import('@/app/lib/data/guild-season-summary')

      await expect(getGuildSeasonSummary('TEST', '')).rejects.toThrow(
        'Guild and season are required'
      )
    })

    it('should throw error on RPC failure', async () => {
      const rpcError = new Error('Database connection failed')
      mockSupabase.rpc.mockResolvedValue({ data: null, error: rpcError })

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSeasonSummary } =
        await import('@/app/lib/data/guild-season-summary')

      await expect(getGuildSeasonSummary('TEST', '85')).rejects.toThrow(
        'Database connection failed'
      )
    })

    it('should handle null values with defaults', async () => {
      const mockData = [
        {
          total_damage: null,
          total_battles: null,
          max_hit: null,
          boss_kills: null,
          recent_activity: null,
          avg_damage_per_hour: null
        }
      ]

      mockSupabase.rpc.mockResolvedValue({ data: mockData, error: null })

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSeasonSummary } =
        await import('@/app/lib/data/guild-season-summary')
      const result = await getGuildSeasonSummary('TEST', '85')

      expect(result).toEqual({
        total_damage: 0,
        total_battles: 0,
        max_hit: 0,
        boss_kills: 0,
        recent_activity: 0,
        avg_damage_per_hour: null
      })
    })

    it('should handle empty array response', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSeasonSummary } =
        await import('@/app/lib/data/guild-season-summary')
      const result = await getGuildSeasonSummary('TEST', '85')

      expect(result).toEqual({
        total_damage: 0,
        total_battles: 0,
        max_hit: 0,
        boss_kills: 0,
        recent_activity: 0,
        avg_damage_per_hour: null
      })
    })

    it('should handle null data response', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSeasonSummary } =
        await import('@/app/lib/data/guild-season-summary')
      const result = await getGuildSeasonSummary('TEST', '85')

      expect(result).toEqual({
        total_damage: 0,
        total_battles: 0,
        max_hit: 0,
        boss_kills: 0,
        recent_activity: 0,
        avg_damage_per_hour: null
      })
    })

    it('should handle undefined values', async () => {
      const mockData = [
        {
          total_damage: undefined,
          total_battles: 100,
          max_hit: undefined,
          boss_kills: 5,
          recent_activity: undefined,
          avg_damage_per_hour: undefined
        }
      ]

      mockSupabase.rpc.mockResolvedValue({ data: mockData, error: null })

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSeasonSummary } =
        await import('@/app/lib/data/guild-season-summary')
      const result = await getGuildSeasonSummary('TEST', '85')

      expect(result).toEqual({
        total_damage: 0,
        total_battles: 100,
        max_hit: 0,
        boss_kills: 5,
        recent_activity: 0,
        avg_damage_per_hour: null
      })
    })

    it('should convert string numbers to numbers', async () => {
      const mockData = [
        {
          total_damage: '5000000',
          total_battles: '250',
          max_hit: '120000',
          boss_kills: '15',
          recent_activity: '42',
          avg_damage_per_hour: '8500.5'
        }
      ]

      mockSupabase.rpc.mockResolvedValue({ data: mockData, error: null })

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSeasonSummary } =
        await import('@/app/lib/data/guild-season-summary')
      const result = await getGuildSeasonSummary('TEST', '85')

      expect(result.total_damage).toBe(5000000)
      expect(result.total_battles).toBe(250)
      expect(result.max_hit).toBe(120000)
      expect(result.boss_kills).toBe(15)
      expect(result.recent_activity).toBe(42)
      expect(result.avg_damage_per_hour).toBe(8500.5)
    })

    it('should handle zero values correctly', async () => {
      const mockData = [
        {
          total_damage: 0,
          total_battles: 0,
          max_hit: 0,
          boss_kills: 0,
          recent_activity: 0,
          avg_damage_per_hour: 0
        }
      ]

      mockSupabase.rpc.mockResolvedValue({ data: mockData, error: null })

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSeasonSummary } =
        await import('@/app/lib/data/guild-season-summary')
      const result = await getGuildSeasonSummary('TEST', '85')

      expect(result).toEqual({
        total_damage: 0,
        total_battles: 0,
        max_hit: 0,
        boss_kills: 0,
        recent_activity: 0,
        avg_damage_per_hour: 0
      })
    })
  })
})
