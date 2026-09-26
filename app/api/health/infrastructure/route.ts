import { NextRequest, NextResponse } from 'next/server'
import { runInfrastructureHealthChecks } from '@/app/lib/health'
import { runSystemHealthChecks } from '@/app/lib/health'
import { runDockerHealthChecks } from '@/app/lib/health'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { safeEqual } from '@/app/lib/auth/require-header-secret'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// Requires a HEALTH_CHECK_SECRET bearer token.
export const GET = withErrorHandler(
  async (request: NextRequest): Promise<NextResponse> => {
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
      const [infrastructure, system, docker] = await Promise.all([
        runInfrastructureHealthChecks({ emitAlerts: false }),
        runSystemHealthChecks({ emitAlerts: false }),
        runDockerHealthChecks({ emitAlerts: false })
      ])

      const responseTime = Date.now() - startTime

      const dependencyChecks = [
        infrastructure.dependencies?.nginx,
        infrastructure.dependencies?.cloudflared,
        infrastructure.dependencies?.postgrest
      ].filter(Boolean)

      const dependenciesHealthy =
        dependencyChecks.length > 0
          ? dependencyChecks.every((check) => !check?.checked || check.healthy)
          : true

      const isHealthy =
        infrastructure.memory &&
        infrastructure.database.connected &&
        infrastructure.environment &&
        dependenciesHealthy &&
        system.sslCertificate.valid &&
        docker.unhealthyCount === 0

      return NextResponse.json(
        {
          status: isHealthy ? 'healthy' : 'degraded',
          timestamp: new Date().toISOString(),
          responseTimeMs: responseTime,
          memory: {
            checked: infrastructure.memory,
            details: 'Memory thresholds within limits'
          },
          database: infrastructure.database,
          uptime: {
            checked: infrastructure.uptime,
            uptimeSeconds: process.uptime()
          },
          environment: {
            checked: infrastructure.environment,
            details: 'Environment variables validated'
          },
          dependencies: infrastructure.dependencies,
          dependenciesHealthy,
          diskSpace: system.diskSpace,
          sslCertificate: system.sslCertificate,
          docker: docker
        },
        {
          status: isHealthy ? 200 : 200 // Don't fail the endpoint for degraded status
        }
      )
    } catch (error) {
      rethrowIfAppError(error)
      throw Errors.fromResponse(500, {
        status: 'error',
        timestamp: new Date().toISOString(),
        responseTimeMs: Date.now() - startTime,
        error: error instanceof Error ? error.message : 'Health check failed'
      })
    }
  }
)
