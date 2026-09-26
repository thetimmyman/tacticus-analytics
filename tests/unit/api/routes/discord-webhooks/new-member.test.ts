import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('/api/discord-webhooks/new-member', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let GET: () => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    auth: { admin: { getUserById: ReturnType<typeof vi.fn> } }
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateServiceClient = vi.fn()

    vi.stubEnv('DISABLE_DISCORD_NEW_MEMBER_WEBHOOK', 'false')
    // The route refuses requests when the secret is unset.
    vi.stubEnv('DISCORD_WEBHOOK_SECRET', 'test-webhook-secret')

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))
    vi.doMock('@tacticus/app-core/api-errors', () => ({
      createErrorResponse: vi.fn().mockImplementation((code, message, opts) => {
        const status =
          code === 'UNAUTHORIZED' ? 401 : code === 'RATE_LIMITED' ? 429 : 400
        return new Response(JSON.stringify({ error: { code, message } }), {
          status
        })
      }),
      createSuccessResponse: vi.fn().mockImplementation((data, message) => {
        return new Response(JSON.stringify({ data, message }), { status: 200 })
      }),
      ErrorCode: {
        UNAUTHORIZED: 'UNAUTHORIZED',
        RATE_LIMITED: 'RATE_LIMITED',
        INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
        MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
        INTERNAL_ERROR: 'INTERNAL_ERROR'
      }
    }))

    mockSupabase = {
      from: vi.fn(),
      auth: {
        admin: {
          getUserById: vi.fn()
        }
      }
    }
    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule =
      await import('@/app/api/discord-webhooks/new-member/route')
    POST = routeModule.POST
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const createRequest = (
    body: object,
    headers: Record<string, string> = {}
  ) => {
    return new NextRequest('http://localhost/api/discord-webhooks/new-member', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': 'test-webhook-secret',
        ...headers
      },
      body: JSON.stringify(body)
    })
  }

  describe('GET (health check)', () => {
    it('returns health check status', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.success).toBe(true)
    })

    it('handles database error in health check', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' }
        })
      })

      const response = await GET()

      expect(response.status).toBe(500)
    })
  })

  describe('POST - webhook disabled', () => {
    it('returns success with webhook_sent false when disabled', async () => {
      vi.resetModules()
      vi.stubEnv('DISABLE_DISCORD_NEW_MEMBER_WEBHOOK', 'true')

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: mockCreateServiceClient
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
      vi.doMock('@tacticus/app-core/api-errors', () => ({
        createErrorResponse: vi.fn().mockImplementation((code, message) => {
          return new Response(JSON.stringify({ error: { code, message } }), {
            status: 400
          })
        }),
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: { UNAUTHORIZED: 'UNAUTHORIZED' }
      }))

      const routeModule =
        await import('@/app/api/discord-webhooks/new-member/route')

      const request = createRequest({
        playerData: { displayName: 'Test', guildCode: 'TEST' }
      })
      const response = await routeModule.POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.webhook_sent).toBe(false)
    })
  })

  describe('POST - webhook secret validation', () => {
    it('returns 401 when secret is required but not provided', async () => {
      vi.resetModules()
      vi.stubEnv('DISCORD_WEBHOOK_SECRET', 'secret123')
      vi.stubEnv('DISABLE_DISCORD_NEW_MEMBER_WEBHOOK', 'false')

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: mockCreateServiceClient
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
      vi.doMock('@tacticus/app-core/api-errors', () => ({
        createErrorResponse: vi.fn().mockImplementation((code, message) => {
          return new Response(JSON.stringify({ error: { code, message } }), {
            status: 401
          })
        }),
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: { UNAUTHORIZED: 'UNAUTHORIZED' }
      }))

      const routeModule =
        await import('@/app/api/discord-webhooks/new-member/route')

      const request = createRequest({ playerData: { displayName: 'Test' } })
      const response = await routeModule.POST(request)

      expect(response.status).toBe(401)
    })
  })

  describe('POST - validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const request = new NextRequest(
        'http://localhost/api/discord-webhooks/new-member',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': 'test-webhook-secret'
          },
          body: 'invalid-json'
        }
      )
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 when playerData is missing', async () => {
      const request = createRequest({ notPlayerData: {} })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('POST - incomplete data handling', () => {
    it('skips webhook when guild code is missing', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = createRequest({
        playerData: { displayName: 'Test', tacticusUserId: 'user123' }
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.webhook_sent).toBe(false)
      expect(body.data.reason).toContain('Missing guild code')
    })
  })

  describe('POST - webhook lookup', () => {
    let mockGuildConfigServiceGetBasic: ReturnType<typeof vi.fn>

    beforeEach(async () => {
      mockGuildConfigServiceGetBasic = vi.fn()
      vi.doMock('@/app/lib/services/guild-config-service', () => ({
        GuildConfigService: {
          getBasic: mockGuildConfigServiceGetBasic
        }
      }))
    })

    it('returns success when no webhook configured', async () => {
      vi.resetModules()

      const localMockSupabase = {
        from: vi.fn(),
        auth: { admin: { getUserById: vi.fn() } }
      }
      const localMockGuildConfigServiceGetBasic = vi.fn()

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: vi.fn().mockReturnValue(localMockSupabase)
      }))
      vi.doMock('@/app/lib/services/guild-config-service', () => ({
        GuildConfigService: {
          getBasic: localMockGuildConfigServiceGetBasic
        }
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
      vi.doMock('@tacticus/app-core/api-errors', () => ({
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: {
          UNAUTHORIZED: 'UNAUTHORIZED',
          INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
          MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
          RATE_LIMITED: 'RATE_LIMITED'
        }
      }))

      localMockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'TEST',
                display_name: 'Player',
                user_id: null
              },
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      localMockGuildConfigServiceGetBasic.mockResolvedValue({
        display_name: 'Test Guild',
        cluster_code: null
      })

      const routeModule =
        await import('@/app/api/discord-webhooks/new-member/route')
      const request = createRequest({
        playerData: {
          displayName: 'Test',
          guildCode: 'TEST',
          tacticusUserId: 'uid123'
        }
      })
      const response = await routeModule.POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.webhook_sent).toBe(false)
      expect(body.data.reason).toContain('No webhook configured')
    })

    it('returns success when webhook URL is invalid', async () => {
      vi.resetModules()

      const localMockSupabase = {
        from: vi.fn(),
        auth: { admin: { getUserById: vi.fn() } }
      }
      const localMockGuildConfigServiceGetBasic = vi.fn()

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: vi.fn().mockReturnValue(localMockSupabase)
      }))
      vi.doMock('@/app/lib/services/guild-config-service', () => ({
        GuildConfigService: {
          getBasic: localMockGuildConfigServiceGetBasic
        }
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
      vi.doMock('@tacticus/app-core/api-errors', () => ({
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: {
          UNAUTHORIZED: 'UNAUTHORIZED',
          INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
          MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
          RATE_LIMITED: 'RATE_LIMITED'
        }
      }))

      localMockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'TEST',
                display_name: 'Player',
                user_id: null
              },
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 1, webhook_url: 'not-a-url', enabled: true },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      localMockGuildConfigServiceGetBasic.mockResolvedValue({
        display_name: 'Test Guild',
        cluster_code: null
      })

      const routeModule =
        await import('@/app/api/discord-webhooks/new-member/route')
      const request = createRequest({
        playerData: {
          displayName: 'Test',
          guildCode: 'TEST',
          tacticusUserId: 'uid123'
        }
      })
      const response = await routeModule.POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.webhook_sent).toBe(false)
      expect(body.data.reason).toContain('Webhook URL invalid')
    })
  })

  describe('POST - successful webhook', () => {
    it('sends webhook successfully', async () => {
      vi.resetModules()

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      const localMockSupabase = {
        from: vi.fn(),
        auth: { admin: { getUserById: vi.fn() } }
      }
      const localMockGuildConfigServiceGetBasic = vi.fn()

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: vi.fn().mockReturnValue(localMockSupabase)
      }))
      vi.doMock('@/app/lib/services/guild-config-service', () => ({
        GuildConfigService: {
          getBasic: localMockGuildConfigServiceGetBasic
        }
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
      vi.doMock('@tacticus/app-core/api-errors', () => ({
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: {
          UNAUTHORIZED: 'UNAUTHORIZED',
          INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
          MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
          RATE_LIMITED: 'RATE_LIMITED'
        }
      }))

      localMockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'TEST',
                display_name: 'Player',
                user_id: null
              },
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: '1',
                webhook_url: 'https://discord.com/api/webhooks/123/token',
                enabled: true
              },
              error: null
            }),
            update: vi.fn().mockReturnThis()
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      localMockGuildConfigServiceGetBasic.mockResolvedValue({
        display_name: 'Test Guild',
        cluster_code: null
      })

      const routeModule =
        await import('@/app/api/discord-webhooks/new-member/route')
      const request = createRequest({
        playerData: {
          displayName: 'Test',
          guildCode: 'TEST',
          tacticusUserId: 'uid123'
        }
      })
      const response = await routeModule.POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.webhook_sent).toBe(true)
      expect(body.data.success).toBe(true)
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('POST - Discord API errors', () => {
    it('handles Discord API failure gracefully', async () => {
      vi.resetModules()

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error')
      })
      vi.stubGlobal('fetch', mockFetch)

      const localMockSupabase = {
        from: vi.fn(),
        auth: { admin: { getUserById: vi.fn() } }
      }
      const localMockGuildConfigServiceGetBasic = vi.fn()

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: vi.fn().mockReturnValue(localMockSupabase)
      }))
      vi.doMock('@/app/lib/services/guild-config-service', () => ({
        GuildConfigService: {
          getBasic: localMockGuildConfigServiceGetBasic
        }
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
      vi.doMock('@tacticus/app-core/api-errors', () => ({
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: {
          UNAUTHORIZED: 'UNAUTHORIZED',
          INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
          MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
          RATE_LIMITED: 'RATE_LIMITED'
        }
      }))

      localMockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'TEST',
                display_name: 'Player',
                user_id: null
              },
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: '1',
                webhook_url: 'https://discord.com/api/webhooks/123/token',
                enabled: true
              },
              error: null
            }),
            update: vi.fn().mockReturnThis()
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      localMockGuildConfigServiceGetBasic.mockResolvedValue({
        display_name: 'Test Guild',
        cluster_code: null
      })

      const routeModule =
        await import('@/app/api/discord-webhooks/new-member/route')
      const request = createRequest({
        playerData: {
          displayName: 'Test',
          guildCode: 'TEST',
          tacticusUserId: 'uid123'
        }
      })
      const response = await routeModule.POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.webhook_sent).toBe(false)
      expect(body.data.warning).toBeDefined()
    })

    it('times out hung Discord webhook requests and returns degraded success', async () => {
      vi.resetModules()
      vi.useFakeTimers()

      const abortError = () => {
        const error = new Error('Discord webhook request aborted')
        error.name = 'AbortError'
        return error
      }
      const mockFetch = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal
            if (signal?.aborted) {
              reject(abortError())
              return
            }
            signal?.addEventListener('abort', () => reject(abortError()), {
              once: true
            })
          })
      )
      vi.stubGlobal('fetch', mockFetch)

      const localMockSupabase = {
        from: vi.fn(),
        auth: { admin: { getUserById: vi.fn() } }
      }
      const localMockGuildConfigServiceGetBasic = vi.fn()

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: vi.fn().mockReturnValue(localMockSupabase)
      }))
      vi.doMock('@/app/lib/services/guild-config-service', () => ({
        GuildConfigService: {
          getBasic: localMockGuildConfigServiceGetBasic
        }
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
      vi.doMock('@tacticus/app-core/api-errors', () => ({
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: {
          UNAUTHORIZED: 'UNAUTHORIZED',
          INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
          MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
          RATE_LIMITED: 'RATE_LIMITED'
        }
      }))

      localMockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'TEST',
                display_name: 'Player',
                user_id: null
              },
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: '1',
                webhook_url: 'https://discord.com/api/webhooks/123/token',
                enabled: true
              },
              error: null
            }),
            update: vi.fn().mockReturnThis()
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      localMockGuildConfigServiceGetBasic.mockResolvedValue({
        display_name: 'Test Guild',
        cluster_code: null
      })

      const routeModule =
        await import('@/app/api/discord-webhooks/new-member/route')
      const request = createRequest({
        playerData: {
          displayName: 'Test',
          guildCode: 'TEST',
          tacticusUserId: 'uid123'
        }
      })

      try {
        const responsePromise = routeModule.POST(request)
        await vi.advanceTimersByTimeAsync(0)
        expect(mockFetch).toHaveBeenCalledTimes(1)

        await vi.advanceTimersByTimeAsync(10_000)
        await vi.advanceTimersByTimeAsync(1_000)
        expect(mockFetch).toHaveBeenCalledTimes(2)

        await vi.advanceTimersByTimeAsync(10_000)
        const response = await responsePromise
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.data.webhook_sent).toBe(false)
        expect(body.data.warning).toBe(
          'Could not send Discord notification but member was added'
        )
        expect(body.data.error_details).toContain('aborted')
      } finally {
        vi.useRealTimers()
      }
    })

    it('disables webhook on 404 error', async () => {
      vi.resetModules()

      const mockUpdate = vi.fn().mockReturnThis()
      const mockUpdateEq = vi.fn().mockResolvedValue({ error: null })
      mockUpdate.mockReturnValue({ eq: mockUpdateEq })

      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found')
      })
      vi.stubGlobal('fetch', mockFetch)

      const localMockSupabase = {
        from: vi.fn(),
        auth: { admin: { getUserById: vi.fn() } }
      }
      const localMockGuildConfigServiceGetBasic = vi.fn()

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: vi.fn().mockReturnValue(localMockSupabase)
      }))
      vi.doMock('@/app/lib/services/guild-config-service', () => ({
        GuildConfigService: {
          getBasic: localMockGuildConfigServiceGetBasic
        }
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
      vi.doMock('@tacticus/app-core/api-errors', () => ({
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: {
          UNAUTHORIZED: 'UNAUTHORIZED',
          INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
          MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
          RATE_LIMITED: 'RATE_LIMITED'
        }
      }))

      localMockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'TEST',
                display_name: 'Player',
                user_id: null
              },
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: '1',
                webhook_url: 'https://discord.com/api/webhooks/123/token',
                enabled: true
              },
              error: null
            }),
            update: mockUpdate
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      localMockGuildConfigServiceGetBasic.mockResolvedValue({
        display_name: 'Test Guild',
        cluster_code: null
      })

      const routeModule =
        await import('@/app/api/discord-webhooks/new-member/route')
      const request = createRequest({
        playerData: {
          displayName: 'Test',
          guildCode: 'TEST',
          tacticusUserId: 'uid123'
        }
      })
      const response = await routeModule.POST(request)

      expect(response.status).toBe(200)
      expect(mockUpdate).toHaveBeenCalled()
    })
  })

  describe('POST - cluster webhook fallback', () => {
    it('tries cluster webhook when guild webhook not found', async () => {
      vi.resetModules()

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      const localMockSupabase = {
        from: vi.fn(),
        auth: { admin: { getUserById: vi.fn() } }
      }
      const localMockGuildConfigServiceGetBasic = vi.fn()

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: vi.fn().mockReturnValue(localMockSupabase)
      }))
      vi.doMock('@/app/lib/services/guild-config-service', () => ({
        GuildConfigService: {
          getBasic: localMockGuildConfigServiceGetBasic
        }
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
      vi.doMock('@tacticus/app-core/api-errors', () => ({
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: {
          UNAUTHORIZED: 'UNAUTHORIZED',
          INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
          MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
          RATE_LIMITED: 'RATE_LIMITED'
        }
      }))

      let webhookCallCount = 0
      localMockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                guild_code: 'TEST',
                display_name: 'Player',
                user_id: null
              },
              error: null
            })
          }
        }
        if (table === 'clusters') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { id: 1 },
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          webhookCallCount++
          if (webhookCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: null, error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: '2',
                webhook_url: 'https://discord.com/api/webhooks/cluster/token',
                enabled: true
              },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      localMockGuildConfigServiceGetBasic.mockResolvedValue({
        display_name: 'Test Guild',
        cluster_code: 'EOT'
      })

      const routeModule =
        await import('@/app/api/discord-webhooks/new-member/route')
      const request = createRequest({
        playerData: {
          displayName: 'Test',
          guildCode: 'TEST',
          tacticusUserId: 'uid123'
        }
      })
      const response = await routeModule.POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.webhook_sent).toBe(true)
    })
  })

  describe('POST - Discord mention resolution', () => {
    it('includes Discord mention when user has Discord identity', async () => {
      vi.resetModules()

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      const localMockSupabase = {
        from: vi.fn(),
        rpc: vi.fn().mockResolvedValue({
          data: [
            {
              mapping_id: 42,
              player_id: 'uid123',
              user_id: 'auth-user-id',
              guild_code: 'TEST',
              role: 'member',
              is_app_admin: false,
              ownership_attestation_id: 'attestation-42',
              discord_user_id: '123456789012345678'
            }
          ],
          error: null
        }),
        auth: {
          admin: {
            getUserById: vi.fn().mockResolvedValue({
              data: {
                user: {
                  identities: [
                    {
                      provider: 'discord',
                      identity_data: { id: '123456789012345678' }
                    }
                  ]
                }
              }
            })
          }
        }
      }
      const localMockGuildConfigServiceGetBasic = vi.fn()

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: vi.fn().mockReturnValue(localMockSupabase)
      }))
      vi.doMock('@/app/lib/services/guild-config-service', () => ({
        GuildConfigService: {
          getBasic: localMockGuildConfigServiceGetBasic
        }
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
      vi.doMock('@tacticus/app-core/api-errors', () => ({
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: {
          UNAUTHORIZED: 'UNAUTHORIZED',
          INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
          MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
          RATE_LIMITED: 'RATE_LIMITED'
        }
      }))

      localMockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 42,
                player_id: 'uid123',
                guild_code: 'TEST',
                display_name: 'Player',
                user_id: 'auth-user-id',
                discord_user_id: '123456789012345678'
              },
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: '1',
                webhook_url: 'https://discord.com/api/webhooks/123/token',
                enabled: true
              },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      localMockGuildConfigServiceGetBasic.mockResolvedValue({
        display_name: 'Test Guild',
        cluster_code: null
      })

      const routeModule =
        await import('@/app/api/discord-webhooks/new-member/route')
      const request = createRequest({
        playerData: {
          displayName: 'Test',
          guildCode: 'TEST',
          tacticusUserId: 'uid123'
        }
      })
      const response = await routeModule.POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('<@123456789012345678>')
        })
      )
    })
  })
})
