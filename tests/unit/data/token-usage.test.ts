import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('@/app/lib/db', () => ({
  db: vi.fn()
}))

vi.mock('@/app/lib/calculations/guild-settings', () => ({
  getGuildSettings: vi.fn()
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/calculations/metrics', () => ({
  recordCalculationMetric: vi.fn()
}))

describe('Token Usage Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('NEXT_PUBLIC_ENABLE_TOKEN_USAGE_RPC', 'true')
  })

  afterEach(() => {
    vi.resetAllMocks()
    vi.unstubAllEnvs()
  })

  describe('getTokenUsage', () => {
    it('should throw error when guild is missing', async () => {
      const { getTokenUsage } = await import('@/app/lib/data/token-usage')
      await expect(getTokenUsage('', '81')).rejects.toThrow(
        'Guild and season are required'
      )
    })

    it('should throw error when season is missing', async () => {
      const { getTokenUsage } = await import('@/app/lib/data/token-usage')
      await expect(getTokenUsage('TEST', '')).rejects.toThrow(
        'Guild and season are required'
      )
    })

    it('should return token usage data from RPC', async () => {
      const mockRpcData = [
        {
          player_id: 'player1',
          display_name: 'Player One',
          tokens_used: 42,
          max_possible: 48,
          tokens_below_offender: false,
          tokens_below_abuser: false,
          boss_tokens: 30,
          prime_tokens: 12,
          bombs_used: 2,
          bombs_available: 4
        }
      ]

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ data: mockRpcData, error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSettings } =
        await import('@/app/lib/calculations/guild-settings')
      vi.mocked(getGuildSettings).mockResolvedValue({
        token_offender_threshold: 4,
        token_abuser_threshold: 5
      } as never)

      const { getTokenUsage } = await import('@/app/lib/data/token-usage')
      const result = await getTokenUsage('TEST', '81')

      expect(result).toHaveLength(1)
      expect(result[0].player_id).toBe('player1')
      expect(result[0].display_name).toBe('Player One')
      expect(result[0].tokens_used).toBe(42)
      expect(result[0].max_possible).toBe(48)
    })

    it('should handle alternate field names in RPC response', async () => {
      const mockRpcData = [
        {
          user_id: 'player2',
          displayName: 'Player Two',
          token_count: 35,
          max_possible: 48
        }
      ]

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ data: mockRpcData, error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSettings } =
        await import('@/app/lib/calculations/guild-settings')
      vi.mocked(getGuildSettings).mockResolvedValue({} as never)

      const { getTokenUsage } = await import('@/app/lib/data/token-usage')
      const result = await getTokenUsage('TEST', '81')

      expect(result[0].player_id).toBe('player2')
      expect(result[0].display_name).toBe('Player Two')
      expect(result[0].tokens_used).toBe(35)
    })

    it('should throw error on RPC failure', async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'RPC function not found', code: 'PGRST202' }
        })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSettings } =
        await import('@/app/lib/calculations/guild-settings')
      vi.mocked(getGuildSettings).mockResolvedValue({} as never)

      const { getTokenUsage } = await import('@/app/lib/data/token-usage')
      await expect(getTokenUsage('TEST', '81')).rejects.toThrow(
        'RPC function not found'
      )
    })

    it('should throw error when RPC returns non-array', async () => {
      const mockSupabase = {
        rpc: vi
          .fn()
          .mockResolvedValue({ data: { invalid: 'data' }, error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSettings } =
        await import('@/app/lib/calculations/guild-settings')
      vi.mocked(getGuildSettings).mockResolvedValue({} as never)

      const { getTokenUsage } = await import('@/app/lib/data/token-usage')
      await expect(getTokenUsage('TEST', '81')).rejects.toThrow(
        'Token usage RPC returned non-array data'
      )
    })

    it('should use provided supabaseClient when passed', async () => {
      const mockRpcData = [
        {
          player_id: 'player1',
          display_name: 'Player One',
          tokens_used: 40,
          max_possible: 48
        }
      ]

      const mockProvidedClient = {
        rpc: vi.fn().mockResolvedValue({ data: mockRpcData, error: null })
      }

      const { getGuildSettings } =
        await import('@/app/lib/calculations/guild-settings')
      vi.mocked(getGuildSettings).mockResolvedValue({} as never)

      const { getTokenUsage } = await import('@/app/lib/data/token-usage')
      await getTokenUsage('TEST', '81', mockProvidedClient as never)

      expect(mockProvidedClient.rpc).toHaveBeenCalledWith(
        'get_token_usage_for_guild',
        {
          p_guild_code: 'TEST',
          p_season: '81'
        }
      )
    })

    it('normalizes UUID guild identifiers before settings and RPC calls', async () => {
      const inputGuild = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF'
      const canonicalGuild = 'abcdefab-cdef-4abc-8def-abcdefabcdef'
      const mockRpcData = [
        {
          player_id: 'player1',
          display_name: 'Player One',
          tokens_used: 40,
          max_possible: 48
        }
      ]

      const mockProvidedClient = {
        rpc: vi.fn().mockResolvedValue({ data: mockRpcData, error: null })
      }

      const { getGuildSettings } =
        await import('@/app/lib/calculations/guild-settings')
      vi.mocked(getGuildSettings).mockResolvedValue({} as never)

      const { getTokenUsage } = await import('@/app/lib/data/token-usage')
      await getTokenUsage(inputGuild, '100', mockProvidedClient as never)

      expect(getGuildSettings).toHaveBeenCalledWith(
        canonicalGuild,
        mockProvidedClient
      )
      expect(mockProvidedClient.rpc).toHaveBeenCalledWith(
        'get_token_usage_for_guild',
        {
          p_guild_code: canonicalGuild,
          p_season: '100'
        }
      )
    })

    it('should handle null values in RPC response', async () => {
      const mockRpcData = [
        {
          player_id: null,
          display_name: null,
          tokens_used: null,
          max_possible: null,
          burned_tokens: null,
          time_over_cap_seconds: null
        }
      ]

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ data: mockRpcData, error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSettings } =
        await import('@/app/lib/calculations/guild-settings')
      vi.mocked(getGuildSettings).mockResolvedValue({} as never)

      const { getTokenUsage } = await import('@/app/lib/data/token-usage')
      const result = await getTokenUsage('TEST', '81')

      expect(result[0].player_id).toBe('')
      expect(result[0].display_name).toBe('')
      expect(result[0].tokens_used).toBe(0)
      expect(result[0].max_possible).toBe(0)
    })
  })

  describe('getTokenUsageSummary', () => {
    it('should calculate summary statistics', async () => {
      const mockRpcData = [
        {
          player_id: 'player1',
          display_name: 'Player One',
          tokens_used: 48,
          max_possible: 48,
          tokens_below_offender: false,
          tokens_below_abuser: false
        },
        {
          player_id: 'player2',
          display_name: 'Player Two',
          tokens_used: 42,
          max_possible: 48,
          tokens_below_offender: true,
          tokens_below_abuser: false
        },
        {
          player_id: 'player3',
          display_name: 'Player Three',
          tokens_used: 38,
          max_possible: 48,
          tokens_below_offender: true,
          tokens_below_abuser: true
        }
      ]

      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ data: mockRpcData, error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSettings } =
        await import('@/app/lib/calculations/guild-settings')
      vi.mocked(getGuildSettings).mockResolvedValue({} as never)

      const { getTokenUsageSummary } =
        await import('@/app/lib/data/token-usage')
      const result = await getTokenUsageSummary('TEST', '81')

      expect(result.totalMembers).toBe(3)
      expect(result.totalTokensUsed).toBe(128)
      expect(result.totalMaxPossible).toBe(144)
      expect(result.efficiency).toBeCloseTo(88.89, 1)
      expect(result.offenders).toBe(2)
      expect(result.abusers).toBe(1)
    })

    it('should handle empty data', async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ data: [], error: null })
      }

      const { db } = await import('@/app/lib/db')
      vi.mocked(db).mockResolvedValue(mockSupabase as never)

      const { getGuildSettings } =
        await import('@/app/lib/calculations/guild-settings')
      vi.mocked(getGuildSettings).mockResolvedValue({} as never)

      const { getTokenUsageSummary } =
        await import('@/app/lib/data/token-usage')
      const result = await getTokenUsageSummary('TEST', '81')

      expect(result.totalMembers).toBe(0)
      expect(result.totalTokensUsed).toBe(0)
      expect(result.totalMaxPossible).toBe(0)
      expect(result.efficiency).toBe(0)
      expect(result.offenders).toBe(0)
      expect(result.abusers).toBe(0)
    })
  })
})
