import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockReadFile: ReturnType<typeof vi.fn>
let mockGetWebhookUrlWithThread: ReturnType<typeof vi.fn>
let mockGetEmbedColor: ReturnType<typeof vi.fn>

describe('/api/discord-webhooks/version-update', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let GET: () => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateServiceClient = vi.fn()
    mockReadFile = vi.fn()
    mockGetWebhookUrlWithThread = vi.fn()
    mockGetEmbedColor = vi.fn()

    vi.stubEnv('DISABLE_DISCORD_VERSION_WEBHOOK', 'false')
    // Fails closed: unset secret → 500, mismatch → 401.
    vi.stubEnv('DISCORD_WEBHOOK_SECRET', 'test-webhook-secret')
    vi.stubEnv('NODE_ENV', 'production')

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))
    vi.doMock('fs/promises', () => ({
      default: { readFile: mockReadFile },
      readFile: mockReadFile
    }))
    vi.doMock('@/config/discord-webhooks', () => ({
      DISCORD_WEBHOOK_CONFIG: {
        bot: {
          username: 'Test Bot',
          avatarUrl: 'http://example.com/avatar.png'
        },
        threads: { majorVersionUpdates: '123456789' }
      },
      getWebhookUrlWithThread: mockGetWebhookUrlWithThread,
      getEmbedColor: mockGetEmbedColor
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
          code === 'UNAUTHORIZED'
            ? 401
            : code === 'RATE_LIMITED'
              ? 429
              : code === 'DISCORD_WEBHOOK_INVALID'
                ? 400
                : code === 'NOTIFICATION_SEND_FAILED'
                  ? 500
                  : 400
        return new Response(JSON.stringify({ error: { code, message } }), {
          status
        })
      }),
      createSuccessResponse: vi.fn().mockImplementation((data, message) => {
        return new Response(JSON.stringify({ data, message }), { status: 200 })
      }),
      ErrorCode: {
        UNAUTHORIZED: 'UNAUTHORIZED',
        INTERNAL_ERROR: 'INTERNAL_ERROR',
        DISCORD_WEBHOOK_INVALID: 'DISCORD_WEBHOOK_INVALID',
        EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
        RATE_LIMITED: 'RATE_LIMITED',
        NOTIFICATION_SEND_FAILED: 'NOTIFICATION_SEND_FAILED'
      }
    }))

    mockSupabase = {
      from: vi.fn()
    }
    mockCreateServiceClient.mockReturnValue(mockSupabase)
    mockReadFile.mockResolvedValue(JSON.stringify({ version: '1.0.0' }))
    mockGetWebhookUrlWithThread.mockImplementation((url: string) => url)
    mockGetEmbedColor.mockReturnValue(0x00ff00)

    const routeModule =
      await import('@/app/api/discord-webhooks/version-update/route')
    POST = routeModule.POST
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const createRequest = (
    body: object | null = null,
    headers: Record<string, string> = {}
  ) => {
    const options: RequestInit & { headers: Record<string, string> } = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-webhook-secret': 'test-webhook-secret',
        ...headers
      }
    }
    if (body !== null) {
      options.body = JSON.stringify(body)
    }
    return new NextRequest(
      'http://localhost/api/discord-webhooks/version-update',
      options
    )
  }

  describe('GET (health check)', () => {
    it('returns health check status', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            webhook_url: 'https://discord.com/api/webhooks/123/token',
            enabled: true
          },
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.success).toBe(true)
      expect(body.data.configured).toBe(true)
      expect(body.data.enabled).toBe(true)
    })

    it('reports invalid URL in health check', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { webhook_url: 'not-a-url', enabled: true },
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.invalid_url).toBe(true)
    })

    it('handles health check errors', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockRejectedValue(new Error('DB error'))
      })

      const response = await GET()

      expect(response.status).toBe(500)
    })
  })

  describe('POST - webhook disabled', () => {
    it('returns success with webhook_sent false when disabled', async () => {
      vi.resetModules()
      vi.stubEnv('DISABLE_DISCORD_VERSION_WEBHOOK', 'true')

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: mockCreateServiceClient
      }))
      vi.doMock('fs/promises', () => ({
        default: { readFile: mockReadFile },
        readFile: mockReadFile
      }))
      vi.doMock('@/config/discord-webhooks', () => ({
        DISCORD_WEBHOOK_CONFIG: { bot: {}, threads: {} },
        getWebhookUrlWithThread: mockGetWebhookUrlWithThread,
        getEmbedColor: mockGetEmbedColor
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
        createErrorResponse: vi
          .fn()
          .mockImplementation((code) => new Response('{}', { status: 400 })),
        createSuccessResponse: vi.fn().mockImplementation((data, message) => {
          return new Response(JSON.stringify({ data, message }), {
            status: 200
          })
        }),
        ErrorCode: {}
      }))

      const routeModule =
        await import('@/app/api/discord-webhooks/version-update/route')

      const request = createRequest({})
      const response = await routeModule.POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.webhook_sent).toBe(false)
    })
  })

  describe('POST - webhook secret validation', () => {
    const stubSecretMocks = () => {
      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: mockCreateServiceClient
      }))
      vi.doMock('fs/promises', () => ({
        default: { readFile: mockReadFile },
        readFile: mockReadFile
      }))
      vi.doMock('@/config/discord-webhooks', () => ({
        DISCORD_WEBHOOK_CONFIG: { bot: {}, threads: {} },
        getWebhookUrlWithThread: mockGetWebhookUrlWithThread,
        getEmbedColor: mockGetEmbedColor
      }))
      vi.doMock('@tacticus/app-core/logger', () => ({
        legacyConsoleLogger: {
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }
      }))
    }

    it('returns 401 when secret is configured but header is absent', async () => {
      vi.resetModules()
      vi.stubEnv('DISCORD_WEBHOOK_SECRET', 'secret123')
      vi.stubEnv('DISABLE_DISCORD_VERSION_WEBHOOK', 'false')
      stubSecretMocks()

      const routeModule =
        await import('@/app/api/discord-webhooks/version-update/route')

      const request = new NextRequest(
        'http://localhost/api/discord-webhooks/version-update',
        { method: 'POST', headers: { 'Content-Type': 'application/json' } }
      )
      const response = await routeModule.POST(request)

      expect(response.status).toBe(401)
    })

    it('returns 401 when secret is configured but header is wrong', async () => {
      vi.resetModules()
      vi.stubEnv('DISCORD_WEBHOOK_SECRET', 'secret123')
      vi.stubEnv('DISABLE_DISCORD_VERSION_WEBHOOK', 'false')
      stubSecretMocks()

      const routeModule =
        await import('@/app/api/discord-webhooks/version-update/route')

      const request = createRequest({}, { 'x-webhook-secret': 'wrong-secret' })
      const response = await routeModule.POST(request)

      expect(response.status).toBe(401)
    })

    it('fails closed with 500 when server secret is unset', async () => {
      vi.resetModules()
      vi.stubEnv('DISCORD_WEBHOOK_SECRET', '')
      vi.stubEnv('DISABLE_DISCORD_VERSION_WEBHOOK', 'false')
      stubSecretMocks()

      const routeModule =
        await import('@/app/api/discord-webhooks/version-update/route')

      const request = createRequest({}, { 'x-webhook-secret': 'anything' })
      const response = await routeModule.POST(request)

      expect(response.status).toBe(500)
    })

    it('passes when correct secret is provided', async () => {
      vi.resetModules()
      vi.stubEnv('DISCORD_WEBHOOK_SECRET', 'secret123')
      vi.stubEnv('DISABLE_DISCORD_VERSION_WEBHOOK', 'false')

      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      vi.doMock('@/app/lib/auth/server', () => ({
        createServiceClient: () => mockSupabase
      }))
      vi.doMock('fs/promises', () => ({
        default: {
          readFile: () => Promise.resolve(JSON.stringify({ version: '1.0.0' }))
        },
        readFile: () => Promise.resolve(JSON.stringify({ version: '1.0.0' }))
      }))
      vi.doMock('@/config/discord-webhooks', () => ({
        DISCORD_WEBHOOK_CONFIG: { bot: { username: 'Bot' }, threads: {} },
        getWebhookUrlWithThread: (url: string) => url,
        getEmbedColor: () => 0x00ff00
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
        createErrorResponse: vi.fn(),
        createSuccessResponse: vi.fn().mockImplementation((data) => {
          return new Response(JSON.stringify({ data }), { status: 200 })
        }),
        ErrorCode: {}
      }))

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
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

      const routeModule =
        await import('@/app/api/discord-webhooks/version-update/route')

      const request = createRequest({}, { 'x-webhook-secret': 'secret123' })
      const response = await routeModule.POST(request)

      expect(response.status).toBe(200)
    })
  })

  describe('POST - webhook configuration', () => {
    it('returns success when webhook not configured', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = createRequest({})
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.webhook_configured).toBe(false)
    })

    it('returns success when webhook URL is invalid', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { webhook_url: 'not-a-url', enabled: true },
          error: null
        })
      })

      const request = createRequest({})
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.webhook_configured).toBe(false)
    })
  })

  describe('POST - successful posting', () => {
    it('sends version update notification successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
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

      const request = createRequest({
        previousVersion: '0.9.0',
        commitMessage: 'Add new feature',
        commitHash: 'abc1234567890',
        deploymentUrl: 'https://example.com',
        changes: ['Added feature X', 'Fixed bug Y']
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.success).toBe(true)
      expect(body.data.webhook_configured).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Version')
        })
      )
    })

    it('handles optional body (no JSON)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
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

      const request = new NextRequest(
        'http://localhost/api/discord-webhooks/version-update',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-webhook-secret': 'test-webhook-secret'
          }
        }
      )
      const response = await POST(request)

      expect(response.status).toBe(200)
    })

    it('detects major version bump', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)
      mockReadFile.mockResolvedValue(JSON.stringify({ version: '2.0.0' }))

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
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

      const request = createRequest({ previousVersion: '1.0.0' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.versionType).toBe('major')
    })

    it('detects minor version bump', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)
      mockReadFile.mockResolvedValue(JSON.stringify({ version: '1.1.0' }))

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
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

      const request = createRequest({ previousVersion: '1.0.0' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.versionType).toBe('minor')
    })
  })

  describe('POST - Discord API errors', () => {
    it('returns 500 when the Discord webhook request hangs', async () => {
      vi.useFakeTimers()
      try {
        let aborted = false
        const mockFetch = vi.fn(
          (_url: string, init?: RequestInit): Promise<Response> =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener(
                'abort',
                () => {
                  aborted = true
                  reject(new DOMException('Aborted', 'AbortError'))
                },
                { once: true }
              )
            })
        )
        vi.stubGlobal('fetch', mockFetch)

        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          is: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: {
              webhook_url: 'https://discord.com/api/webhooks/123/token',
              enabled: true
            },
            error: null
          })
        })

        const request = createRequest({})
        const responsePromise = POST(request)

        await vi.waitFor(() => {
          expect(mockFetch).toHaveBeenCalled()
        })
        await vi.advanceTimersByTimeAsync(10_000)

        expect(aborted).toBe(true)
        const response = await responsePromise
        expect(response.status).toBe(500)
        expect(mockFetch).toHaveBeenCalledWith(
          'https://discord.com/api/webhooks/123/token',
          expect.objectContaining({
            signal: expect.any(AbortSignal)
          })
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('handles 404 webhook not found', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve('Not Found')
      })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            webhook_url: 'https://discord.com/api/webhooks/123/token',
            enabled: true
          },
          error: null
        })
      })

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('handles 429 rate limiting', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: () => Promise.resolve('Rate limited')
      })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            webhook_url: 'https://discord.com/api/webhooks/123/token',
            enabled: true
          },
          error: null
        })
      })

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(429)
    })

    it('handles 401/403 authentication failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized')
      })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        is: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            webhook_url: 'https://discord.com/api/webhooks/123/token',
            enabled: true
          },
          error: null
        })
      })

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('error handling', () => {
    it('handles unexpected errors gracefully', async () => {
      mockReadFile.mockRejectedValue(new Error('File not found'))

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(500)
    })
  })
})
