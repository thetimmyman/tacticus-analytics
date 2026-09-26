import { NextResponse } from 'next/server'
import { runSyncHealthChecks } from '@/app/lib/health'
import { runDataIntegrityHealthChecks } from '@/app/lib/health'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { getOptionalAuthForApi } from '@/app/lib/auth'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export const GET = withErrorHandler(async (): Promise<NextResponse> => {
  const startTime = Date.now()

  // Anonymous callers get liveness only (failing guild names aid attackers). Banned sessions get none.
  const auth = await getOptionalAuthForApi()
  const isAuthenticated = Boolean(auth)

  try {
    const [sync, dataIntegrity] = await Promise.all([
      runSyncHealthChecks({ emitAlerts: false }),
      runDataIntegrityHealthChecks({ emitAlerts: false })
    ])

    const responseTime = Date.now() - startTime

    const failureRate =
      sync.totalActiveGuilds > 0
        ? (sync.failingGuilds / sync.totalActiveGuilds) * 100
        : 0

    const isHealthy =
      failureRate < 10 &&
      dataIntegrity.seasonDataIntegrity.healthy &&
      dataIntegrity.syncGaps.count === 0 &&
      dataIntegrity.excludedGuilds.count === 0

    const publicBody = {
      status: isHealthy
        ? 'healthy'
        : failureRate > 30
          ? 'unhealthy'
          : 'degraded',
      timestamp: new Date().toISOString(),
      responseTimeMs: responseTime
    }

    if (!isAuthenticated) {
      return NextResponse.json(publicBody, { status: 200 })
    }

    return NextResponse.json(
      {
        ...publicBody,
        sync: {
          totalActiveGuilds: sync.totalActiveGuilds,
          failingGuilds: sync.failingGuilds,
          failureRate: Math.round(failureRate * 10) / 10,
          disabledDueToFailures: sync.disabledDueToFailures,
          commonErrorPatterns: sync.commonErrorPatterns,
          avgConsecutiveFailures: sync.avgConsecutiveFailures
        },
        dataIntegrity: {
          orphanedPlayers: dataIntegrity.orphanedPlayers,
          syncGaps: dataIntegrity.syncGaps,
          seasonDataIntegrity: dataIntegrity.seasonDataIntegrity,
          staleGuilds: dataIntegrity.staleGuilds,
          excludedGuilds: dataIntegrity.excludedGuilds
        }
      },
      {
        status: 200
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
})
