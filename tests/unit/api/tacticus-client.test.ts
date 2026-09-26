import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@tacticus/app-core/app-config', () => ({
  TACTICUS_API: {
    BASE_URL: 'https://api.tacticus.test'
  }
}))

// A real class, not vi.fn().mockImplementation(), survives vi.restoreAllMocks().
const mockWithRetry = vi.fn()

class MockCircuitBreaker {
  name: string
  constructor(config: { name: string }) {
    this.name = config.name
  }
  async execute<T>(fn: () => Promise<T>): Promise<T> {
    return fn()
  }
  getState() {
    return 'CLOSED'
  }
  getMetrics() {
    return {}
  }
}

class MockCircuitOpenError extends Error {
  timeUntilHalfOpen: number
  constructor(name: string, timeUntilHalfOpen: number) {
    super(`Circuit "${name}" is OPEN`)
    this.name = 'CircuitOpenError'
    this.timeUntilHalfOpen = timeUntilHalfOpen
  }
}

vi.mock('@/app/lib/resilience', () => ({
  withRetry: mockWithRetry,
  CircuitBreaker: MockCircuitBreaker,
  CircuitOpenError: MockCircuitOpenError,
  DEFAULT_CIRCUIT_CONFIG: {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000
  },
  alertOnStateChange: () => {},
  TACTICUS_API_POLICY: {
    maxAttempts: 3,
    strategy: 'exponential',
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    jitter: true
  }
}))

