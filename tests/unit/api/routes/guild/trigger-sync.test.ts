import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SERVICE_TIMEOUTS } from '@/app/lib/utils/async-timeout'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockRequireRole: ReturnType<typeof vi.fn>
let mockAppCache: {
  get: ReturnType<typeof vi.fn>
  set: ReturnType<typeof vi.fn>
}

describe('POST /api/guild/trigger-sync', () => {
  let POST: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    functions: { invoke: ReturnType<typeof vi.fn> }
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateServiceClient = vi.fn()
    mockRequireRole = vi.fn()
    mockAppCache = {
      get: vi.fn(),
      set: vi.fn()
    }

    mockRequireRole.mockResolvedValue({
      profile: { guild_code: 'TEST', role: 'member' }
    })

    vi.doMock('@/app/lib/db', () => ({
      serviceDb: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireRole: mockRequireRole,
        requireRoleForApi: mockRequireRole
      }
    })

    vi.doMock('@/app/lib/logging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/app/lib/logging')>()
      return {
        ...actual,
        createComponentLogger: vi.fn(() => ({
          error: vi.fn(),
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn()
        }))
      }
    })

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        findByCodeOrTag: vi.fn().mockResolvedValue(null),
        normalizeCode: (code: string) => code.trim().toUpperCase()
      }
    }))

    vi.doMock('@tacticus/app-core/app-cache', () => ({
      appCache: mockAppCache
    }))

    mockSupabase = {
      from: vi.fn(),
      functions: { invoke: vi.fn() }
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)
    mockAppCache.get.mockResolvedValue(null)
    mockAppCache.set.mockResolvedValue(undefined)

    const routeModule = await import('@/app/api/guild/trigger-sync/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function waitForInvoke() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (mockSupabase.functions.invoke.mock.calls.length > 0) {
        return
      }
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(0)
    }
    throw new Error('Timed out waiting for function invoke')
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

  it.each([
    { success: false, partial: true, stats: { finalValidEntries: 99 } },
    { success: false, error: 'upstream unavailable' },
    null
  ])(
    'does not report a 2xx edge failure as a successful sync',
    async (data) => {
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null })
      })
      mockSupabase.functions.invoke.mockResolvedValue({ data, error: null })
      const response = await POST(
        new Request('http://localhost/api/guild/trigger-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        })
      )
      expect(response.status).toBe(502)
      expect((await response.json()).error.message).toBe(
        'Guild sync did not complete; please retry'
      )
    }
  )

  it('reports an already-running sync without claiming completion', async () => {
    mockSupabase.from.mockReturnValue({
      upsert: vi.fn().mockResolvedValue({ error: null })
    })
    mockSupabase.functions.invoke.mockResolvedValue({
      data: { success: true, skipped: 'sync_in_progress' },
      error: null
    })
    const response = await POST(
      new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })
    )
    expect(response.status).toBe(202)
    expect((await response.json()).skipped).toBe('sync_in_progress')
  })

  describe('auth', () => {
    it('returns 401 when user session is missing', async () => {
      const authError = Object.assign(new Error('Not authenticated'), {
        name: 'AuthError',
        code: 'UNAUTHENTICATED' as const
      })
      // Patch prototype so instanceof works with the route's AuthError.
      const { AuthError } =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      Object.setPrototypeOf(authError, AuthError.prototype)
      mockRequireRole.mockRejectedValue(authError)

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)
      expect(response.status).toBe(401)
    })

    it('returns 403 when guild code does not match profile', async () => {
      mockRequireRole.mockResolvedValue({
        profile: { guild_code: 'OTHER', role: 'member' }
      })

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)
      expect(response.status).toBe(403)
    })
  })

  describe('validation', () => {
    it('returns 400 when guild_code is missing', async () => {
      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Missing guild_code')
    })
  })

  describe('rate limiting', () => {
    it('returns 429 when rate limited', async () => {
      mockAppCache.get.mockResolvedValue(Date.now() - 10000)

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(429)
      expect(body.error.metadata.rateLimited).toBe(true)
      expect(body.error.metadata.retryAfter).toBeDefined()
      expect(body.error.message).toContain('Please wait')
    })

    it('allows request when rate limit window expired', async () => {
      mockAppCache.get.mockResolvedValue(Date.now() - 35000)
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null })
      })
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, stats: { finalValidEntries: 10 } },
        error: null
      })

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })
  })

  describe('sync status creation', () => {
    it('ensures the sync status row without stamping its clock', async () => {
      const upsertMock = vi.fn().mockResolvedValue({ error: null })
      mockSupabase.from.mockReturnValue({
        upsert: upsertMock
      })
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true },
        error: null
      })

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'test' })
      })

      await POST(request)

      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          guild_code: 'TEST',
          status: 'pending'
        }),
        { onConflict: 'guild_code', ignoreDuplicates: true }
      )

      // An early last_sync stamp would make a failed sync look green and skip unimported battles.
      const [payload] = upsertMock.mock.calls[0] as [Record<string, unknown>]
      expect(payload).not.toHaveProperty('last_sync')
    })
  })

  describe('successful sync', () => {
    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null })
      })
    })

    it('returns sync results on success', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: {
          success: true,
          message: 'Sync completed',
          stats: { finalValidEntries: 25 },
          battles_inserted: 20,
          battles_updated: 5,
          battles_failed: 0,
          season: 'season-42',
          unmapped_players: 2,
          processing_time_ms: 1500,
          timestamp: '2024-01-15T12:00:00Z'
        },
        error: null
      })

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.battles_synced).toBe(25)
      expect(body.battlesSynced).toBe(25)
      expect(body.battles_inserted).toBe(20)
      expect(body.season).toBe('season-42')
      expect(body.guild_code).toBe('TEST')
    })

    it('returns no battles message when zero entries', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: {
          success: true,
          message: 'No new battles',
          stats: { finalValidEntries: 0 }
        },
        error: null
      })

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.message).toContain('No new battles')
    })
  })

  describe('edge function errors', () => {
    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null })
      })
    })

    it('returns decryption error with requiresNewKey flag', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: null,
        error: { message: 'Failed to decrypt API key' }
      })

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to sync guild data')
      expect(body.error.metadata.details).toContain('decrypt')
      expect(body.error.metadata.requiresNewKey).toBe(true)
    })

    it('returns 404 with requiresOnboarding for not found error', async () => {
      mockRequireRole.mockResolvedValue({
        profile: { guild_code: 'MISSING', role: 'member' }
      })
      mockSupabase.functions.invoke.mockResolvedValue({
        data: null,
        error: { message: 'Guild configuration not found' }
      })

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'MISSING' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to sync guild data')
      expect(body.error.metadata.details).toContain('not found')
      expect(body.error.metadata.requiresOnboarding).toBe(true)
    })

    it('returns generic error for other edge function errors', async () => {
      mockSupabase.functions.invoke.mockResolvedValue({
        data: null,
        error: { message: 'Some other error' }
      })

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to sync guild data')
      expect(body.error.metadata.details).toBe('Some other error')
    })

    it('returns 500 when edge function throws exception', async () => {
      mockSupabase.functions.invoke.mockRejectedValue(
        new Error('Network error')
      )

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to sync guild data')
      expect(body.error.metadata.details).toBe('Network error')
    })

    it('times out hung edge function invoke', async () => {
      vi.useFakeTimers()
      mockSupabase.functions.invoke.mockImplementation(
        () => new Promise(() => {})
      )

      const responsePromise = POST(
        new Request('http://localhost/api/guild/trigger-sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        })
      )

      await waitForInvoke()
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

      expect(await hasSettled(responsePromise)).toBe(true)
      const response = await responsePromise
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to sync guild data')
      expect(body.error.metadata.details).toContain('timed out')
      expect(mockSupabase.functions.invoke).toHaveBeenCalledTimes(1)
    })
  })

  describe('error handling', () => {
    it('returns 500 when JSON parsing fails', async () => {
      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid json'
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to trigger sync:')
    })
  })

  describe('guild code normalization', () => {
    it('normalizes guild code to uppercase', async () => {
      mockRequireRole.mockResolvedValue({
        profile: { guild_code: 'LOWERCASE', role: 'member' }
      })
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null })
      })
      mockSupabase.functions.invoke.mockResolvedValue({
        data: { success: true, stats: { finalValidEntries: 0 } },
        error: null
      })

      const request = new Request('http://localhost/api/guild/trigger-sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'lowercase' })
      })

      await POST(request)

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'sync-modular-workflow',
        {
          body: { guild_code: 'LOWERCASE' }
        }
      )
    })
  })
})
