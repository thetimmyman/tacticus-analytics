import { NextRequest, NextResponse } from 'next/server'
import { runAllHealthChecks } from '@/app/lib/health'
import { safeEqual } from '@/app/lib/auth/require-header-secret'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

/** Requires the HEALTH_CHECK_SECRET bearer. */
export const GET = withErrorHandler(
  async (request: NextRequest): Promise<Response> => {
    const healthSecret = process.env.HEALTH_CHECK_SECRET
    if (!healthSecret) {
      throw Errors.internal('HEALTH_CHECK_SECRET not configured')
    }
    const authHeader = request.headers.get('authorization')
    if (!authHeader || !safeEqual(authHeader, `Bearer ${healthSecret}`)) {
      throw Errors.unauthorized('Unauthorized')
    }

    const startTime = Date.now()

    try {
      const healthResults = await runAllHealthChecks({ emitAlerts: false })
      const responseTime = Date.now() - startTime

      const { summary } = healthResults
      let overallStatus: 'healthy' | 'degraded' | 'unhealthy' = 'healthy'

      if (!summary.infrastructureHealthy || !summary.externalApisHealthy) {
        overallStatus = 'unhealthy'
      } else if (
        summary.dataIntegrityIssues ||
        summary.syncFailureRate > 20 ||
        !summary.sslCertificateValid ||
        summary.dockerUnhealthyContainers > 0 ||
        !summary.backupHealthy ||
        summary.securityAlerts
      ) {
        overallStatus = 'degraded'
      }

      return NextResponse.json(
        {
          status: overallStatus,
          timestamp: new Date().toISOString(),
          responseTimeMs: responseTime,
          summary: healthResults.summary,
          details: {
            infrastructure: healthResults.infrastructure,
            externalApis: healthResults.externalApis,
            dataIntegrity: healthResults.dataIntegrity,
            system: healthResults.system,
            sync: healthResults.sync,
            docker: healthResults.docker,
            realtime: healthResults.realtime,
            backup: healthResults.backup,
            admin: healthResults.admin
          }
        },
        {
          status: overallStatus === 'unhealthy' ? 503 : 200
        }
      )
    } catch (error) {
      rethrowIfAppError(error)
      throw Errors.external(
        error instanceof Error ? error.message : 'Health check failed',
        503,
        { responseTimeMs: Date.now() - startTime }
      )
    }
  }
)
