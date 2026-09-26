import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

let mockRunExternalApiHealthChecks: ReturnType<typeof vi.fn>
let mockGetExternalApiHealthSummary: ReturnType<typeof vi.fn>

describe('GET /api/health/external-apis', () => {
  let GET: () => Promise<NextResponse>
  let rawGET: (request: NextRequest) => Promise<NextResponse>

  const makeRequest = (secret = 'test-health-secret') =>
    new NextRequest('http://localhost/api/health/external-apis', {
      headers: { authorization: `Bearer ${secret}` }
    })

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('HEALTH_CHECK_SECRET', 'test-health-secret')

    mockRunExternalApiHealthChecks = vi.fn()
    mockGetExternalApiHealthSummary = vi.fn()

    vi.doMock('@/app/lib/health', () => ({
      runExternalApiHealthChecks: mockRunExternalApiHealthChecks,
      getExternalApiHealthSummary: mockGetExternalApiHealthSummary
    }))

    const routeModule = await import('@/app/api/health/external-apis/route')
    rawGET = routeModule.GET
    GET = () => rawGET(makeRequest())
  })

  describe('authentication', () => {
    it('rejects a missing bearer secret without running probes', async () => {
      const response = await rawGET(
        new NextRequest('http://localhost/api/health/external-apis')
      )

      expect(response.status).toBe(401)
      expect(mockRunExternalApiHealthChecks).not.toHaveBeenCalled()
    })

    it('rejects an incorrect bearer secret without running probes', async () => {
      const response = await rawGET(makeRequest('wrong-secret'))

      expect(response.status).toBe(401)
      expect(mockRunExternalApiHealthChecks).not.toHaveBeenCalled()
    })

    it('fails closed when HEALTH_CHECK_SECRET is not configured', async () => {
      vi.stubEnv('HEALTH_CHECK_SECRET', '')

      const response = await rawGET(makeRequest())

      expect(response.status).toBe(500)
      expect(mockRunExternalApiHealthChecks).not.toHaveBeenCalled()
    })
  })

  describe('healthy responses', () => {
    it('returns healthy status when all external APIs are up', async () => {
      const mockResults = {
        tacticus: { healthy: true, responseTimeMs: 100 },
        discord: { healthy: true, responseTimeMs: 50 },
        resend: { healthy: true, responseTimeMs: 75 },
        loki: { healthy: true, responseTimeMs: 60 }
      }

      mockRunExternalApiHealthChecks.mockResolvedValue(mockResults)
      mockGetExternalApiHealthSummary.mockReturnValue({
        allHealthy: true,
        unhealthyApis: [],
        totalResponseTimeMs: 285
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(mockRunExternalApiHealthChecks).toHaveBeenCalledWith({
        emitAlerts: false
      })
      expect(body.status).toBe('healthy')
      expect(body.timestamp).toBeDefined()
      expect(body.responseTimeMs).toBeGreaterThanOrEqual(0)
      expect(body.summary.allHealthy).toBe(true)
      expect(body.summary.unhealthyApis).toEqual([])
    })

    it('includes all API results in response', async () => {
      const mockResults = {
        tacticus: { healthy: true, responseTimeMs: 100, message: 'OK' },
        discord: { healthy: true, responseTimeMs: 50, message: 'OK' },
        resend: { healthy: true, responseTimeMs: 75, message: 'OK' },
        loki: { healthy: true, responseTimeMs: 60, message: 'OK' }
      }

      mockRunExternalApiHealthChecks.mockResolvedValue(mockResults)
      mockGetExternalApiHealthSummary.mockReturnValue({
        allHealthy: true,
        unhealthyApis: [],
        totalResponseTimeMs: 285
      })

      const response = await GET()
      const body = await response.json()

      expect(body.apis).toBeDefined()
      expect(body.apis.tacticus).toEqual(mockResults.tacticus)
      expect(body.apis.discord).toEqual(mockResults.discord)
      expect(body.apis.resend).toEqual(mockResults.resend)
      expect(body.apis.loki).toEqual(mockResults.loki)
    })
  })

  describe('degraded responses', () => {
    it('returns degraded status when some APIs are unhealthy', async () => {
      const mockResults = {
        tacticus: {
          healthy: false,
          responseTimeMs: 0,
          error: 'Connection failed'
        },
        discord: { healthy: true, responseTimeMs: 50 },
        resend: { healthy: true, responseTimeMs: 75 },
        loki: { healthy: true, responseTimeMs: 60 }
      }

      mockRunExternalApiHealthChecks.mockResolvedValue(mockResults)
      mockGetExternalApiHealthSummary.mockReturnValue({
        allHealthy: false,
        unhealthyApis: ['tacticus'],
        totalResponseTimeMs: 185
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
      expect(body.summary.allHealthy).toBe(false)
      expect(body.summary.unhealthyApis).toContain('tacticus')
    })

    it('returns degraded when multiple APIs are down', async () => {
      const mockResults = {
        tacticus: { healthy: false, responseTimeMs: 0, error: 'Timeout' },
        discord: { healthy: false, responseTimeMs: 0, error: 'Rate limited' },
        resend: { healthy: true, responseTimeMs: 75 },
        loki: { healthy: true, responseTimeMs: 60 }
      }

      mockRunExternalApiHealthChecks.mockResolvedValue(mockResults)
      mockGetExternalApiHealthSummary.mockReturnValue({
        allHealthy: false,
        unhealthyApis: ['tacticus', 'discord'],
        totalResponseTimeMs: 135
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
      expect(body.summary.unhealthyApis).toHaveLength(2)
    })

    it('returns degraded when all APIs are down', async () => {
      const mockResults = {
        tacticus: { healthy: false, error: 'Timeout' },
        discord: { healthy: false, error: 'Service unavailable' },
        resend: { healthy: false, error: 'Connection refused' },
        loki: { healthy: false, error: 'Network error' }
      }

      mockRunExternalApiHealthChecks.mockResolvedValue(mockResults)
      mockGetExternalApiHealthSummary.mockReturnValue({
        allHealthy: false,
        unhealthyApis: ['tacticus', 'discord', 'resend', 'loki'],
        totalResponseTimeMs: 0
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
      expect(body.summary.unhealthyApis).toHaveLength(4)
    })
  })

  describe('response structure', () => {
    it('includes total response time in summary', async () => {
      mockRunExternalApiHealthChecks.mockResolvedValue({
        tacticus: { healthy: true, responseTimeMs: 150 },
        discord: { healthy: true, responseTimeMs: 200 },
        resend: { healthy: true, responseTimeMs: 100 },
        loki: { healthy: true, responseTimeMs: 50 }
      })
      mockGetExternalApiHealthSummary.mockReturnValue({
        allHealthy: true,
        unhealthyApis: [],
        totalResponseTimeMs: 500
      })

      const response = await GET()
      const body = await response.json()

      expect(body.summary.totalResponseTimeMs).toBe(500)
    })

    it('includes timestamp in response', async () => {
      mockRunExternalApiHealthChecks.mockResolvedValue({
        tacticus: { healthy: true },
        discord: { healthy: true },
        resend: { healthy: true },
        loki: { healthy: true }
      })
      mockGetExternalApiHealthSummary.mockReturnValue({
        allHealthy: true,
        unhealthyApis: [],
        totalResponseTimeMs: 0
      })

      const response = await GET()
      const body = await response.json()

      expect(body.timestamp).toBeDefined()
      expect(new Date(body.timestamp).getTime()).not.toBeNaN()
    })
  })

  describe('error handling', () => {
    it('returns 500 with error message when health check throws Error', async () => {
      mockRunExternalApiHealthChecks.mockRejectedValue(
        new Error('Network failure')
      )

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.metadata.status).toBe('error')
      expect(body.error.message).toBe('Network failure')
      expect(body.error.metadata.timestamp).toBeDefined()
    })

    it('returns generic error for non-Error exceptions', async () => {
      mockRunExternalApiHealthChecks.mockRejectedValue('String error')

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.metadata.status).toBe('error')
      expect(body.error.message).toBe('Health check failed')
    })

    it('includes response time even in error response', async () => {
      mockRunExternalApiHealthChecks.mockRejectedValue(new Error('Failed'))

      const response = await GET()
      const body = await response.json()

      expect(body.error.metadata.responseTimeMs).toBeGreaterThanOrEqual(0)
    })
  })
})
