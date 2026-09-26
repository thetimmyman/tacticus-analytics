import { legacyConsoleLogger as logger } from './logger'

/** Dev-only detection of query loops and excessive re-renders. */
interface QueryMetrics {
  count: number
  firstCall: number
  lastCall: number
  component: string
}

class PerformanceMonitor {
  private static instance: PerformanceMonitor
  private queryMetrics = new Map<string, QueryMetrics>()
  private renderCounts = new Map<string, number>()
  private warningThreshold = 10
  private errorThreshold = 50
  private timeWindow = 5000 // 5 seconds

  private constructor() {
    if (typeof window !== 'undefined') {
      setInterval(() => this.cleanup(), 30000) // Cleanup every 30 seconds
    }
  }

  static getInstance(): PerformanceMonitor {
    if (!PerformanceMonitor.instance) {
      PerformanceMonitor.instance = new PerformanceMonitor()
    }
    return PerformanceMonitor.instance
  }

  logQuery(component: string, queryName: string): void {
    if (component.includes('PlayerStatsController')) {
      return
    }

    const key = `${component}:${queryName}`
    const now = Date.now()
    const metrics = this.queryMetrics.get(key)

    if (!metrics) {
      this.queryMetrics.set(key, {
        count: 1,
        firstCall: now,
        lastCall: now,
        component
      })
      return
    }

    metrics.count++
    metrics.lastCall = now

    const timeElapsed = now - metrics.firstCall
    const queriesPerSecond = (metrics.count / timeElapsed) * 1000

    if (metrics.count > this.errorThreshold) {
      logger.error(
        `🚨 CRITICAL: Potential infinite loop detected!\n` +
          `Component: ${component}\n` +
          `Query: ${queryName}\n` +
          `Count: ${metrics.count} queries in ${timeElapsed}ms\n` +
          `Rate: ${queriesPerSecond.toFixed(2)} queries/second`
      )
    } else if (metrics.count > this.warningThreshold) {
      logger.warn(
        `⚠️  Warning: High query frequency\n` +
          `Component: ${component}\n` +
          `Query: ${queryName}\n` +
          `Count: ${metrics.count} queries`
      )
    }
  }

  logRender(componentName: string): number {
    const count = (this.renderCounts.get(componentName) || 0) + 1
    this.renderCounts.set(componentName, count)

    if (componentName.includes('PlayerStatsController')) {
      return count
    }

    if (count > 100) {
      logger.error(
        `🚨 CRITICAL: Excessive re-renders!\n` +
          `Component: ${componentName}\n` +
          `Render count: ${count}`
      )
    } else if (count > 50) {
      logger.warn(
        `⚠️  Warning: High render count\n` +
          `Component: ${componentName}\n` +
          `Render count: ${count}`
      )
    }

    return count
  }

  reset(component?: string): void {
    if (component) {
      const keysToDelete: string[] = []
      this.queryMetrics.forEach((_, key) => {
        if (key.startsWith(`${component}:`)) {
          keysToDelete.push(key)
        }
      })
      keysToDelete.forEach((key) => this.queryMetrics.delete(key))
      this.renderCounts.delete(component)
    } else {
      this.queryMetrics.clear()
      this.renderCounts.clear()
    }
  }

  private cleanup(): void {
    const now = Date.now()
    const keysToDelete: string[] = []
    this.queryMetrics.forEach((metrics, key) => {
      if (now - metrics.lastCall > this.timeWindow * 2) {
        keysToDelete.push(key)
      }
    })
    keysToDelete.forEach((key) => this.queryMetrics.delete(key))
  }

  getStats(): {
    queries: Array<{ key: string; count: number; rate: number }>
    renders: Array<{ component: string; count: number }>
  } {
    const now = Date.now()
    const queries = Array.from(this.queryMetrics.entries())
      .map(([key, metrics]) => {
        const timeElapsed = now - metrics.firstCall
        const rate = (metrics.count / timeElapsed) * 1000
        return { key, count: metrics.count, rate }
      })
      .sort((a, b) => b.count - a.count)

    const renders = Array.from(this.renderCounts.entries())
      .map(([component, count]) => ({
        component,
        count
      }))
      .sort((a, b) => b.count - a.count)

    return { queries, renders }
  }

  printReport(): void {
    const stats = this.getStats()
    if (stats.queries.length > 0) {
      stats.queries.slice(0, 10).forEach(({ key, count, rate }) => {
        const level =
          count > this.errorThreshold
            ? 'error'
            : count > this.warningThreshold
              ? 'warn'
              : 'log'
        console[level](`${key}: ${count} calls (${rate.toFixed(2)}/sec)`)
      })
    }
    if (stats.renders.length > 0) {
      stats.renders.slice(0, 10).forEach(({ component, count }) => {
        const level = count > 100 ? 'error' : count > 50 ? 'warn' : 'log'
        console[level](`${component}: ${count} renders`)
      })
    }
  }
}

export const performanceMonitor = PerformanceMonitor.getInstance()

export function logQuery(component: string, queryName: string): void {
  if (process.env.NODE_ENV === 'development') {
    performanceMonitor.logQuery(component, queryName)
  }
}

export function logRender(componentName: string): number {
  if (process.env.NODE_ENV === 'development') {
    return performanceMonitor.logRender(componentName)
  }
  return 0
}

export function resetMonitor(component?: string): void {
  performanceMonitor.reset(component)
}

export function getPerformanceStats(): Record<string, unknown> {
  return performanceMonitor.getStats()
}

export function printPerformanceReport(): void {
  performanceMonitor.printReport()
}
