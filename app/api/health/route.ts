import { NextResponse } from 'next/server'
import { writeQueue } from '@/app/lib/db'
import {
  withRequestContext,
  type ApiRequestContext
} from '@/app/lib/logging/request-context'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { safeEqual } from '@/app/lib/auth/require-header-secret'
import {
  circuitRegistry,
  notificationQueue,
  retryMetricsCollector
} from '@/app/lib/resilience'
import {
  getMemoryMonitor,
  attemptMemoryRecovery,
  sendCriticalMemoryAlert
} from '@/app/lib/health'
import { isSelfHostedOrLocalDeployment } from '@/app/lib/health/self-hosted'

export const dynamic = 'force-dynamic'

import {
  checkAuthDependency,
  checkMetricsDataLayer,
  execFileResultOutput,
  getDiskSpace,
  getDockerContainerStatus,
  getSupabaseKongUrl,
  latestHttpStatus,
  withTimeout,
  type CheckResult
} from './health-probes'
import {
  sanitizeHealthSnapshot,
  type HealthSnapshot
} from './health-snapshot-model'

// Public, spawns probes and may trigger memory recovery, so snapshot-cache + single-flight it.
let cachedSnapshot: { value: HealthSnapshot; expiresAt: number } | null = null
let snapshotInFlight: Promise<HealthSnapshot> | null = null

function healthCacheTtlMs(): number {
  const parsed = Number(process.env.HEALTH_CACHE_TTL_MS)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 5000
}

function getHealthSnapshot(
  log: ApiRequestContext['log']
): Promise<HealthSnapshot> {
  if (cachedSnapshot && Date.now() < cachedSnapshot.expiresAt) {
    return Promise.resolve(cachedSnapshot.value)
  }
  if (snapshotInFlight) return snapshotInFlight
  snapshotInFlight = computeHealthSnapshot(log)
    .then((value) => {
      cachedSnapshot = { value, expiresAt: Date.now() + healthCacheTtlMs() }
      return value
    })
    .finally(() => {
      snapshotInFlight = null
    })
  return snapshotInFlight
}

function isAuthorizedHealthReader(req: Request): boolean {
  const secret = process.env.HEALTH_CHECK_SECRET
  if (!secret) return false
  const header = req.headers.get('authorization')
  return header !== null && safeEqual(header, `Bearer ${secret}`)
}

