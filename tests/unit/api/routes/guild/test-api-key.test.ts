import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { SERVICE_TIMEOUTS } from '@/app/lib/utils/async-timeout'

let mockFetch: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>

describe('POST /api/guild/test-api-key', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockFetch = vi.fn()
    mockApiSecurityMiddleware = vi.fn().mockResolvedValue(null)
    vi.stubGlobal('fetch', mockFetch)

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    vi.doMock(
      '@tacticus/app-core/logging-sanitizer',
      async (importOriginal) => ({
        ...(await importOriginal<
          typeof import('@tacticus/app-core/logging-sanitizer')
        >()),
        sanitizeErrorForLog: vi.fn((e) => e),
        maskSensitive: vi.fn((s) => s)
      })
    )

    vi.doMock('@tacticus/app-core/app-config', () => ({
      TACTICUS_API: { BASE_URL: 'https://api.tacticusgame.com' }
    }))

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))

    const routeModule = await import('@/app/api/guild/test-api-key/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  function mockHungFetch() {
    let abortCount = 0

    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      if (!String(_url).endsWith('/guild')) {
        return Promise.resolve({
          ok: false,
          status: 404,
          text: async () => 'Not found'
        } as Response)
      }

      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => {
            abortCount += 1
            const abortError = new Error('Request timed out')
            abortError.name = 'AbortError'
            reject(abortError)
          },
          { once: true }
        )
      })
    })

    return {
      abortCount: () => abortCount
    }
  }

  async function advancePastFirstRetryTimeout() {
    await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)
    await vi.advanceTimersByTimeAsync(1000 + SERVICE_TIMEOUTS.EXTERNAL_API)
  }

  describe('security', () => {
    it('short-circuits when public rate limiting rejects the request', async () => {
      mockApiSecurityMiddleware.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429
        })
      )

      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'valid-api-key-with-enough-length' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(429)
      expect(mockApiSecurityMiddleware).toHaveBeenCalledWith(request, {
        requireAuth: false,
        skipSecurityChecks: true
      })
      expect(mockFetch).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('returns 400 when request body is invalid JSON', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'invalid json'
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.message).toBe('Invalid request format')
    })

    it('returns 400 when api_key is missing', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.message).toBe('Missing api_key')
    })

    it('returns 400 when api_key is not a string', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 12345 })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid api_key format')
    })

    it('returns 400 when api_key is too short', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'short' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid api_key length')
    })

    it('returns 400 when api_key is too long', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'a'.repeat(101) })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid api_key length')
    })
  })

  describe('API key testing', () => {
    const validApiKey = 'valid-api-key-with-enough-length'

    it('returns success when all endpoints respond successfully', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            guild: {
              guildId: 'guild-123',
              name: 'Test Guild',
              guildCode: 'TEST'
            },
            user: { role: 'leader' }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            entries: [{ id: '1', type: 'raid', season: 'season-42' }]
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            members: [{ id: 'member-1', isCurrentUser: true, role: 'leader' }]
          })
        })

      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: validApiKey })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.metrics.apiKeyValid).toBe(true)
      expect(body.metrics.canAccessGuildData).toBe(true)
      expect(body.metrics.canAccessRaidData).toBe(true)
    })

    it('returns failure when guild endpoint returns 401', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'Unauthorized'
      })

      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: validApiKey })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.metrics.apiKeyValid).toBe(false)
      expect(body.tests.guild.error).toContain('Authentication failed')
    })

    it('returns failure when guild endpoint returns 403', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        text: async () => 'Forbidden'
      })

      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: validApiKey })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(body.metrics.apiKeyValid).toBe(true)
      expect(body.tests.guild.error).toContain('Access denied')
    })

    it('handles raid endpoint returning 404 (no active raid)', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ guild: { guildId: 'guild-123' } })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 404,
          text: async () => 'Not found'
        })

      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: validApiKey })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(body.tests.guildRaid.error).toContain('No active raid')
    })

    it('detects leader key from user role', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            guild: { guildId: 'guild-123', guildCode: 'TEST' },
            user: { role: 'leader' }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ entries: [] })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ members: [] })
        })

      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: validApiKey })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(body.metrics.isLeaderKey).toBe(true)
    })

    it('returns autoDiscovered guild info', async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            guild: {
              guildId: 'guild-123',
              name: 'Test Guild',
              guildCode: 'TGLD'
            }
          })
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ entries: [], season: 'season-42' })
        })

      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: validApiKey })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(body.autoDiscovered.guildId).toBe('guild-123')
      expect(body.autoDiscovered.guildName).toBe('Test Guild')
      expect(body.autoDiscovered.guildCode).toBe('TGLD')
      expect(body.autoDiscovered.season).toBe('season-42')
    })
  })

  describe('error handling', () => {
    const validApiKey = 'valid-api-key-with-enough-length'

    it('handles network errors gracefully', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('fetch failed: Network error'))
        .mockRejectedValueOnce(new Error('fetch failed: Network error'))
        .mockRejectedValueOnce(new Error('fetch failed: Network error'))
        .mockRejectedValueOnce(new Error('fetch failed: Network error'))

      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: validApiKey })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(body.tests.guild.error).toContain('Network error')
    }, 30000) // Increase timeout for retry delays

    it('handles timeout errors', async () => {
      const abortError = new Error('Request timed out')
      abortError.name = 'AbortError'
      mockFetch
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(abortError)
        .mockRejectedValueOnce(abortError)

      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: validApiKey })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(body.tests.guild.error).toContain('timed out')
      expect(body.tests.guildRaid.error).toContain('Skipped')
      expect(mockFetch).toHaveBeenCalledTimes(1)
    }, 30000) // Increase timeout for retry delays

    it('aborts hung guild endpoint requests once and skips follow-up probes', async () => {
      vi.useFakeTimers()
      const hungFetch = mockHungFetch()

      const responsePromise = POST(
        new NextRequest('http://localhost/api/guild/test-api-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: validApiKey })
        })
      )
      await Promise.resolve()

      await advancePastFirstRetryTimeout()

      expect(hungFetch.abortCount()).toBe(1)
      expect(mockFetch).toHaveBeenCalledTimes(1)
      const response = await responsePromise
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.tests.guild.error).toContain('timed out')
      expect(body.tests.guildRaid.error).toContain('Skipped')
      expect(body.summary.processingTimeMs).toBeGreaterThanOrEqual(
        SERVICE_TIMEOUTS.EXTERNAL_API
      )
    })

    it('handles rate limit (429) response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: async () => 'Too Many Requests'
      })

      const request = new NextRequest(
        'http://localhost/api/guild/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: validApiKey })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(body.tests.guild.error).toContain('Rate limit exceeded')
    })
  })
})
