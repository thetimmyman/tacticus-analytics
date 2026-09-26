// Active-passive failover: CRON_ROLE=secondary runs only when CRON_PRIMARY_URL fails its probe; unset = primary.

import http from 'http'
import https from 'https'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('scheduler.cron-guard')

export interface CronGuardResult {
  shouldExecute: boolean
  reason: string
}

const PROBE_TIMEOUT_MS = 5000

/** Raw http.request bypasses Next.js's patched fetch. */
function probePrimaryHealth(baseUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const url = new URL('/api/health/live', baseUrl)
      const transport = url.protocol === 'https:' ? https : http

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (url.protocol === 'https:' ? 443 : 80),
          path: url.pathname,
          method: 'GET',
          timeout: PROBE_TIMEOUT_MS
        },
        (res) => {
          res.resume()
          resolve((res.statusCode || 0) >= 200 && (res.statusCode || 0) < 400)
        }
      )

      req.on('timeout', () => {
        req.destroy()
        resolve(false)
      })
      req.on('error', () => {
        resolve(false)
      })
      req.end()
    } catch {
      resolve(false)
    }
  })
}

export async function cronGuard(): Promise<CronGuardResult> {
  const role = (process.env.CRON_ROLE || 'primary').toLowerCase()

  if (role !== 'secondary') {
    return { shouldExecute: true, reason: 'primary' }
  }

  const primaryUrl = process.env.CRON_PRIMARY_URL
  if (!primaryUrl) {
    logger.warn(
      '[CronGuard] CRON_ROLE=secondary but CRON_PRIMARY_URL not set — executing as failover'
    )
    return {
      shouldExecute: true,
      reason: 'failover: CRON_PRIMARY_URL not configured'
    }
  }

  const primaryAlive = await probePrimaryHealth(primaryUrl)

  if (primaryAlive) {
    logger.info(`[CronGuard] Primary alive at ${primaryUrl} — skipping`)
    return {
      shouldExecute: false,
      reason: `deferred to primary at ${primaryUrl}`
    }
  }

  logger.warn(
    `[CronGuard] Primary unreachable at ${primaryUrl} — executing as failover`
  )
  return {
    shouldExecute: true,
    reason: `failover: primary unreachable at ${primaryUrl}`
  }
}