async function computeHealthSnapshot(
  log: ApiRequestContext['log']
): Promise<HealthSnapshot> {
  const timestamp = new Date().toISOString()
  const checks: Record<string, CheckResult> = {}
  let overallStatus = 'healthy'
  const startTime = Date.now()

  log.debug('Starting health check')

  const isSelfHosted = isSelfHostedOrLocalDeployment()

  const memoryMonitor = getMemoryMonitor()
  const memoryStatus = memoryMonitor.checkMemory()
  const heapBreakdown = memoryMonitor.getHeapBreakdown()

  const memoryCheckStatus = memoryStatus.status === 'healthy' ? 'pass' : 'fail'
  checks.memory = {
    status: memoryCheckStatus,
    details: {
      usedMB: memoryStatus.usedMB,
      totalMB: memoryStatus.totalMB,
      usedPercent: Math.round(memoryStatus.usedPercent * 10) / 10,
      status: memoryStatus.status,
      trend: memoryStatus.trend,
      leakSuspected: memoryStatus.leakSuspected,
      trendDetails: memoryStatus.trendDetails,
      heap: heapBreakdown
    }
  }

  if (memoryStatus.status !== 'healthy') {
    if (memoryStatus.status === 'warning') {
      overallStatus = 'degraded'
    } else if (
      memoryStatus.status === 'critical' ||
      memoryStatus.status === 'extreme'
    ) {
      overallStatus = 'unhealthy'
    }

    void attemptMemoryRecovery(memoryStatus, {
      enableCacheClearing: true,
      enableGc: true,
      enableAutoShutdown: isSelfHosted && memoryStatus.status === 'extreme',
      onCriticalAlert: async (status) => {
        if (isSelfHosted) {
          await sendCriticalMemoryAlert(status)
        }
      }
    })
  }

  const memoryUsage = {
    heapUsed: heapBreakdown.heapUsedMB,
    heapTotal: heapBreakdown.heapTotalMB,
    rss: heapBreakdown.rssMB,
    unit: 'MB'
  }

  // wget child process: Next.js's patched fetch/undici pool is unreliable for this long-running.
  const kongUrl = getSupabaseKongUrl()
  const dbCheck = await withTimeout(
    (async (): Promise<CheckResult> => {
      const dbStart = Date.now()
      try {
        // --spider avoids downloading the schema (BusyBox wget lacks --method=HEAD).
        const { stdout, stderr } = await execFileResultOutput(
          'wget',
          ['-S', '--spider', '--timeout=3', `${kongUrl}/rest/v1/`],
          4000
        )
        const output = stdout + stderr
        // Any HTTP status, even 401 without apikey, proves reachability.
        const hasHttp = latestHttpStatus(output) !== null
        return {
          status: hasHttp ? 'pass' : 'fail',
          responseTime: Date.now() - dbStart,
          details: hasHttp
            ? { connected: true }
            : { error: 'No HTTP response from Kong' }
        }
      } catch {
        return {
          status: 'fail',
          responseTime: Date.now() - dbStart,
          details: { error: 'Database connectivity check failed' }
        }
      }
    })(),
    5000,
    {
      status: 'fail' as const,
      details: { error: 'Database check timed out (5s)' }
    }
  )
  checks.database = dbCheck
  if (dbCheck.status === 'fail') overallStatus = 'degraded'

  checks.criticalQueries = {
    status: dbCheck.status,
    details:
      dbCheck.status === 'pass'
        ? { validated: 'via_database_connectivity' }
        : {
            error: 'Skipped — database unreachable',
            hint: 'Database connectivity check failed'
          }
  }

  checks.auth = await withTimeout(checkAuthDependency(kongUrl), 5000, {
    status: 'fail' as const,
    details: {
      provider: 'supabase-auth',
      probe: 'kong-auth-health',
      error: 'Auth health probe timed out'
    }
  })
  if (checks.auth.status === 'fail') overallStatus = 'degraded'

  // Catches missing functions, stale schema cache and broken anon grants; sentinel args return 0 rows.
  checks.calculations = await withTimeout(
    checkMetricsDataLayer(kongUrl),
    5000,
    {
      status: 'fail' as const,
      details: {
        provider: 'rpc-dashboard-calculations',
        probes: [],
        error: 'Dashboard metrics RPC probes timed out'
      }
    }
  )
  if (checks.calculations.status === 'fail') {
    overallStatus = 'degraded'
  }

  if (isSelfHosted) {
    checks.networkReachability = {
      status: dbCheck.status,
      responseTime: dbCheck.responseTime,
      details: {
        target: kongUrl,
        reachable: dbCheck.status === 'pass',
        method: 'wget-child-process'
      }
    }
    if (dbCheck.status === 'fail') {
      overallStatus = 'degraded' // degraded not unhealthy — pages may still load from cache
    }

    const dockerStart = Date.now()
    const [containers, diskSpace] = await Promise.all([
      withTimeout(getDockerContainerStatus(), 4000, {}),
      withTimeout(getDiskSpace(), 4000, null)
    ])

    // Empty means no Docker socket access.
    const hasDockerAccess = Object.keys(containers).length > 0

    const requiredContainers = (
      process.env.HEALTH_REQUIRED_DOCKER_CONTAINERS ?? ''
    )
      .split(',')
      .map((name) => name.trim())
      .filter(Boolean)

    if (hasDockerAccess && requiredContainers.length > 0) {
      const missingContainers = requiredContainers.filter(
        (c) => !containers[c] || containers[c] !== 'running'
      )

      checks.docker = {
        status: missingContainers.length === 0 ? 'pass' : 'fail',
        responseTime: Date.now() - dockerStart,
        details: {
          containers,
          missing: missingContainers.length > 0 ? missingContainers : undefined
        }
      }

      if (missingContainers.length > 0) {
        overallStatus = 'degraded'
      }
    }

    if (diskSpace) {
      const percentNum = parseInt(diskSpace.percent.replace('%', ''), 10)
      checks.disk = {
        status: percentNum < 90 ? 'pass' : 'fail',
        details: {
          used: diskSpace.used,
          available: diskSpace.available,
          percentUsed: diskSpace.percent
        }
      }

      if (percentNum >= 90) {
        overallStatus = 'degraded'
      }
    }
  }

  const circuitSnapshot = circuitRegistry.getSnapshot()
  const queueStats = notificationQueue.getStats()

  if (circuitSnapshot.summary.total > 0) {
    const hasOpenCircuits = circuitSnapshot.summary.open > 0
    // One snapshot: reads lazily advance OPEN -> HALF_OPEN, so a second read could disagree.
    const openCircuits = circuitSnapshot.circuits
      .filter((c) => c.state === 'OPEN')
      .map((c) => c.name)
    const states = Object.fromEntries(
      circuitSnapshot.circuits.map((c) => [c.name, c.state])
    )
    checks.circuits = {
      status: hasOpenCircuits ? 'fail' : 'pass',
      details: {
        total: circuitSnapshot.summary.total,
        closed: circuitSnapshot.summary.closed,
        open: circuitSnapshot.summary.open,
        halfOpen: circuitSnapshot.summary.halfOpen,
        openCircuits,
        states,
        notificationQueue: {
          totalQueued: queueStats.totalQueued,
          queuesByCircuit: queueStats.queuesByCircuit,
          oldestNotification:
            queueStats.oldestNotification?.toISOString() || null
        }
      }
    }

    if (hasOpenCircuits) {
      overallStatus = 'degraded'
    }
  }

  const dbRetryStats = retryMetricsCollector.getStats()
  if (dbRetryStats.totalOperations > 0) {
    const highRetryRate =
      dbRetryStats.failedOperations > dbRetryStats.successfulOperations
    checks.dbRetries = {
      status: highRetryRate ? 'fail' : 'pass',
      details: {
        totalOperations: dbRetryStats.totalOperations,
        successfulRetries: dbRetryStats.successfulOperations,
        failedAfterRetries: dbRetryStats.failedOperations,
        averageAttempts: Math.round(dbRetryStats.averageAttempts * 100) / 100,
        recentFailures: dbRetryStats.recentMetrics
          .filter((m: { success: boolean }) => !m.success)
          .map(
            (m: {
              operationName: string
              attempts: number
              lastError?: string
            }) => ({
              operation: m.operationName,
              attempts: m.attempts,
              error: m.lastError
            })
          )
      }
    }

    if (highRetryRate) {
      overallStatus = 'degraded'
    }
  }

  try {
    const queueStats = await writeQueue.getStats()
    if (queueStats.pending > 0 || queueStats.failed > 0) {
      const hasBacklog = queueStats.pending > 50
      checks.writeQueue = {
        status:
          hasBacklog || queueStats.failed > queueStats.pending
            ? 'fail'
            : 'pass',
        details: {
          pending: queueStats.pending,
          processing: queueStats.processing,
          completed: queueStats.completed,
          failed: queueStats.failed,
          oldestPending: queueStats.oldestPending?.toISOString() || null,
          byCircuit: queueStats.byCircuit
        }
      }

      if (hasBacklog) {
        overallStatus = 'degraded'
      }
    }
  } catch {
    // Optional; never fails the health check.
  }

  const responseTime = Date.now() - startTime

  log.info(
    {
      status: overallStatus,
      responseTime,
      checksCount: Object.keys(checks).length,
      failedChecks: Object.entries(checks)
        .filter(([, c]) => c.status === 'fail')
        .map(([name]) => name)
    },
    `Health check completed: ${overallStatus}`
  )

  return {
    status: overallStatus,
    timestamp,
    checks,
    memory: memoryUsage,
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    deployment: isSelfHosted ? 'self-hosted' : 'cloud',
    cronRole: process.env.CRON_ROLE || 'primary',
    responseTime
  }
}

export const GET = withErrorHandler(
  withRequestContext(
    async (
      req,
      { log, requestId }: ApiRequestContext
    ): Promise<NextResponse> => {
      const snapshot = await getHealthSnapshot(log)

      // Always 200: a 503 makes Cloudflare show its error page instead of the degraded indicator.
      return NextResponse.json(
        isAuthorizedHealthReader(req)
          ? { ...snapshot, requestId }
          : sanitizeHealthSnapshot(snapshot, requestId),
        {
          status: 200
        }
      )
    }
  )
)
