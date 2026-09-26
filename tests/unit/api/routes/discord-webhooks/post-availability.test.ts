import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockFindWebhookForGuild: ReturnType<typeof vi.fn>
let mockValidateWebhookManagementAccess: ReturnType<typeof vi.fn>
let mockLogger: {
  info: ReturnType<typeof vi.fn>
  warn: ReturnType<typeof vi.fn>
  error: ReturnType<typeof vi.fn>
  debug: ReturnType<typeof vi.fn>
}

describe('/api/discord-webhooks/post-availability', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let GET: () => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockFindWebhookForGuild = vi.fn()
    mockValidateWebhookManagementAccess = vi.fn()
    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))
    vi.doMock('@/app/lib/webhooks/webhook-helper', () => ({
      findWebhookForGuild: mockFindWebhookForGuild
    }))
    vi.doMock('@/app/lib/utils/cluster-validation', () => ({
      validateWebhookManagementAccess: mockValidateWebhookManagementAccess
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))
    vi.doMock('@/app/lib/logging', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/app/lib/logging')>()),
      createComponentLogger: () => mockLogger
    }))
    vi.doMock('@tacticus/app-core/api-errors', () => ({
      createErrorResponse: vi.fn().mockImplementation((code, message, opts) => {
        const status =
          code === 'UNAUTHORIZED'
            ? 401
            : code === 'USER_NOT_FOUND'
              ? 404
              : code === 'INSUFFICIENT_PERMISSIONS'
                ? 403
                : code === 'WEBHOOK_NOT_CONFIGURED'
                  ? 503
                  : code === 'RATE_LIMITED'
                    ? 429
                    : code === 'DISCORD_WEBHOOK_INVALID'
                      ? 400
                      : code === 'INTERNAL_SERVER_ERROR'
                        ? 500
                        : code === 'AUTHENTICATION_REQUIRED'
                          ? 401
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
        USER_NOT_FOUND: 'USER_NOT_FOUND',
        DATABASE_ERROR: 'DATABASE_ERROR',
        INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
        INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
        MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
        WEBHOOK_NOT_CONFIGURED: 'WEBHOOK_NOT_CONFIGURED',
        RATE_LIMITED: 'RATE_LIMITED',
        DISCORD_WEBHOOK_INVALID: 'DISCORD_WEBHOOK_INVALID',
        EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
        INTERNAL_SERVER_ERROR: 'INTERNAL_SERVER_ERROR',
        AUTHENTICATION_REQUIRED: 'AUTHENTICATION_REQUIRED'
      }
    }))

    mockSupabase = {
      auth: {
        getUser: vi.fn()
      },
      from: vi.fn()
    }
    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule =
      await import('@/app/api/discord-webhooks/post-availability/route')
    POST = routeModule.POST
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createRequest = (body: object) => {
    return new NextRequest(
      'http://localhost/api/discord-webhooks/post-availability',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
  }

  describe('GET (health check)', () => {
    it('returns health check status', async () => {
      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.status).toContain('active')
    })
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'No user' }
      })

      const request = createRequest({ content: 'Test message' })
      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('does not log secret-bearing request headers before auth completes', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'No user' }
      })

      const request = new NextRequest(
        'http://localhost/api/discord-webhooks/post-availability',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: 'Bearer secret-token',
            cookie: 'tacticus-auth-token=secret-session',
            'User-Agent': 'vitest'
          },
          body: JSON.stringify({ content: 'Test message' })
        }
      )
      await POST(request)

      const requestLog = mockLogger.info.mock.calls.find(
        (call) => call[1] === '[Discord Post] Request received'
      )?.[0] as { headers?: Record<string, string | null> } | undefined

      expect(requestLog).not.toHaveProperty('headers')
    })
  })

  describe('authorization', () => {
    it('returns 404 when no active guild membership found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' }
        })
      })

      const request = createRequest({ content: 'Test message' })
      const response = await POST(request)

      expect(response.status).toBe(404)
    })

    it('returns 400 when multiple active memberships found (data integrity issue)', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST115' }
        })
      })

      const request = createRequest({ content: 'Test message' })
      const response = await POST(request)

      // PGRST115 (multiple rows) maps to DATABASE_ERROR.
      expect(response.status).toBe(500)
    })

    it('returns 403 when user is not officer or leader', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'member', guild_code: 'TEST' },
          error: null
        })
      })

      const request = createRequest({ content: 'Test message' })
      const response = await POST(request)

      expect(response.status).toBe(403)
    })

    it('validates cluster access for cross-guild posting', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'MYGUILD' },
          error: null
        })
      })
      mockValidateWebhookManagementAccess.mockResolvedValue({
        valid: false,
        error: 'Not in same cluster'
      })

      const request = createRequest({
        guild: 'OTHERGUILD',
        content: 'Test message'
      })
      const response = await POST(request)

      expect(response.status).toBe(403)
      expect(mockValidateWebhookManagementAccess).toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/discord-webhooks/post-availability',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'invalid-json'
        }
      )
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 when content is missing', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      })

      const request = createRequest({ guild: 'TEST' })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 when content is empty string', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      })

      const request = createRequest({ content: '' })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('webhook configuration', () => {
    it('returns 503 when no webhook configured', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      })
      mockFindWebhookForGuild.mockResolvedValue(null)

      const request = createRequest({ content: 'Test message' })
      const response = await POST(request)

      expect(response.status).toBe(503)
      expect(mockFindWebhookForGuild).toHaveBeenCalledWith(
        'TEST',
        'gr_availability'
      )
    })
  })

  describe('message truncation', () => {
    it('truncates messages longer than 2000 characters', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      })
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )

      const longContent = 'A'.repeat(2500)
      const request = createRequest({ content: longContent })
      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('[Message truncated]')
        })
      )
    })
  })

  describe('successful posting', () => {
    it('posts availability message successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'officer', guild_code: 'TEST' },
          error: null
        })
      })
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )

      const request = createRequest({ content: 'GR availability: 3/3 ready' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('GR availability: 3/3 ready')
        })
      )
    })

    it('uses specified guild instead of user guild', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'MYGUILD' },
          error: null
        })
      })
      mockValidateWebhookManagementAccess.mockResolvedValue({ valid: true })
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )

      const request = createRequest({
        guild: 'OTHERGUILD',
        content: 'Test message'
      })
      await POST(request)

      expect(mockFindWebhookForGuild).toHaveBeenCalledWith(
        'OTHERGUILD',
        'gr_availability'
      )
    })
  })

  describe('Discord API errors', () => {
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

        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user123' } }
        })
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role: 'leader', guild_code: 'TEST' },
            error: null
          })
        })
        mockFindWebhookForGuild.mockResolvedValue(
          'https://discord.com/api/webhooks/123/token'
        )

        const request = createRequest({ content: 'Test message' })
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

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      })
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )

      const request = createRequest({ content: 'Test message' })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('handles 401/403 authentication failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden')
      })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      })
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )

      const request = createRequest({ content: 'Test message' })
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

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      })
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )

      const request = createRequest({ content: 'Test message' })
      const response = await POST(request)

      expect(response.status).toBe(429)
    })

    it('handles 400 bad request with Discord error message', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(JSON.stringify({ message: 'Invalid Form Body' }))
      })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      })
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )

      const request = createRequest({ content: 'Test message' })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('error handling', () => {
    it('handles unexpected errors gracefully', async () => {
      mockCreateClient.mockRejectedValue(
        new Error('Database connection failed')
      )

      const request = createRequest({ content: 'Test message' })
      const response = await POST(request)

      expect(response.status).toBe(500)
    })
  })
})
