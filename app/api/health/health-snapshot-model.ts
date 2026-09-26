import type { CheckResult } from './health-probes'

export type HealthSnapshot = {
  status: string
  timestamp: string
  checks: Record<string, CheckResult>
  memory: { heapUsed: number; heapTotal: number; rss: number; unit: string }
  uptime: number
  environment: string
  deployment: string
  cronRole: string
  responseTime: number
}

// Error text, URLs, commands, inventories, memory and queue internals stay authenticated-only.
const PUBLIC_DETAIL_KEYS = new Set([
  'provider',
  'probe',
  'failedProbe',
  'statusCode',
  'connected',
  'validated',
  'required',
  'total',
  'closed',
  'open',
  'halfOpen'
])

export function sanitizeCheck(check: CheckResult): CheckResult {
  const details: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(check.details ?? {})) {
    if (!PUBLIC_DETAIL_KEYS.has(key)) continue
    if (
      value === null ||
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean'
    ) {
      details[key] = value
    }
  }
  return {
    status: check.status,
    ...(check.responseTime !== undefined
      ? { responseTime: check.responseTime }
      : {}),
    details
  }
}

export function sanitizeHealthSnapshot(
  snapshot: HealthSnapshot,
  requestId: string
) {
  return {
    status: snapshot.status,
    timestamp: snapshot.timestamp,
    checks: Object.fromEntries(
      Object.entries(snapshot.checks).map(([name, check]) => [
        name,
        sanitizeCheck(check)
      ])
    ),
    responseTime: snapshot.responseTime,
    requestId
  }
}
