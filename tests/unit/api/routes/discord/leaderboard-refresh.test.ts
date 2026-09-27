import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock
} from 'vitest'

// vitest 5 types a bare vi.fn() as function-or-constructor; these mocks are called.
type AnyMock = Mock<(...args: any[]) => any>
import { NextRequest } from 'next/server'
import { SERVICE_TIMEOUTS } from '@/app/lib/utils/async-timeout'

describe('POST /api/discord/leaderboard-refresh', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockRequireRole: AnyMock
  let mockGuildConfigServiceGetBasic: AnyMock
  let mockSupabaseFunctions: { invoke: AnyMock }

  beforeEach(async () => {
    vi.resetModules()
    mockRequireRole = vi.fn()
    mockGuildConfigServiceGetBasic = vi.fn()
    mockSupabaseFunctions = { invoke: vi.fn() }

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireRole: mockRequireRole,
        requireRoleForApi: mockRequireRole
      }
    })
    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: vi.fn(() => ({
        functions: mockSupabaseFunctions
      }))
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))
    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        normalizeCode: (code: string) => code.trim().toUpperCase(),
        getBasic: (...args: any[]) => mockGuildConfigServiceGetBasic(...args)
      }
    }))

    const routeModule =
      await import('@/app/api/discord/leaderboard-refresh/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  const createRequest = (body: object = {}) => {
    return new NextRequest('http://localhost/api/discord/leaderboard-refresh', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  async function waitForInvoke() {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (mockSupabaseFunctions.invoke.mock.calls.length > 0) {
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

  describe('authentication', () => {
    it('requires leader role', async () => {
      mockRequireRole.mockRejectedValue(new Error('Unauthorized'))

      const request = createRequest({ guild_code: 'TEST' })
      const response = await POST(request)

      expect(response.status).toBe(500)
      expect(mockRequireRole).toHaveBeenCalledWith('leader')
    })
  })

  describe('validation', () => {
    it('returns 400 when guild_code is missing and profile has no guild', async () => {
      mockRequireRole.mockResolvedValue({ profile: { guild_code: null } })

      const request = createRequest({})
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Missing guild_code')
    })

    it('uses profile guild_code when not provided in request', async () => {
      mockRequireRole.mockResolvedValue({ profile: { guild_code: 'MYGUILD' } })
      mockGuildConfigServiceGetBasic.mockResolvedValue({
        guild_code: 'MYGUILD',
        cluster_code: 'EOT',
        display_name: 'My Guild',
        enabled: true
      })
      mockSupabaseFunctions.invoke.mockResolvedValue({
        data: { success: true },
        error: null
      })

      const request = createRequest({})
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.guild_code).toBe('MYGUILD')
    })

    it('normalizes guild_code to uppercase', async () => {
      mockRequireRole.mockResolvedValue({ profile: { guild_code: 'test' } })
      mockGuildConfigServiceGetBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT',
        display_name: 'Test Guild',
        enabled: true
      })
      mockSupabaseFunctions.invoke.mockResolvedValue({
        data: { success: true },
        error: null
      })

      const request = createRequest({ guild_code: '  test  ' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.guild_code).toBe('TEST')
    })
  })

  describe('guild validation', () => {
    it('returns 404 when guild not found', async () => {
      mockRequireRole.mockResolvedValue({ profile: { guild_code: 'NOTFOUND' } })
      mockGuildConfigServiceGetBasic.mockResolvedValue(null)

      const request = createRequest({ guild_code: 'NOTFOUND' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error.message).toContain('NOTFOUND not found')
    })

    it('returns 409 when guild is disabled', async () => {
      mockRequireRole.mockResolvedValue({ profile: { guild_code: 'TEST' } })
      mockGuildConfigServiceGetBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT',
        display_name: 'Test Guild',
        enabled: false
      })

      const request = createRequest({ guild_code: 'TEST' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(409)
      expect(body.error.message).toContain('disabled')
    })

    it('returns 403 when requesting refresh for another guild', async () => {
      mockRequireRole.mockResolvedValue({ profile: { guild_code: 'MYGUILD' } })

      const request = createRequest({ guild_code: 'OTHERGUILD' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('your own guild')
    })
  })

  describe('edge function invocation', () => {
    it('invokes edge function with cluster_code when available', async () => {
      mockRequireRole.mockResolvedValue({ profile: { guild_code: 'TEST' } })
      mockGuildConfigServiceGetBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT',
        display_name: 'Test Guild',
        enabled: true
      })
      mockSupabaseFunctions.invoke.mockResolvedValue({
        data: { success: true },
        error: null
      })

      const request = createRequest({ guild_code: 'TEST' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockSupabaseFunctions.invoke).toHaveBeenCalledWith(
        expect.stringContaining('update-discord-leaderboards'),
        expect.objectContaining({
          body: { cluster_code: 'EOT' }
        })
      )
    })

    it('invokes edge function with process_all when no cluster_code', async () => {
      mockRequireRole.mockResolvedValue({ profile: { guild_code: 'TEST' } })
      mockGuildConfigServiceGetBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: null,
        display_name: 'Test Guild',
        enabled: true
      })
      mockSupabaseFunctions.invoke.mockResolvedValue({
        data: { success: true },
        error: null
      })

      const request = createRequest({ guild_code: 'TEST' })
      await POST(request)

      expect(mockSupabaseFunctions.invoke).toHaveBeenCalledWith(
        expect.stringContaining('update-discord-leaderboards'),
        expect.objectContaining({
          body: { process_all: true }
        })
      )
    })

    it('returns 500 when edge function invocation fails after retries', async () => {
      mockRequireRole.mockResolvedValue({ profile: { guild_code: 'TEST' } })
      mockGuildConfigServiceGetBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT',
        display_name: 'Test Guild',
        enabled: true
      })
      mockSupabaseFunctions.invoke.mockResolvedValue({
        data: null,
        error: { message: 'Edge function failed' }
      })

      const request = createRequest({ guild_code: 'TEST' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain(
        'Unexpected error triggering leaderboard refresh'
      )
    })

    it('times out hung edge function invoke', async () => {
      vi.useFakeTimers()
      mockRequireRole.mockResolvedValue({ profile: { guild_code: 'TEST' } })
      mockGuildConfigServiceGetBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT',
        display_name: 'Test Guild',
        enabled: true
      })
      mockSupabaseFunctions.invoke.mockImplementation(
        () => new Promise(() => {})
      )

      const responsePromise = POST(createRequest({ guild_code: 'TEST' }))

      await waitForInvoke()
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

      expect(await hasSettled(responsePromise)).toBe(true)
      const response = await responsePromise
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('timed out')
      expect(mockSupabaseFunctions.invoke).toHaveBeenCalledTimes(1)
    })
  })

  describe('success response', () => {
    it('returns success with all guild details', async () => {
      mockRequireRole.mockResolvedValue({ profile: { guild_code: 'TEST' } })
      mockGuildConfigServiceGetBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT',
        display_name: 'Test Guild',
        enabled: true
      })
      mockSupabaseFunctions.invoke.mockResolvedValue({
        data: { guilds_updated: 5 },
        error: null
      })

      const request = createRequest({ guild_code: 'TEST' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.guild_code).toBe('TEST')
      expect(body.cluster_code).toBe('EOT')
      expect(body.triggered_at).toBeDefined()
      expect(body.response).toEqual({ guilds_updated: 5 })
    })
  })

  describe('error handling', () => {
    it('returns 500 for unexpected errors', async () => {
      mockRequireRole.mockRejectedValue(new Error('Unexpected error'))

      const request = createRequest({ guild_code: 'TEST' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Unexpected error triggering le')
    })
  })
})
