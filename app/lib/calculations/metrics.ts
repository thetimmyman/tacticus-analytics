import {
  captureSentryMessage,
  isSentryEnabled
} from '@/app/lib/monitoring/sentry'

type CalculationMetricSource = 'direct' | 'api' | 'test' | 'unknown' | 'rpc'

export interface CalculationMetric {
  id: string
  strategy?: string
  durationMs: number
  cacheHit?: boolean
  success: boolean
  errorName?: string
  source: CalculationMetricSource
  timestamp: number
  filterCount?: number
}

export interface CalculationMetricSummary {
  id: string
  source: CalculationMetricSource
  count: number
  successRate: number
  p50: number
  p95: number
  p99: number
  max: number
  lastDuration: number
}

const MAX_RECENT = 200
const recentMetrics: CalculationMetric[] = []
const BOSS_CALC_THRESHOLD_MS = Number(
  process.env.SENTRY_BOSS_THRESHOLD_MS ?? '1200'
)
const BOSS_REPORT_COOLDOWN_MS = 5 * 60 * 1000
const lastBossReport = new Map<string, number>()

const shouldReportBossMetric = (metric: CalculationMetric): boolean => {
  if (!isSentryEnabled()) return false
  const isBossMetric = metric.id.toLowerCase().includes('boss')
  if (!isBossMetric) return false

  const cacheKey = `${metric.id}|${metric.source}`
  const lastReported = lastBossReport.get(cacheKey) ?? 0
  if (Date.now() - lastReported < BOSS_REPORT_COOLDOWN_MS) return false

  const isSlow = metric.durationMs >= BOSS_CALC_THRESHOLD_MS
  const isFailure = !metric.success
  if (!isSlow && !isFailure) return false

  lastBossReport.set(cacheKey, Date.now())
  return true
}

const reportBossPerformance = (metric: CalculationMetric): void => {
  if (!shouldReportBossMetric(metric)) return

  captureSentryMessage(
    metric.success
      ? 'Slow boss calculation detected'
      : 'Boss calculation failed',
    {
      level: metric.success ? 'warning' : 'error',
      tags: {
        calculation: metric.id,
        source: metric.source,
        cache: metric.cacheHit ? 'hit' : 'miss'
      },
      extra: {
        durationMs: metric.durationMs,
        filterCount: metric.filterCount,
        errorName: metric.errorName,
        timestamp: metric.timestamp,
        thresholdMs: BOSS_CALC_THRESHOLD_MS
      }
    }
  )
}

export function recordCalculationMetric(
  metric: Omit<CalculationMetric, 'timestamp'> & { timestamp?: number }
): void {
  const entry: CalculationMetric = {
    timestamp: metric.timestamp ?? Date.now(),
    ...metric
  }
  recentMetrics.push(entry)
  if (recentMetrics.length > MAX_RECENT) {
    recentMetrics.splice(0, recentMetrics.length - MAX_RECENT)
  }

  reportBossPerformance(entry)
}

export function getRecentCalculationMetrics(): CalculationMetric[] {
  return [...recentMetrics]
}

export function getSlowCalculations(limit = 5): CalculationMetric[] {
  return [...recentMetrics]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, limit)
}

export function summarizeMetrics(
  windowMs?: number
): CalculationMetricSummary[] {
  const now = Date.now()
  const windowed = windowMs
    ? recentMetrics.filter((entry) => now - entry.timestamp <= windowMs)
    : recentMetrics
  const grouped = windowed.reduce<Map<string, CalculationMetric[]>>(
    (acc, entry) => {
      const key = `${entry.id}|${entry.source}`
      const bucket = acc.get(key) ?? []
      bucket.push(entry)
      acc.set(key, bucket)
      return acc
    },
    new Map()
  )

  const quantile = (values: number[], q: number): number => {
    if (values.length === 0) return 0
    const sorted = [...values].sort((a, b) => a - b)
    const pos = (sorted.length - 1) * q
    const base = Math.floor(pos)
    const rest = pos - base
    const baseValue = sorted[base] ?? 0
    const nextValue = sorted[base + 1]
    if (nextValue !== undefined) {
      return baseValue + rest * (nextValue - baseValue)
    }
    return baseValue
  }

  const summaries: CalculationMetricSummary[] = []
  for (const [key, entries] of grouped.entries()) {
    const [id, source] = key.split('|') as [string, CalculationMetricSource]
    const durations = entries.map((e) => e.durationMs)
    const successes = entries.filter((e) => e.success).length
    summaries.push({
      id,
      source,
      count: entries.length,
      successRate: entries.length === 0 ? 0 : successes / entries.length,
      p50: quantile(durations, 0.5),
      p95: quantile(durations, 0.95),
      p99: quantile(durations, 0.99),
      max: Math.max(...durations),
      lastDuration: durations[durations.length - 1] ?? 0
    })
  }

  return summaries.sort((a, b) => b.p95 - a.p95)
}
