import { NextRequest, NextResponse } from 'next/server'
import {
  runExternalApiHealthChecks,
  getExternalApiHealthSummary
} from '@/app/lib/health'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireBearerSecret } from '@/app/lib/auth/require-header-secret'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withErrorHandler(
  async (request: NextRequest): Promise<NextResponse> => {
    requireBearerSecret(request, {
      secret: process.env.HEALTH_CHECK_SECRET,
      envVarName: 'HEALTH_CHECK_SECRET',
      endpoint: '/api/health/external-apis'
    })

    const startTime = Date.now()

    try {
      const results = await runExternalApiHealthChecks({ emitAlerts: false })
      const summary = getExternalApiHealthSummary(results)
      const responseTime = Date.now() - startTime

      return NextResponse.json(
        {
          status: summary.allHealthy ? 'healthy' : 'degraded',
          timestamp: new Date().toISOString(),
          responseTimeMs: responseTime,
          summary: {
            allHealthy: summary.allHealthy,
            unhealthyApis: summary.unhealthyApis,
            totalResponseTimeMs: summary.totalResponseTimeMs
          },
          apis: {
            tacticus: results.tacticus,
            discord: results.discord,
            resend: results.resend,
            loki: results.loki
          }
        },
        {
          status: summary.allHealthy ? 200 : 200 // Don't return 503 for external API issues
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
