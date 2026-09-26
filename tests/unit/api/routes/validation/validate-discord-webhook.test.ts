import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>

describe('POST /api/validate-discord-webhook', () => {
  let POST: (req: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    mockApiSecurityMiddleware = vi.fn()

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockApiSecurityMiddleware.mockResolvedValue(null)

    const routeModule = await import('@/app/api/validate-discord-webhook/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  const createRequest = (body: object) => {
    const req = new NextRequest(
      'http://localhost/api/validate-discord-webhook',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
    return req
  }

  describe('authentication', () => {
    it('returns auth error when not authenticated', async () => {
      mockApiSecurityMiddleware.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      )

      const request = createRequest({
        webhookUrl: 'https://discord.com/api/webhooks/123/token'
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('returns 403 when user lacks required role', async () => {
      mockApiSecurityMiddleware.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
      )

      const request = createRequest({
        webhookUrl: 'https://discord.com/api/webhooks/123/token'
      })
      const response = await POST(request)

      expect(response.status).toBe(403)
    })
  })

  describe('validation', () => {
    it('returns invalid when webhookUrl is missing', async () => {
      const request = createRequest({})
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(false)
      expect(body.error).toBe('Webhook URL is required.')
    })

    it('returns invalid for non-Discord URLs', async () => {
      const request = createRequest({
        webhookUrl: 'https://example.com/webhook'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(false)
      expect(body.error).toBe('URL must be a Discord webhook URL.')
      expect(body.hint).toContain('api/webhooks')
    })

    it('returns invalid for malformed Discord URLs', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        webhookUrl: 'https://discord.com/api/webhooks/invalid'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(false)
      expect(body.error).toBe('URL must be a Discord webhook URL.')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns invalid for webhook URLs with credentials or non-default ports', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      for (const webhookUrl of [
        'https://user:pass@discord.com/api/webhooks/123/token', // trufflehog:ignore -- rejected-URL fixture
        'https://discord.com:444/api/webhooks/123/token'
      ]) {
        const request = createRequest({ webhookUrl })
        const response = await POST(request)
        const body = await response.json()

        expect(body.valid).toBe(false)
        expect(body.error).toBe('URL must be a Discord webhook URL.')
      }

      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('returns the shared channel-url hint for Discord channel links', async () => {
      const mockFetch = vi.fn()
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        webhookUrl:
          'https://discord.com/channels/100000000000000001/200000000000000002'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(false)
      expect(body.error).toContain('CHANNEL URL')
      expect(body.hint).toContain('Edit Channel')
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('Discord webhook verification', () => {
    it('returns valid with webhook info on successful verification', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            channel_id: '123456789',
            guild_id: '987654321',
            name: 'My Webhook'
          })
      })
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        webhookUrl: 'https://discord.com/api/webhooks/123/token123'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(true)
      expect(body.channel_id).toBe('123456789')
      expect(body.guild_id).toBe('987654321')
      expect(body.name).toBe('My Webhook')
    })

    it('accepts supported non-canonical Discord webhook hosts via the shared validator', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            channel_id: '123456789',
            guild_id: '987654321',
            name: 'PTB Webhook'
          })
      })
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        webhookUrl: ' https://ptb.discord.com/api/webhooks/123/token123 '
      })
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(true)
      expect(body.name).toBe('PTB Webhook')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://ptb.discord.com/api/webhooks/123/token123',
        expect.objectContaining({ method: 'GET' })
      )
    })

    it('returns invalid for 401 response (unauthorized webhook)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 401
      })
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        webhookUrl: 'https://discord.com/api/webhooks/123/badtoken'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(false)
      expect(body.error).toBe('Invalid or deleted webhook')
    })

    it('returns invalid for 404 response (deleted webhook)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404
      })
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        webhookUrl: 'https://discord.com/api/webhooks/123/token'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(false)
      expect(body.error).toBe('Invalid or deleted webhook')
    })

    it('returns invalid for other error responses', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500
      })
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        webhookUrl: 'https://discord.com/api/webhooks/123/token'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(false)
      expect(body.error).toBe('Failed to validate webhook')
    })

    it('handles network errors when connecting to Discord', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error('Network timeout'))
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        webhookUrl: 'https://discord.com/api/webhooks/123/token'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(false)
      expect(body.error).toBe('Failed to connect to Discord')
    })
  })

  describe('error handling', () => {
    it('handles JSON parse errors', async () => {
      const request = new NextRequest(
        'http://localhost/api/validate-discord-webhook',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'invalid-json'
        }
      )
      const response = await POST(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('Internal server error')
    })
  })

  describe('rate limiting headers', () => {
    it('attaches rate limit headers from request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ channel_id: '123', guild_id: '456', name: 'Test' })
      })
      vi.stubGlobal('fetch', mockFetch)

      const request = createRequest({
        webhookUrl: 'https://discord.com/api/webhooks/123/token'
      })
      ;(request as any).rateLimitHeaders = {
        'X-RateLimit-Limit': '10',
        'X-RateLimit-Remaining': '9'
      }

      const response = await POST(request)

      expect(response.headers.get('X-RateLimit-Limit')).toBe('10')
      expect(response.headers.get('X-RateLimit-Remaining')).toBe('9')
    })
  })
})
