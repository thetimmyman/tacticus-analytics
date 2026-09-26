import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>

describe('POST /api/player/test-api-key', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockValidateApiKeyWithTacticus = vi.fn()
    mockApiSecurityMiddleware = vi.fn().mockResolvedValue(null)

    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))

    const routeModule = await import('@/app/api/player/test-api-key/route')
    POST = routeModule.POST
  })

  describe('security', () => {
    it('short-circuits when public rate limiting rejects the request', async () => {
      mockApiSecurityMiddleware.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429
        })
      )

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'valid-api-key' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(429)
      expect(mockApiSecurityMiddleware).toHaveBeenCalledWith(request, {
        requireAuth: false,
        skipSecurityChecks: true
      })
      expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('returns 400 when api_key is missing', async () => {
      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
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
      expect(body.error.message).toContain('API key is required for valida')
    })

    it('returns 400 when api_key is empty string', async () => {
      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: '' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain('API key is required for valida')
    })

    it('returns 400 when api_key is whitespace only', async () => {
      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: '   ' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
    })

    it('trims whitespace from api_key', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        guildInfo: { guild_code: 'TEST' }
      })

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: '  valid  ' })
        }
      )

      await POST(request)

      expect(mockValidateApiKeyWithTacticus).toHaveBeenCalledWith('valid', true)
    })
  })

  describe('successful validation', () => {
    it('returns success when API key is valid', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        guildInfo: { guild_code: 'TESTGLD', guild_name: 'Test Guild' }
      })

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'valid-api-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.metrics.apiKeyValid).toBe(true)
      expect(body.metrics.canAccessGuildData).toBe(true)
      expect(body.autoDiscovered).toEqual({
        guild_code: 'TESTGLD',
        guild_name: 'Test Guild'
      })
      expect(body.summary.recommendation).toContain('validated successfully')
    })

    it('returns success with processing time', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: false,
        guildInfo: null
      })

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'valid-api-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(body.metrics.timeElapsed).toBeGreaterThanOrEqual(0)
      expect(body.summary.processingTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('handles null guildInfo gracefully', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: false,
        guildInfo: null
      })

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'valid-api-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.autoDiscovered).toEqual({})
    })
  })

  describe('validation failures', () => {
    it('returns error when API key is invalid', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'Invalid API key format',
        canAccessGuild: false,
        statusCode: 400
      })

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'invalid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.message).toBe('Invalid API key format')
    })

    it('returns 401 for unauthorized keys', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'API key expired',
        canAccessGuild: false,
        statusCode: 401
      })

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'expired-key' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('defaults to 400 when no statusCode provided', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'Unknown error',
        canAccessGuild: false
      })

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'bad-key' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('uses default error message when none provided', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        canAccessGuild: false
      })

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'bad-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(body.error.message).toContain('Player API key validation fail')
    })

    it('includes guild info even on failure', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'Rate limited',
        canAccessGuild: true,
        guildInfo: { guild_code: 'PARTIAL' },
        statusCode: 429
      })

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'rate-limited-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(429)
    })
  })

  describe('error handling', () => {
    it('returns 500 when validation throws exception', async () => {
      mockValidateApiKeyWithTacticus.mockRejectedValue(
        new Error('Network timeout')
      )

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'valid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain('Failed to validate API key. Pl')
    })

    it('handles non-Error exceptions', async () => {
      mockValidateApiKeyWithTacticus.mockRejectedValue('String error')

      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'valid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })

    it('returns 500 for invalid JSON body', async () => {
      const request = new NextRequest(
        'http://localhost/api/player/test-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not valid json'
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })
  })
})
