import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { API_REQUEST_CONFIG } from '@tacticus/app-core/api-constants'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const mockWithRetry = vi.fn()
vi.mock('@/app/lib/resilience', () => ({
  withRetry: mockWithRetry,
  TACTICUS_API_POLICY: {
    maxAttempts: 3,
    strategy: 'exponential',
    baseDelayMs: 1000,
    maxDelayMs: 10000,
    jitter: true
  }
}))

vi.mock('@/app/lib/loki/build-string', () => ({
  resolveLokiBuildString: vi.fn().mockResolvedValue('mock-build-string')
}))

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: vi.fn()
}))

describe('API Operations Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.resetAllMocks()
  })

  async function waitForFetch(fetchMock: ReturnType<typeof vi.fn>) {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (fetchMock.mock.calls.length > 0) {
        return
      }
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    }
    throw new Error('Timed out waiting for fetch')
  }

  async function hasSettled<T>(promise: Promise<T>): Promise<boolean> {
    let settled = false
    promise.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      }
    )

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (settled) {
        return true
      }
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    }
    return settled
  }

  describe('fetchGuildMembersViaTacticus', () => {
    it('should return member IDs on successful API response', async () => {
      const { fetchGuildMembersViaTacticus } =
        await import('@/app/lib/sync/api-operations')

      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          members: [
            { userId: 'user1' },
            { userId: 'user2' },
            { playerId: 'player3' }
          ]
        })
      }
      mockWithRetry.mockResolvedValue(mockResponse as unknown as Response)

      const result = await fetchGuildMembersViaTacticus(
        'api-key',
        'guild-id',
        'GUILD'
      )

      expect(result.success).toBe(true)
      expect(result.memberIds).toHaveLength(3)
      expect(result.memberIds).toContain('user1')
      expect(result.memberIds).toContain('user2')
      expect(result.memberIds).toContain('player3')
    })

    it('should handle 404 response gracefully', async () => {
      const { fetchGuildMembersViaTacticus } =
        await import('@/app/lib/sync/api-operations')

      const mockResponse = {
        ok: false,
        status: 404,
        json: vi.fn()
      }
      mockWithRetry.mockResolvedValue(mockResponse as unknown as Response)

      const result = await fetchGuildMembersViaTacticus(
        'api-key',
        'guild-id',
        'GUILD'
      )

      expect(result.success).toBe(false)
      expect(result.memberIds).toHaveLength(0)
      expect(result.error).toBe('Endpoint not found')
    })

    it('should handle HTTP errors', async () => {
      const { fetchGuildMembersViaTacticus } =
        await import('@/app/lib/sync/api-operations')

      const mockResponse = {
        ok: false,
        status: 500,
        json: vi.fn()
      }
      mockWithRetry.mockResolvedValue(mockResponse as unknown as Response)

      const result = await fetchGuildMembersViaTacticus(
        'api-key',
        'guild-id',
        'GUILD'
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('HTTP 500')
    })

    it('should handle network errors', async () => {
      const { fetchGuildMembersViaTacticus } =
        await import('@/app/lib/sync/api-operations')

      mockWithRetry.mockRejectedValue(new Error('Network error'))

      const result = await fetchGuildMembersViaTacticus(
        'api-key',
        'guild-id',
        'GUILD'
      )

      expect(result.success).toBe(false)
      expect(result.error).toBe('Network error')
    })

    it('aborts hung Tacticus member fetches', async () => {
      vi.useFakeTimers()
      let aborted = false
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true
              const abortError = new Error('Request timed out')
              abortError.name = 'AbortError'
              reject(abortError)
            },
            { once: true }
          )
        })
      })
      vi.stubGlobal('fetch', fetchMock)
      mockWithRetry.mockImplementation(
        async (operation: () => Promise<unknown>) => operation()
      )

      const { fetchGuildMembersViaTacticus } =
        await import('@/app/lib/sync/api-operations')
      const resultPromise = fetchGuildMembersViaTacticus(
        'api-key',
        'guild-id',
        'GUILD'
      )

      await waitForFetch(fetchMock)
      await vi.advanceTimersByTimeAsync(API_REQUEST_CONFIG.TIMEOUTS.SHORT)

      expect(aborted).toBe(true)
      const result = await resultPromise
      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')
    })

    it('times out hung Tacticus member response bodies', async () => {
      vi.useFakeTimers()
      let aborted = false
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            aborted = true
          },
          { once: true }
        )
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => new Promise(() => {})
        } as Response)
      })
      vi.stubGlobal('fetch', fetchMock)
      mockWithRetry.mockImplementation(
        async (operation: () => Promise<unknown>) => operation()
      )

      const { fetchGuildMembersViaTacticus } =
        await import('@/app/lib/sync/api-operations')
      const resultPromise = fetchGuildMembersViaTacticus(
        'api-key',
        'guild-id',
        'GUILD'
      )

      await waitForFetch(fetchMock)
      await vi.advanceTimersByTimeAsync(API_REQUEST_CONFIG.TIMEOUTS.SHORT)

      expect(await hasSettled(resultPromise)).toBe(true)
      expect(aborted).toBe(true)
      const result = await resultPromise
      expect(result.success).toBe(false)
      expect(result.error).toContain('timed out')
    })

    it('should extract member IDs from various response structures', async () => {
      const { fetchGuildMembersViaTacticus } =
        await import('@/app/lib/sync/api-operations')

      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({
          body: {
            guildMembers: [{ id: 'member1' }, { odlPlayerId: 'member2' }]
          }
        })
      }
      mockWithRetry.mockResolvedValue(mockResponse as unknown as Response)

      const result = await fetchGuildMembersViaTacticus(
        'api-key',
        'guild-id',
        'GUILD'
      )

      expect(result.success).toBe(true)
      expect(result.memberIds).toContain('member1')
      expect(result.memberIds).toContain('member2')
    })

    it('should return empty array when no members found', async () => {
      const { fetchGuildMembersViaTacticus } =
        await import('@/app/lib/sync/api-operations')

      const mockResponse = {
        ok: true,
        status: 200,
        json: vi.fn().mockResolvedValue({})
      }
      mockWithRetry.mockResolvedValue(mockResponse as unknown as Response)

      const result = await fetchGuildMembersViaTacticus(
        'api-key',
        'guild-id',
        'GUILD'
      )

      expect(result.success).toBe(false)
      expect(result.memberIds).toHaveLength(0)
    })
  })

  describe('fetchGuildRaidData', () => {
    it('should call withRetry and return the response', async () => {
      const { fetchGuildRaidData } =
        await import('@/app/lib/sync/api-operations')

      const mockResponse = { ok: true, status: 200 }
      mockWithRetry.mockResolvedValue(mockResponse as Response)

      const result = await fetchGuildRaidData('test-api-key', 'GUILD')

      expect(result).toBe(mockResponse)
      expect(mockWithRetry).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          maxAttempts: expect.any(Number)
        })
      )
    })

    it('aborts hung guild raid fetches', async () => {
      vi.useFakeTimers()
      let aborted = false
      const fetchMock = vi.fn((_url: string, init?: RequestInit) => {
        return new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true
              const abortError = new Error('Request timed out')
              abortError.name = 'AbortError'
              reject(abortError)
            },
            { once: true }
          )
        })
      })
      vi.stubGlobal('fetch', fetchMock)
      mockWithRetry.mockImplementation(
        async (operation: () => Promise<unknown>) => operation()
      )

      const { fetchGuildRaidData } =
        await import('@/app/lib/sync/api-operations')
      const resultPromise = fetchGuildRaidData('test-api-key', 'GUILD')
      const rejectionExpectation =
        expect(resultPromise).rejects.toThrow('timed out')

      await waitForFetch(fetchMock)
      await vi.advanceTimersByTimeAsync(API_REQUEST_CONFIG.TIMEOUTS.SHORT)

      expect(aborted).toBe(true)
      await rejectionExpectation
    })
  })

  // Refresh only on 401 or HTTP-500 invalid_session; refreshing on a 403 would not grant access.
  describe('shouldRefreshSession (real production helper)', () => {
    it('returns false when clientSecret is empty (cannot refresh without it)', async () => {
      const { shouldRefreshSession } =
        await import('@/app/lib/sync/api-operations')
      const result = { success: false, status: 401, error: 'Unauthorized' }
      expect(shouldRefreshSession(result, '')).toBe(false)
    })

    it('returns false when the result is successful', async () => {
      const { shouldRefreshSession } =
        await import('@/app/lib/sync/api-operations')
      const result = { success: true, status: 200 }
      expect(shouldRefreshSession(result, 'secret')).toBe(false)
    })

    it('returns true for 401 (expired session — refreshable)', async () => {
      const { shouldRefreshSession } =
        await import('@/app/lib/sync/api-operations')
      const result = { success: false, status: 401, error: 'Unauthorized' }
      expect(shouldRefreshSession(result, 'secret')).toBe(true)
    })

    it('returns false for 403 (permission denied — NOT refreshable)', async () => {
      const { shouldRefreshSession } =
        await import('@/app/lib/sync/api-operations')
      const result = { success: false, status: 403, error: 'Forbidden' }
      expect(shouldRefreshSession(result, 'secret')).toBe(false)
    })

    it('returns true for an invalid_session error at HTTP 500', async () => {
      const { shouldRefreshSession } =
        await import('@/app/lib/sync/api-operations')
      const result = { success: false, status: 500, error: 'invalid_session' }
      expect(shouldRefreshSession(result, 'secret')).toBe(true)
    })

    it('returns true for an "Incorrect session key" error at HTTP 500', async () => {
      const { shouldRefreshSession } =
        await import('@/app/lib/sync/api-operations')
      const result = {
        success: false,
        status: 500,
        error: 'Incorrect session key'
      }
      expect(shouldRefreshSession(result, 'secret')).toBe(true)
    })

    it('returns false for an unrelated HTTP 500 error', async () => {
      const { shouldRefreshSession } =
        await import('@/app/lib/sync/api-operations')
      const result = {
        success: false,
        status: 500,
        error: 'Internal server error'
      }
      expect(shouldRefreshSession(result, 'secret')).toBe(false)
    })

    it('returns false for a 500 with no error string (boundary)', async () => {
      const { shouldRefreshSession } =
        await import('@/app/lib/sync/api-operations')
      const result = { success: false, status: 500 }
      expect(shouldRefreshSession(result, 'secret')).toBe(false)
    })
  })

  describe('autoPatchGuildConfig', () => {
    it('throws when API key belongs to a different guild', async () => {
      const { autoPatchGuildConfig } =
        await import('@/app/lib/sync/api-operations')

      mockWithRetry.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            guild: {
              guildId: 'wrong-guild-id',
              guildCode: 'WRONG',
              name: 'Wrong Guild'
            }
          })
      } as unknown as Response)

      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              guild_code: 'TARGET',
              guild_id: 'target-guild-id',
              client_secret: 'some-secret'
            },
            error: null
          }),
          update: vi.fn().mockReturnThis()
        })
      }

      await expect(
        autoPatchGuildConfig(mockSupabase as any, 'TARGET', 'some-api-key')
      ).rejects.toThrow('API key belongs to a different guild')
    })
  })
})
