import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('POST /api/discord-webhooks/event-notification', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('CRON_SECRET', 'test-cron-secret')
    mockCreateServiceClient = vi.fn()

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
    vi.doMock('@tacticus/app-core/formatters', () => ({
      formatNumber: vi.fn((n) => String(n ?? 0))
    }))
    vi.doMock('@tacticus/app-core/api-errors', () => ({
      createErrorResponse: vi.fn().mockImplementation((code, message, opts) => {
        const status =
          code === 'WEBHOOK_NOT_CONFIGURED'
            ? 503
            : code === 'WEBHOOK_DISABLED'
              ? 503
              : code === 'RATE_LIMITED'
                ? 429
                : code === 'DISCORD_WEBHOOK_INVALID'
                  ? 400
                  : 400
        return new Response(JSON.stringify({ error: { code, message } }), {
          status
        })
      }),
      createSuccessResponse: vi.fn().mockImplementation((data, message) => {
        return new Response(JSON.stringify({ data, message }), { status: 200 })
      }),
      ErrorCode: {
        INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
        INVALID_REQUEST: 'INVALID_REQUEST',
        MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
        WEBHOOK_NOT_CONFIGURED: 'WEBHOOK_NOT_CONFIGURED',
        WEBHOOK_DISABLED: 'WEBHOOK_DISABLED',
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

    const routeModule =
      await import('@/app/api/discord-webhooks/event-notification/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const CRON_AUTH = 'Bearer test-cron-secret'

  const createRequest = (
    body: object,
    authHeader: string | undefined = CRON_AUTH
  ) => {
    return new NextRequest(
      'http://localhost/api/discord-webhooks/event-notification',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authHeader ? { authorization: authHeader } : {})
        },
        body: JSON.stringify(body)
      }
    )
  }

  describe('authentication (WI-1604)', () => {
    it('returns 401 when the cron secret is set but no auth header is sent', async () => {
      const response = await POST(
        createRequest({ type: 'new_member', data: {} }, '')
      )
      expect(response.status).toBe(401)
    })

    it('returns 401 when the auth header is wrong', async () => {
      const response = await POST(
        createRequest({ type: 'new_member', data: {} }, 'Bearer wrong-secret')
      )
      expect(response.status).toBe(401)
    })

    it('returns 500 (fail-closed) when CRON_SECRET is unset', async () => {
      vi.stubEnv('CRON_SECRET', '')
      const response = await POST(
        createRequest({ type: 'new_member', data: {} }, '')
      )
      expect(response.status).toBe(500)
    })
  })

  describe('validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      const request = new NextRequest(
        'http://localhost/api/discord-webhooks/event-notification',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            authorization: CRON_AUTH
          },
          body: 'invalid-json'
        }
      )
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 when type is missing', async () => {
      const request = createRequest({ data: {} })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 when data is missing', async () => {
      const request = createRequest({ type: 'new_member' })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 for invalid event type', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = createRequest({ type: 'invalid_type', data: {} })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('webhook configuration', () => {
    it('returns 503 when no webhook configured', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = createRequest({
        type: 'new_member',
        data: { display_name: 'Test', guild_code: 'TEST' }
      })
      const response = await POST(request)

      expect(response.status).toBe(503)
    })

    it('returns 503 when webhook is disabled', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            webhook_url: 'https://discord.com/api/webhooks/123/token',
            enabled: false
          },
          error: null
        })
      })

      const request = createRequest({
        type: 'new_member',
        data: { display_name: 'Test', guild_code: 'TEST' }
      })
      const response = await POST(request)

      expect(response.status).toBe(503)
    })

    it('returns 503 when webhook URL is placeholder', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { webhook_url: 'YOUR_WEBHOOK_URL_PLACEHOLDER', enabled: true },
          error: null
        })
      })

      const request = createRequest({
        type: 'new_member',
        data: { display_name: 'Test', guild_code: 'TEST' }
      })
      const response = await POST(request)

      expect(response.status).toBe(503)
    })

    it('falls back to event_notification webhook type', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          callCount++
          if (callCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: null, error: null })
            }
          }
          if (callCount === 2) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  webhook_url:
                    'https://discord.com/api/webhooks/fallback/token',
                  enabled: true
                },
                error: null
              })
            }
          }
          return {
            update: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ error: null })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = createRequest({
        type: 'new_member',
        data: { display_name: 'Test', guild_code: 'TEST' }
      })
      const response = await POST(request)

      expect(response.status).toBe(200)
      expect(mockFetch).toHaveBeenCalled()
    })
  })

  describe('new_member event', () => {
    it('sends new member notification successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
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
        type: 'new_member',
        data: {
          display_name: 'TestPlayer',
          guild_code: 'TEST',
          joined_at: new Date().toISOString()
        }
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123/token',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('New Member Joined')
        })
      )
    })
  })

  describe('season_summary event', () => {
    it('sends season summary notification successfully', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
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
        type: 'season_summary',
        data: {
          season: '83',
          stats: {
            total_damage: 1000000,
            total_battles: 500,
            active_players: 30,
            bosses_defeated: 10,
            avg_damage: 2000,
            top_performer: 'TopPlayer'
          }
        }
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.success).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('Season 83 Summary')
        })
      )
    })
  })

  describe('technical_summary event', () => {
    it('sends technical summary with success status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
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
        type: 'technical_summary',
        data: {
          type: 'sync',
          status: 'success',
          details: 'Sync completed successfully',
          metrics: { guilds_synced: 10, duration_ms: 5000 }
        }
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.success).toBe(true)
    })

    it('sends technical summary with error status', async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
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
        type: 'technical_summary',
        data: {
          type: 'backup',
          status: 'error',
          details: 'Backup failed due to timeout'
        }
      })
      const response = await POST(request)

      expect(response.status).toBe(200)
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

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'webhook_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  webhook_url: 'https://discord.com/api/webhooks/123/token',
                  enabled: true
                },
                error: null
              })
            }
          }
          return { select: vi.fn().mockReturnThis() }
        })

        const request = createRequest({
          type: 'new_member',
          data: { display_name: 'Test', guild_code: 'TEST' }
        })
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

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://discord.com/api/webhooks/123/token',
                enabled: true
              },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = createRequest({
        type: 'new_member',
        data: { display_name: 'Test', guild_code: 'TEST' }
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('handles 401/403 authentication failure', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized')
      })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://discord.com/api/webhooks/123/token',
                enabled: true
              },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = createRequest({
        type: 'new_member',
        data: { display_name: 'Test', guild_code: 'TEST' }
      })
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

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://discord.com/api/webhooks/123/token',
                enabled: true
              },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = createRequest({
        type: 'new_member',
        data: { display_name: 'Test', guild_code: 'TEST' }
      })
      const response = await POST(request)

      expect(response.status).toBe(429)
    })

    it('handles 400 invalid message format', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(JSON.stringify({ message: 'Invalid Form Body' }))
      })
      vi.stubGlobal('fetch', mockFetch)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://discord.com/api/webhooks/123/token',
                enabled: true
              },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = createRequest({
        type: 'new_member',
        data: { display_name: 'Test', guild_code: 'TEST' }
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('error handling', () => {
    it('handles unexpected errors gracefully', async () => {
      mockCreateServiceClient.mockImplementation(() => {
        throw new Error('Database connection failed')
      })

      const request = createRequest({
        type: 'new_member',
        data: { display_name: 'Test', guild_code: 'TEST' }
      })
      const response = await POST(request)

      expect(response.status).toBe(500)
    })
  })
})
