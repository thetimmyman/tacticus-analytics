import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

let mockRunInfrastructureHealthChecks: ReturnType<typeof vi.fn>
let mockRunSystemHealthChecks: ReturnType<typeof vi.fn>
let mockRunDockerHealthChecks: ReturnType<typeof vi.fn>

describe('GET /api/health/infrastructure', () => {
  const HEALTH_CHECK_SECRET = 'test-secret-123'
  let GET: (request: NextRequest) => Promise<NextResponse>
  const originalEnv = process.env.HEALTH_CHECK_SECRET

  const makeRequest = (
    authorization: string | null = `Bearer ${HEALTH_CHECK_SECRET}`
  ) =>
    new NextRequest('http://localhost/api/health/infrastructure', {
      headers: authorization === null ? undefined : { authorization }
    })

  beforeEach(async () => {
    vi.resetModules()
    process.env.HEALTH_CHECK_SECRET = HEALTH_CHECK_SECRET

    mockRunInfrastructureHealthChecks = vi.fn()
    mockRunSystemHealthChecks = vi.fn()
    mockRunDockerHealthChecks = vi.fn()

    vi.doMock('@/app/lib/health', () => ({
      runInfrastructureHealthChecks: mockRunInfrastructureHealthChecks,
      runSystemHealthChecks: mockRunSystemHealthChecks,
      runDockerHealthChecks: mockRunDockerHealthChecks
    }))

    const routeModule = await import('@/app/api/health/infrastructure/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    if (originalEnv) {
      process.env.HEALTH_CHECK_SECRET = originalEnv
    } else {
      delete process.env.HEALTH_CHECK_SECRET
    }
  })

  describe('authentication', () => {
    it('returns 500 when HEALTH_CHECK_SECRET is not configured', async () => {
      delete process.env.HEALTH_CHECK_SECRET

      const request = makeRequest(null)
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('HEALTH_CHECK_SECRET not configured')
      expect(mockRunInfrastructureHealthChecks).not.toHaveBeenCalled()
    })

    it('returns 401 when no auth header is present', async () => {
      const request = makeRequest(null)
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Unauthorized')
      expect(mockRunInfrastructureHealthChecks).not.toHaveBeenCalled()
    })

    it('returns 401 when auth header is invalid', async () => {
      const request = makeRequest('Bearer wrong-secret')
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Unauthorized')
      expect(mockRunInfrastructureHealthChecks).not.toHaveBeenCalled()
    })

    it('allows access with correct auth header', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())

      expect(response.status).toBe(200)
      expect(mockRunInfrastructureHealthChecks).toHaveBeenCalled()
    })
  })

  describe('healthy responses', () => {
    it('returns healthy status when all checks pass', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true, responseTimeMs: 15 },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true, freeGb: 50 },
        sslCertificate: { valid: true, expiresIn: 60 }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0,
        containers: []
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(mockRunInfrastructureHealthChecks).toHaveBeenCalledWith({
        emitAlerts: false
      })
      expect(mockRunSystemHealthChecks).toHaveBeenCalledWith({
        emitAlerts: false
      })
      expect(mockRunDockerHealthChecks).toHaveBeenCalledWith({
        emitAlerts: false
      })
      expect(body.status).toBe('healthy')
      expect(body.timestamp).toBeDefined()
      expect(body.responseTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('includes memory status in response', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(body.memory).toBeDefined()
      expect(body.memory.checked).toBe(true)
    })

    it('includes database connectivity in response', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true, responseTimeMs: 25 },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(body.database).toBeDefined()
      expect(body.database.connected).toBe(true)
      expect(body.database.responseTimeMs).toBe(25)
    })

    it('includes uptime information', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(body.uptime).toBeDefined()
      expect(body.uptime.checked).toBe(true)
      expect(body.uptime.uptimeSeconds).toBeGreaterThanOrEqual(0)
    })

    it('includes environment status', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(body.environment).toBeDefined()
      expect(body.environment.checked).toBe(true)
    })
  })

  describe('degraded responses', () => {
    it('returns degraded when memory check fails', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: false,
        database: { connected: true },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns degraded when database is disconnected', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: false, error: 'Connection timeout' },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns degraded when environment check fails', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true },
        uptime: true,
        environment: false
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns degraded when SSL certificate is invalid', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: false, error: 'Certificate expired' }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns degraded when docker containers are unhealthy', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 2,
        containers: ['container1', 'container2']
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })
  })

  describe('response structure', () => {
    it('includes disk space information', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true, freeGb: 75.5, usedPercent: 45 },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(body.diskSpace).toBeDefined()
      expect(body.diskSpace.available).toBe(true)
      expect(body.diskSpace.freeGb).toBe(75.5)
    })

    it('includes SSL certificate information', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true, expiresIn: 30, domain: 'example.com' }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(body.sslCertificate).toBeDefined()
      expect(body.sslCertificate.valid).toBe(true)
      expect(body.sslCertificate.expiresIn).toBe(30)
    })

    it('includes docker status', async () => {
      mockRunInfrastructureHealthChecks.mockResolvedValue({
        memory: true,
        database: { connected: true },
        uptime: true,
        environment: true
      })
      mockRunSystemHealthChecks.mockResolvedValue({
        diskSpace: { available: true },
        sslCertificate: { valid: true }
      })
      mockRunDockerHealthChecks.mockResolvedValue({
        running: true,
        unhealthyCount: 0,
        containers: ['app', 'db', 'redis']
      })

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(body.docker).toBeDefined()
      expect(body.docker.running).toBe(true)
      expect(body.docker.unhealthyCount).toBe(0)
    })
  })

  describe('error handling', () => {
    it('returns 500 with error message when check throws Error', async () => {
      mockRunInfrastructureHealthChecks.mockRejectedValue(
        new Error('Database unreachable')
      )

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.metadata.status).toBe('error')
      expect(body.error.message).toBe('Database unreachable')
      expect(body.error.metadata.timestamp).toBeDefined()
    })

    it('returns generic error for non-Error exceptions', async () => {
      mockRunInfrastructureHealthChecks.mockRejectedValue('Unknown failure')

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.metadata.status).toBe('error')
      expect(body.error.message).toBe('Health check failed')
    })

    it('includes response time even in error response', async () => {
      mockRunInfrastructureHealthChecks.mockRejectedValue(new Error('Failed'))

      const response = await GET(makeRequest())
      const body = await response.json()

      expect(body.error.metadata.responseTimeMs).toBeGreaterThanOrEqual(0)
    })
  })
})
