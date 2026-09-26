import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

let mockRunAllHealthChecks: ReturnType<typeof vi.fn>

describe('GET /api/health/detailed', () => {
  const HEALTH_CHECK_SECRET = 'test-secret-123'
  let GET: (request: NextRequest) => Promise<NextResponse>
  const originalEnv = process.env.HEALTH_CHECK_SECRET

  const makeRequest = (
    authorization: string | null = `Bearer ${HEALTH_CHECK_SECRET}`
  ) =>
    new NextRequest('http://localhost/api/health/detailed', {
      headers: authorization === null ? undefined : { authorization }
    })

  beforeEach(async () => {
    vi.resetModules()
    process.env.HEALTH_CHECK_SECRET = HEALTH_CHECK_SECRET

    mockRunAllHealthChecks = vi.fn()

    vi.doMock('@/app/lib/health', () => ({
      runAllHealthChecks: mockRunAllHealthChecks
    }))

    const routeModule = await import('@/app/api/health/detailed/route')
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
      expect(mockRunAllHealthChecks).not.toHaveBeenCalled()
    })

    it('returns 401 when HEALTH_CHECK_SECRET is set and no auth header', async () => {
      process.env.HEALTH_CHECK_SECRET = HEALTH_CHECK_SECRET

      vi.resetModules()
      vi.doMock('@/app/lib/health', () => ({
        runAllHealthChecks: mockRunAllHealthChecks
      }))
      const routeModule = await import('@/app/api/health/detailed/route')
      GET = routeModule.GET

      const request = makeRequest(null)
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Unauthorized')
    })

    it('returns 401 when auth header is invalid', async () => {
      process.env.HEALTH_CHECK_SECRET = HEALTH_CHECK_SECRET

      vi.resetModules()
      vi.doMock('@/app/lib/health', () => ({
        runAllHealthChecks: mockRunAllHealthChecks
      }))
      const routeModule = await import('@/app/api/health/detailed/route')
      GET = routeModule.GET

      const request = makeRequest('Bearer wrong-secret')
      const response = await GET(request)

      expect(response.status).toBe(401)
    })

    it('allows access with correct auth header', async () => {
      process.env.HEALTH_CHECK_SECRET = HEALTH_CHECK_SECRET

      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: true,
          externalApisHealthy: true,
          dataIntegrityIssues: false,
          syncFailureRate: 0,
          sslCertificateValid: true,
          dockerUnhealthyContainers: 0,
          backupHealthy: true,
          securityAlerts: false
        },
        infrastructure: {},
        externalApis: {},
        dataIntegrity: {},
        system: {},
        sync: {},
        docker: {},
        realtime: {},
        backup: {},
        admin: {}
      })

      vi.resetModules()
      vi.doMock('@/app/lib/health', () => ({
        runAllHealthChecks: mockRunAllHealthChecks
      }))
      const routeModule = await import('@/app/api/health/detailed/route')
      GET = routeModule.GET

      const request = makeRequest()
      const response = await GET(request)

      expect(response.status).toBe(200)
    })
  })

  describe('health status determination', () => {
    it('returns healthy status when all checks pass', async () => {
      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: true,
          externalApisHealthy: true,
          dataIntegrityIssues: false,
          syncFailureRate: 5,
          sslCertificateValid: true,
          dockerUnhealthyContainers: 0,
          backupHealthy: true,
          securityAlerts: false
        },
        infrastructure: { database: 'ok' },
        externalApis: { loki: 'ok' },
        dataIntegrity: {},
        system: {},
        sync: {},
        docker: {},
        realtime: {},
        backup: {},
        admin: {}
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('healthy')
      expect(body.timestamp).toBeDefined()
      expect(body.responseTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('returns unhealthy status when infrastructure is down', async () => {
      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: false,
          externalApisHealthy: true,
          dataIntegrityIssues: false,
          syncFailureRate: 0,
          sslCertificateValid: true,
          dockerUnhealthyContainers: 0,
          backupHealthy: true,
          securityAlerts: false
        },
        infrastructure: { database: 'down' },
        externalApis: {},
        dataIntegrity: {},
        system: {},
        sync: {},
        docker: {},
        realtime: {},
        backup: {},
        admin: {}
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error.metadata.status).toBe('unhealthy')
    })

    it('returns unhealthy status when external APIs are down', async () => {
      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: true,
          externalApisHealthy: false,
          dataIntegrityIssues: false,
          syncFailureRate: 0,
          sslCertificateValid: true,
          dockerUnhealthyContainers: 0,
          backupHealthy: true,
          securityAlerts: false
        },
        infrastructure: {},
        externalApis: { loki: 'down' },
        dataIntegrity: {},
        system: {},
        sync: {},
        docker: {},
        realtime: {},
        backup: {},
        admin: {}
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error.metadata.status).toBe('unhealthy')
    })

    it('returns degraded status when data integrity issues exist', async () => {
      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: true,
          externalApisHealthy: true,
          dataIntegrityIssues: true,
          syncFailureRate: 5,
          sslCertificateValid: true,
          dockerUnhealthyContainers: 0,
          backupHealthy: true,
          securityAlerts: false
        },
        infrastructure: {},
        externalApis: {},
        dataIntegrity: { orphanedPlayers: 5 },
        system: {},
        sync: {},
        docker: {},
        realtime: {},
        backup: {},
        admin: {}
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns degraded status when sync failure rate is high', async () => {
      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: true,
          externalApisHealthy: true,
          dataIntegrityIssues: false,
          syncFailureRate: 25,
          sslCertificateValid: true,
          dockerUnhealthyContainers: 0,
          backupHealthy: true,
          securityAlerts: false
        },
        infrastructure: {},
        externalApis: {},
        dataIntegrity: {},
        system: {},
        sync: { failingGuilds: 10 },
        docker: {},
        realtime: {},
        backup: {},
        admin: {}
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns degraded status when SSL certificate is invalid', async () => {
      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: true,
          externalApisHealthy: true,
          dataIntegrityIssues: false,
          syncFailureRate: 0,
          sslCertificateValid: false,
          dockerUnhealthyContainers: 0,
          backupHealthy: true,
          securityAlerts: false
        },
        infrastructure: {},
        externalApis: {},
        dataIntegrity: {},
        system: {},
        sync: {},
        docker: {},
        realtime: {},
        backup: {},
        admin: {}
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns degraded status when docker containers are unhealthy', async () => {
      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: true,
          externalApisHealthy: true,
          dataIntegrityIssues: false,
          syncFailureRate: 0,
          sslCertificateValid: true,
          dockerUnhealthyContainers: 2,
          backupHealthy: true,
          securityAlerts: false
        },
        infrastructure: {},
        externalApis: {},
        dataIntegrity: {},
        system: {},
        sync: {},
        docker: { unhealthy: ['container1', 'container2'] },
        realtime: {},
        backup: {},
        admin: {}
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns degraded status when backup is unhealthy', async () => {
      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: true,
          externalApisHealthy: true,
          dataIntegrityIssues: false,
          syncFailureRate: 0,
          sslCertificateValid: true,
          dockerUnhealthyContainers: 0,
          backupHealthy: false,
          securityAlerts: false
        },
        infrastructure: {},
        externalApis: {},
        dataIntegrity: {},
        system: {},
        sync: {},
        docker: {},
        realtime: {},
        backup: { lastBackup: null },
        admin: {}
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })

    it('returns degraded status when security alerts exist', async () => {
      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: true,
          externalApisHealthy: true,
          dataIntegrityIssues: false,
          syncFailureRate: 0,
          sslCertificateValid: true,
          dockerUnhealthyContainers: 0,
          backupHealthy: true,
          securityAlerts: true
        },
        infrastructure: {},
        externalApis: {},
        dataIntegrity: {},
        system: {},
        sync: {},
        docker: {},
        realtime: {},
        backup: {},
        admin: { securityAlerts: ['suspicious login'] }
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.status).toBe('degraded')
    })
  })

  describe('response structure', () => {
    it('includes all detail sections in response', async () => {
      mockRunAllHealthChecks.mockResolvedValue({
        summary: {
          infrastructureHealthy: true,
          externalApisHealthy: true,
          dataIntegrityIssues: false,
          syncFailureRate: 0,
          sslCertificateValid: true,
          dockerUnhealthyContainers: 0,
          backupHealthy: true,
          securityAlerts: false
        },
        infrastructure: { database: 'connected' },
        externalApis: { loki: 'available' },
        dataIntegrity: { orphanedPlayers: 0 },
        system: { memory: '512MB' },
        sync: { lastSync: '2026-01-11' },
        docker: { containers: 5 },
        realtime: { connections: 10 },
        backup: { lastBackup: '2026-01-10' },
        admin: { pendingTasks: 0 }
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(body.details).toBeDefined()
      expect(body.details.infrastructure).toEqual({ database: 'connected' })
      expect(body.details.externalApis).toEqual({ loki: 'available' })
      expect(body.details.dataIntegrity).toEqual({ orphanedPlayers: 0 })
      expect(body.details.system).toEqual({ memory: '512MB' })
      expect(body.details.sync).toEqual({ lastSync: '2026-01-11' })
      expect(body.details.docker).toEqual({ containers: 5 })
      expect(body.details.realtime).toEqual({ connections: 10 })
      expect(body.details.backup).toEqual({ lastBackup: '2026-01-10' })
      expect(body.details.admin).toEqual({ pendingTasks: 0 })
    })

    it('includes summary in response', async () => {
      const mockSummary = {
        infrastructureHealthy: true,
        externalApisHealthy: true,
        dataIntegrityIssues: false,
        syncFailureRate: 2.5,
        sslCertificateValid: true,
        dockerUnhealthyContainers: 0,
        backupHealthy: true,
        securityAlerts: false
      }

      mockRunAllHealthChecks.mockResolvedValue({
        summary: mockSummary,
        infrastructure: {},
        externalApis: {},
        dataIntegrity: {},
        system: {},
        sync: {},
        docker: {},
        realtime: {},
        backup: {},
        admin: {}
      })

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(body.summary).toEqual(mockSummary)
    })
  })

  describe('error handling', () => {
    it('returns 503 with error message when health check throws Error', async () => {
      mockRunAllHealthChecks.mockRejectedValue(
        new Error('Database connection failed')
      )

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error.message).toBe('Database connection failed')
      expect(body.error.metadata.responseTimeMs).toBeGreaterThanOrEqual(0)
    })

    it('returns generic error for non-Error exceptions', async () => {
      mockRunAllHealthChecks.mockRejectedValue('String error')

      const request = makeRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error.message).toBe('Health check failed')
    })
  })
})