describe('TacticusAPIClient', () => {
  const validApiKey = 'test-api-key-123'

  const mockPlayerData = {
    player: {
      details: {
        name: 'TestPlayer',
        powerLevel: 50000
      },
      units: [
        {
          id: 'unit-1',
          name: 'Marneus Calgar',
          faction: 'Ultramarines',
          grandAlliance: 'Imperium',
          progressionIndex: 3,
          xp: 1500,
          xpLevel: 15,
          rank: 5,
          shards: 100,
          abilities: [{ id: 'ability-1', level: 3 }]
        }
      ],
      progress: {
        guildRaid: {
          tokens: { current: 5, max: 5, regenDelayInSeconds: 3600 },
          bombTokens: { current: 1, max: 1, regenDelayInSeconds: 14400 }
        }
      }
    }
  }

  const mockGuildData = {
    guild: {
      name: 'Test Guild',
      members: ['player-1', 'player-2', 'player-3']
    }
  }

  const mockGuildRaidData = {
    season: 42,
    seasonConfigId: 'season-42',
    entries: [
      {
        userId: 'player-1',
        username: 'TestPlayer',
        damageType: 'Battle',
        startedOn: 1704067200,
        completedOn: 1704067500,
        unitId: 'unit-1',
        damageDealt: 125000,
        encounterType: 'boss',
        tier: 3,
        set: 2
      }
    ]
  }

  describe('normalizeUnixTimestampSeconds', () => {
    it('passes through seconds and normalizes larger Unix precisions', async () => {
      const { normalizeUnixTimestampSeconds } =
        await import('@/app/lib/api/tacticus-client')

      expect(normalizeUnixTimestampSeconds(1704067200)).toBe(1704067200)
      expect(normalizeUnixTimestampSeconds('1704067200')).toBe(1704067200)
      expect(normalizeUnixTimestampSeconds(1704067200123)).toBe(1704067200)
      expect(normalizeUnixTimestampSeconds('1704067200123')).toBe(1704067200)
      expect(normalizeUnixTimestampSeconds(1704067200123456)).toBe(1704067200)
      expect(normalizeUnixTimestampSeconds('1704067200123456')).toBe(1704067200)
      expect(normalizeUnixTimestampSeconds('1704067200123456789')).toBe(
        1704067200
      )
    })
  })

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    mockFetch.mockReset()
    mockWithRetry.mockReset()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('validateApiKey', () => {
    it('returns true when API key is valid', async () => {
      mockFetch.mockResolvedValue({
        ok: true
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.validateApiKey(validApiKey)

      expect(result).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.tacticus.test/player',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            Accept: 'application/json',
            'X-API-KEY': validApiKey
          })
        })
      )
    })

    it('returns false when API key is invalid', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.validateApiKey('invalid-key')

      expect(result).toBe(false)
    })

    it('returns false when fetch throws error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.validateApiKey(validApiKey)

      expect(result).toBe(false)
    })
  })

  describe('getPlayer', () => {
    it('returns player data when response contains nested player object', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockPlayerData)
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayer(validApiKey)

      expect(result).toEqual(mockPlayerData.player)
      expect(result?.details.name).toBe('TestPlayer')
    })

    it('returns player data when response contains flat player structure', async () => {
      const flatPlayerData = mockPlayerData.player
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(flatPlayerData)
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayer(validApiKey)

      expect(result).toEqual(flatPlayerData)
    })

    it('returns null when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
        text: vi.fn().mockResolvedValue('Player not found')
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayer(validApiKey)

      expect(result).toBeNull()
    })

    it('returns null when response format is unexpected', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ unexpected: 'format' })
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayer(validApiKey)

      expect(result).toBeNull()
    })

    it('returns null when fetch throws error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'))

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayer(validApiKey)

      expect(result).toBeNull()
    })

    it('handles error reading response body gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        text: vi.fn().mockRejectedValue(new Error('Failed to read body'))
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayer(validApiKey)

      expect(result).toBeNull()
    })
  })

  describe('getPlayerWithRetry', () => {
    it('returns player data using circuit breaker + retry logic', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockPlayerData)
      })

      mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>) =>
        fn()
      )

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayerWithRetry(validApiKey)

      expect(result).toEqual(mockPlayerData.player)
    })

    it('returns player data for flat structure with retry', async () => {
      const flatPlayerData = mockPlayerData.player
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(flatPlayerData)
      })
      mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>) =>
        fn()
      )

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayerWithRetry(validApiKey)

      expect(result).toEqual(flatPlayerData)
    })

    it('returns null when response is not ok with 4xx status', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      })
      mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>) =>
        fn()
      )

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayerWithRetry(validApiKey)

      expect(result).toBeNull()
    })

    it('returns null when fetch with retry throws', async () => {
      mockWithRetry.mockRejectedValue(new Error('All retries exhausted'))

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayerWithRetry(validApiKey)

      expect(result).toBeNull()
    })

    it('returns null for unexpected response format', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ unexpected: 'data' })
      })
      mockWithRetry.mockImplementation(async (fn: () => Promise<unknown>) =>
        fn()
      )

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getPlayerWithRetry(validApiKey)

      expect(result).toBeNull()
    })
  })

  describe('getGuild', () => {
    it('returns guild data when successful', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockGuildData)
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getGuild(validApiKey)

      expect(result).toEqual(mockGuildData.guild)
      expect(result?.name).toBe('Test Guild')
      expect(result?.members).toHaveLength(3)
    })

    it('returns null when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Forbidden'
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getGuild(validApiKey)

      expect(result).toBeNull()
    })

    it('returns null when response format is unexpected', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ noGuild: true })
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getGuild(validApiKey)

      expect(result).toBeNull()
    })

    it('returns null when fetch throws error', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'))

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getGuild(validApiKey)

      expect(result).toBeNull()
    })
  })

  describe('getCurrentGuildRaid', () => {
    it('returns guild raid data when successful', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockGuildRaidData)
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getCurrentGuildRaid(validApiKey)

      expect(result).toEqual(mockGuildRaidData)
      expect(result?.season).toBe(42)
      expect(result?.entries).toHaveLength(1)
    })

    it('normalizes millisecond raid timers to Unix seconds', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ...mockGuildRaidData,
          entries: [
            {
              ...mockGuildRaidData.entries[0],
              startedOn: 1704067200000,
              completedOn: 1704067500999
            }
          ]
        })
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getCurrentGuildRaid(validApiKey)

      expect(result?.entries[0]?.startedOn).toBe(1704067200)
      expect(result?.entries[0]?.completedOn).toBe(1704067500)
    })

    it('returns null when response is not ok', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 403,
        statusText: 'Forbidden',
        url: 'https://api.tacticus.test/guildRaid',
        text: vi.fn().mockResolvedValue('Access denied')
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getCurrentGuildRaid(validApiKey)

      expect(result).toBeNull()
    })

    it('handles error reading response body gracefully', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        statusText: 'Server Error',
        url: 'https://api.tacticus.test/guildRaid',
        text: vi.fn().mockRejectedValue(new Error('Cannot read'))
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getCurrentGuildRaid(validApiKey)

      expect(result).toBeNull()
    })

    it('returns null and logs details when fetch throws Error', async () => {
      const testError = new Error('Network timeout')
      testError.stack = 'Error at test'
      mockFetch.mockRejectedValue(testError)

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getCurrentGuildRaid(validApiKey)

      expect(result).toBeNull()
    })

    it('handles nested error object format', async () => {
      const nestedError = {
        error: { message: 'Nested error', stack: 'stack trace' }
      }
      mockFetch.mockRejectedValue(nestedError)

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getCurrentGuildRaid(validApiKey)

      expect(result).toBeNull()
    })
  })

  describe('getGuildRaidBySeason', () => {
    it('returns guild raid data for specific season', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue(mockGuildRaidData)
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getGuildRaidBySeason(validApiKey, 42)

      expect(result).toEqual(mockGuildRaidData)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.tacticus.test/guildRaid/42',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-API-KEY': validApiKey
          })
        })
      )
    })

    it('normalizes millisecond raid timers for season-specific responses', async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({
          ...mockGuildRaidData,
          entries: [
            {
              ...mockGuildRaidData.entries[0],
              startedOn: 1704067200123,
              completedOn: 1704067500456
            }
          ]
        })
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getGuildRaidBySeason(validApiKey, 42)

      expect(result?.entries[0]?.startedOn).toBe(1704067200)
      expect(result?.entries[0]?.completedOn).toBe(1704067500)
    })

    it('returns null when season not found', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        statusText: 'Not Found'
      })

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getGuildRaidBySeason(validApiKey, 999)

      expect(result).toBeNull()
    })

    it('returns null when fetch throws error', async () => {
      mockFetch.mockRejectedValue(new Error('Request failed'))

      const { TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')
      const client = new TacticusAPIClient()
      const result = await client.getGuildRaidBySeason(validApiKey, 42)

      expect(result).toBeNull()
    })
  })

  describe('singleton instance', () => {
    it('exports tacticusAPI singleton', async () => {
      const { tacticusAPI, TacticusAPIClient } =
        await import('@/app/lib/api/tacticus-client')

      expect(tacticusAPI).toBeInstanceOf(TacticusAPIClient)
    })
  })
})
