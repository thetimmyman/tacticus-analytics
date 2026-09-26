import { addInfrastructureAlert } from '@tacticus/app-core/daily-alert-summary'
import {
  getSupabaseWsUrl,
  hasSupabaseCredentials
} from '@tacticus/app-core/supabase-env'
import * as https from 'https'
import * as http from 'http'

interface RealtimeHealthResult {
  checked: boolean
  reachable: boolean
  responseTimeMs: number
  error?: string
}

export async function checkRealtimeHealth(
  emitAlerts = true
): Promise<RealtimeHealthResult> {
  if (!hasSupabaseCredentials()) {
    return {
      checked: false,
      reachable: false,
      responseTimeMs: 0,
      error: 'Supabase credentials not configured'
    }
  }

  const startTime = Date.now()

  try {
    const wsUrl = getSupabaseWsUrl()

    const httpUrl = wsUrl
      .replace('wss://', 'https://')
      .replace('ws://', 'http://')

    const url = new URL(httpUrl)
    const isHttps = url.protocol === 'https:'

    return new Promise((resolve) => {
      const options = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'GET',
        timeout: 10000
      }

      const requestModule = isHttps ? https : http

      const req = requestModule.request(options, (res) => {
        const responseTimeMs = Date.now() - startTime

        const reachable = res.statusCode !== undefined && res.statusCode < 500

        if (emitAlerts && !reachable) {
          addInfrastructureAlert(
            'Realtime Service Unavailable',
            `Supabase Realtime returned status ${res.statusCode}`,
            'warning',
            {
              statusCode: res.statusCode,
              responseTimeMs
            }
          )
        }

        resolve({
          checked: true,
          reachable,
          responseTimeMs
        })

        // Drain to free the socket.
        res.resume()
      })

      req.on('error', (error) => {
        const responseTimeMs = Date.now() - startTime

        if (emitAlerts) {
          addInfrastructureAlert(
            'Realtime Connection Failed',
            `Unable to connect to Supabase Realtime: ${error.message}`,
            'error',
            {
              error: error.message,
              responseTimeMs
            }
          )
        }

        resolve({
          checked: true,
          reachable: false,
          responseTimeMs,
          error: error.message
        })
      })

      req.on('timeout', () => {
        req.destroy()
        const responseTimeMs = Date.now() - startTime

        if (emitAlerts) {
          addInfrastructureAlert(
            'Realtime Connection Timeout',
            'Supabase Realtime connection timed out after 10 seconds',
            'warning',
            {
              responseTimeMs
            }
          )
        }

        resolve({
          checked: true,
          reachable: false,
          responseTimeMs,
          error: 'Connection timeout'
        })
      })

      req.end()
    })
  } catch (error) {
    const responseTimeMs = Date.now() - startTime

    return {
      checked: false,
      reachable: false,
      responseTimeMs,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

export async function runRealtimeHealthChecks(
  options: { emitAlerts?: boolean } = {}
): Promise<RealtimeHealthResult> {
  return await checkRealtimeHealth(options.emitAlerts ?? true)
}
