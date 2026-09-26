import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockTacticusAPI: { getPlayer: ReturnType<typeof vi.fn> }
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>

describe('/api/onboarding/validate-player-key', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockTacticusAPI = {
      getPlayer: vi.fn()
    }
    mockApiSecurityMiddleware = vi.fn().mockResolvedValue(null)

    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: mockTacticusAPI
    }))
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

    const routeModule =
      await import('@/app/api/onboarding/validate-player-key/route')
    POST = routeModule.POST
  })

  describe('POST /api/onboarding/validate-player-key', () => {
    it('short-circuits when public rate limiting rejects the request', async () => {
      mockApiSecurityMiddleware.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429
        })
      )

      const request = new NextRequest(
        'http://localhost/api/onboarding/validate-player-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: 'valid-key' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(429)
      expect(mockApiSecurityMiddleware).toHaveBeenCalledWith(request, {
        requireAuth: false,
        skipSecurityChecks: true
      })
      expect(mockTacticusAPI.getPlayer).not.toHaveBeenCalled()
    })

    it('returns 400 when apiKey is missing', async () => {
      const request = new NextRequest(
        'http://localhost/api/onboarding/validate-player-key',
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
      expect(body.error.message).toBe('Player API key is required')
    })

    it('returns 400 when apiKey is empty string', async () => {
      const request = new NextRequest(
        'http://localhost/api/onboarding/validate-player-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: '' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.message).toBe('Player API key is required')
    })

    it('returns 400 when apiKey is whitespace only', async () => {
      const request = new NextRequest(
        'http://localhost/api/onboarding/validate-player-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: '   ' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.message).toBe('Player API key is required')
    })

    it('returns 400 when Tacticus API returns null', async () => {
      mockTacticusAPI.getPlayer.mockResolvedValue(null)

      const request = new NextRequest(
        'http://localhost/api/onboarding/validate-player-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: 'invalid' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain('Invalid API key')
    })

    it('returns player data when API key is valid', async () => {
      mockTacticusAPI.getPlayer.mockResolvedValue({
        details: {
          name: 'TestPlayer',
          powerLevel: 12500
        }
      })

      const request = new NextRequest(
        'http://localhost/api/onboarding/validate-player-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: 'valid-api-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.playerName).toBe('TestPlayer')
      expect(body.powerLevel).toBe(12500)
    })

    it('trims whitespace from apiKey before validation', async () => {
      mockTacticusAPI.getPlayer.mockResolvedValue({
        details: { name: 'Test', powerLevel: 1000 }
      })

      const request = new NextRequest(
        'http://localhost/api/onboarding/validate-player-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: '  trimmed-key  ' })
        }
      )

      await POST(request)

      expect(mockTacticusAPI.getPlayer).toHaveBeenCalledWith('trimmed-key')
    })

    it('handles player with missing details gracefully', async () => {
      mockTacticusAPI.getPlayer.mockResolvedValue({
        details: null
      })

      const request = new NextRequest(
        'http://localhost/api/onboarding/validate-player-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: 'valid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.playerName).toBe('Unknown')
      expect(body.powerLevel).toBe(0)
    })

    it('returns 500 when Tacticus API throws exception', async () => {
      mockTacticusAPI.getPlayer.mockRejectedValue(new Error('Network error'))

      const request = new NextRequest(
        'http://localhost/api/onboarding/validate-player-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey: 'valid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain('Failed to validate')
    })

    it('returns 500 for invalid JSON body', async () => {
      const request = new NextRequest(
        'http://localhost/api/onboarding/validate-player-key',
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
