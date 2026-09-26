import { createComponentLogger } from '@/app/lib/logging'
import type { MemoryStatus, MemoryStatusLevel } from './memory-monitor'

const logger = createComponentLogger('memory-recovery')

export interface RecoveryResult {
  action: 'none' | 'cache_cleared' | 'gc_triggered' | 'shutdown_initiated'
  previousStatus: MemoryStatusLevel
  recoveryAttempted: boolean
  cacheCleared: boolean
  gcTriggered: boolean
  shutdownInitiated: boolean
  freedMB?: number
  errorMessage?: string
}

export interface RecoveryOptions {
  enableCacheClearing?: boolean
  enableGc?: boolean
  enableAutoShutdown?: boolean
  onCriticalAlert?: (status: MemoryStatus) => Promise<void>
}

const DEFAULT_OPTIONS: Required<RecoveryOptions> = {
  enableCacheClearing: true,
  enableGc: true,
  enableAutoShutdown: false,
  onCriticalAlert: async () => {}
}

let shutdownInProgress = false

async function clearApplicationCaches(): Promise<number> {
  let freedMB = 0
  const memBefore = process.memoryUsage().heapUsed

  try {
    const { mainCache, apiCache, tokenCache } =
      await import('@tacticus/app-core/unified-cache')

    const mainStats = mainCache.getStats()
    const apiStats = apiCache.getStats()
    const tokenStats = tokenCache.getStats()

    logger.info(
      {
        mainCacheSize: mainStats.size,
        apiCacheSize: apiStats.size,
        tokenCacheSize: tokenStats.size
      },
      'Clearing application caches'
    )

    mainCache.clear()
    apiCache.clear()
    tokenCache.clear()

    const memAfter = process.memoryUsage().heapUsed
    freedMB = Math.round((memBefore - memAfter) / 1024 / 1024)

    logger.info({ freedMB }, 'Application caches cleared')
  } catch (error) {
    logger.warn({ error }, 'Failed to clear some application caches')
  }

  return freedMB
}

/** Needs node --expose-gc. */
function triggerGarbageCollection(): boolean {
  if (typeof global.gc === 'function') {
    const memBefore = process.memoryUsage().heapUsed
    global.gc()
    const memAfter = process.memoryUsage().heapUsed
    const freedMB = Math.round((memBefore - memAfter) / 1024 / 1024)

    logger.info({ freedMB }, 'Garbage collection triggered manually')
    return true
  }

  logger.warn(
    'Manual garbage collection not available - Node.js started without --expose-gc flag'
  )
  return false
}

/** Deliberately not a drain: in-flight requests are dropped and retried against a healthy replica. */
function initiateImmediateShutdown(): void {
  if (shutdownInProgress) {
    logger.warn('Shutdown already in progress')
    return
  }

  shutdownInProgress = true
  logger.error(
    'Extreme memory pressure - exiting immediately without draining in-flight requests'
  )

  process.exit(1)
}

export async function attemptMemoryRecovery(
  status: MemoryStatus,
  options?: RecoveryOptions
): Promise<RecoveryResult> {
  const opts = { ...DEFAULT_OPTIONS, ...options }
  const memBefore = process.memoryUsage().rss

  const result: RecoveryResult = {
    action: 'none',
    previousStatus: status.status,
    recoveryAttempted: false,
    cacheCleared: false,
    gcTriggered: false,
    shutdownInitiated: false
  }

  if (status.status === 'healthy') {
    return result
  }

  result.recoveryAttempted = true

  try {
    if (status.status === 'warning' && opts.enableCacheClearing) {
      logger.info('Memory warning - clearing application caches')
      const freedMB = await clearApplicationCaches()
      result.action = 'cache_cleared'
      result.cacheCleared = true
      result.freedMB = freedMB
    }

    if (status.status === 'critical') {
      logger.warn('Memory critical - aggressive recovery actions')

      if (opts.enableCacheClearing) {
        await clearApplicationCaches()
        result.cacheCleared = true
      }

      if (opts.enableGc) {
        result.gcTriggered = triggerGarbageCollection()
      }

      result.action = 'gc_triggered'

      await opts.onCriticalAlert(status)
    }

    if (status.status === 'extreme') {
      logger.error('Memory extreme - initiating emergency recovery')

      if (opts.enableCacheClearing) {
        await clearApplicationCaches()
        result.cacheCleared = true
      }

      if (opts.enableGc) {
        result.gcTriggered = triggerGarbageCollection()
      }

      await opts.onCriticalAlert(status)

      if (opts.enableAutoShutdown) {
        result.action = 'shutdown_initiated'
        result.shutdownInitiated = true
        initiateImmediateShutdown()
      } else {
        result.action = 'gc_triggered'
        logger.warn(
          'Auto-shutdown disabled - container may be OOM killed by Docker'
        )
      }
    }

    const memAfter = process.memoryUsage().rss
    result.freedMB = Math.round((memBefore - memAfter) / 1024 / 1024)

    logger.info(
      {
        action: result.action,
        freedMB: result.freedMB,
        previousStatus: result.previousStatus
      },
      'Memory recovery completed'
    )
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    result.errorMessage = errorMessage
    logger.error({ error }, 'Memory recovery failed')
  }

  return result
}

/** Queued into the daily summary email, not sent immediately. */
export async function sendCriticalMemoryAlert(
  status: MemoryStatus
): Promise<boolean> {
  try {
    const { addInfrastructureAlert } =
      await import('@tacticus/app-core/daily-alert-summary')

    const message = `Memory ${status.status.toUpperCase()}: ${status.usedMB}MB / ${status.totalMB}MB (${status.usedPercent.toFixed(1)}%) - Trend: ${status.trend}${status.leakSuspected ? ' - LEAK SUSPECTED' : ''} - Growth: ${status.trendDetails.growthRateMBPerMinute} MB/min`
    const severity =
      status.status === 'extreme' ? ('critical' as const) : ('warning' as const)

    addInfrastructureAlert('Memory Pressure', message, severity)

    logger.info('Critical memory alert queued for summary')
    return true
  } catch (error) {
    logger.warn({ error }, 'Failed to queue memory alert')
    return false
  }
}
