import {
  addDatabaseAlert,
  addInfrastructureAlert
} from '@tacticus/app-core/daily-alert-summary'
import { db } from '@/app/lib/db'
import { serviceDb } from '@/app/lib/db'
interface MemoryThresholds {
  warningMB: number
  criticalMB: number
  heapWarningPercent: number
  heapCriticalPercent: number
}

interface DatabaseHealthResult {
  connected: boolean
  responseTimeMs: number
  error?: string
}

interface DependencyHealthResult {
  healthy: boolean
  checked: boolean
  error?: string
  details?: Record<string, unknown>
}

const DEFAULT_MEMORY_THRESHOLDS: MemoryThresholds = {
  warningMB: 512,
  criticalMB: 1024,
  heapWarningPercent: 90,
  heapCriticalPercent: 95
}

const HEALTHCHECK_TIMEOUT_MS = 5000

function isSelfHostedDeployment(): boolean {
  return (
    process.env.DEPLOYMENT_ENV === 'minipc' ||
    process.env.SELF_HOSTED === 'true'
  )
}

async function fetchWithTimeout(
  url: string,
  timeoutMs = HEALTHCHECK_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timeout)
  }
}

export async function checkNginxRouting(
  emitAlerts = true
): Promise<DependencyHealthResult> {
  if (!isSelfHostedDeployment()) {
    return { healthy: true, checked: false }
  }

  try {
    const nginxResponse = await fetchWithTimeout(
      'http://nginx-proxy/nginx-health',
      2000
    )
    if (!nginxResponse.ok) {
      if (emitAlerts) {
        addInfrastructureAlert(
          'Nginx Health Check Failed',
          `nginx /nginx-health returned ${nginxResponse.status}`,
          'error',
          { status: nginxResponse.status }
        )
      }
      return {
        healthy: false,
        checked: true,
        error: `nginx health ${nginxResponse.status}`
      }
    }

    const upstreamResponse = await fetchWithTimeout(
      'http://nginx-proxy/api/version',
      3000
    )
    if (!upstreamResponse.ok) {
      if (emitAlerts) {
        addInfrastructureAlert(
          'Nginx Upstream Routing Failed',
          `nginx upstream returned ${upstreamResponse.status}`,
          'error',
          { status: upstreamResponse.status }
        )
      }
      return {
        healthy: false,
        checked: true,
        error: `nginx upstream ${upstreamResponse.status}`
      }
    }

    return { healthy: true, checked: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (emitAlerts) {
      addInfrastructureAlert(
        'Nginx Routing Check Error',
        `Unable to validate nginx routing: ${message}`,
        'error',
        { error: message }
      )
    }
    return { healthy: false, checked: true, error: message }
  }
}

export async function checkCloudflaredTunnel(
  emitAlerts = true
): Promise<DependencyHealthResult> {
  if (!isSelfHostedDeployment()) {
    return { healthy: true, checked: false }
  }

  if (!process.env.CLOUDFLARE_TUNNEL_TOKEN) {
    if (emitAlerts) {
      addInfrastructureAlert(
        'Cloudflared Tunnel Token Missing',
        'CLOUDFLARE_TUNNEL_TOKEN is not set for self-hosted deployment',
        'critical'
      )
    }
    return {
      healthy: false,
      checked: true,
      error: 'Missing CLOUDFLARE_TUNNEL_TOKEN'
    }
  }

  const healthUrl = process.env.CLOUDFLARED_HEALTH_URL
  if (!healthUrl) {
    // Optional probe: the tunnel token is the required signal.
    return { healthy: true, checked: false }
  }

  try {
    const response = await fetchWithTimeout(healthUrl, 3000)
    if (!response.ok) {
      if (emitAlerts) {
        addInfrastructureAlert(
          'Cloudflared Tunnel Not Ready',
          `cloudflared /ready returned ${response.status}`,
          'error',
          { status: response.status }
        )
      }
      return {
        healthy: false,
        checked: true,
        error: `cloudflared ${response.status}`
      }
    }

    return { healthy: true, checked: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (emitAlerts) {
      addInfrastructureAlert(
        'Cloudflared Tunnel Check Error',
        `Unable to validate cloudflared readiness: ${message}`,
        'error',
        { error: message }
      )
    }
    return { healthy: false, checked: true, error: message }
  }
}

export async function checkPostgrestSchemaHealth(
  emitAlerts = true
): Promise<DependencyHealthResult> {
  if (!isSelfHostedDeployment()) {
    return { healthy: true, checked: false }
  }

  try {
    const supabase = serviceDb()
    const { error } = await supabase
      .from('player_mapping')
      .select('guild_config(id)')
      .limit(1)

    if (error) {
      if (emitAlerts) {
        addInfrastructureAlert(
          'PostgREST Schema Cache Issue',
          `PostgREST schema check failed: ${error.message}`,
          'error',
          { error: error.message }
        )
      }
      return { healthy: false, checked: true, error: error.message }
    }

    return { healthy: true, checked: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error'
    if (emitAlerts) {
      addInfrastructureAlert(
        'PostgREST Schema Check Error',
        `Unable to validate PostgREST schema: ${message}`,
        'error',
        { error: message }
      )
    }
    return { healthy: false, checked: true, error: message }
  }
}

export async function checkMemoryHealth(
  thresholds: MemoryThresholds = DEFAULT_MEMORY_THRESHOLDS,
  emitAlerts = true
): Promise<void> {
  const memory = process.memoryUsage()
  const heapUsedMB = Math.round(memory.heapUsed / 1024 / 1024)
  const heapTotalMB = Math.round(memory.heapTotal / 1024 / 1024)
  const rssMB = Math.round(memory.rss / 1024 / 1024)
  const heapPercent = Math.round((memory.heapUsed / memory.heapTotal) * 100)

  if (rssMB >= thresholds.criticalMB) {
    if (emitAlerts) {
      addInfrastructureAlert(
        'Critical Memory Usage',
        `Process RSS memory at ${rssMB}MB (critical threshold: ${thresholds.criticalMB}MB)`,
        'critical',
        {
          rssMB,
          heapUsedMB,
          heapTotalMB,
          heapPercent,
          threshold: thresholds.criticalMB,
          unit: 'MB'
        }
      )
    }
  } else if (rssMB >= thresholds.warningMB) {
    if (emitAlerts) {
      addInfrastructureAlert(
        'High Memory Usage',
        `Process RSS memory at ${rssMB}MB (warning threshold: ${thresholds.warningMB}MB)`,
        'warning',
        {
          rssMB,
          heapUsedMB,
          heapTotalMB,
          heapPercent,
          threshold: thresholds.warningMB,
          unit: 'MB'
        }
      )
    }
  }

  if (heapPercent >= thresholds.heapCriticalPercent) {
    if (emitAlerts) {
      addInfrastructureAlert(
        'Critical Heap Usage',
        `Heap usage at ${heapPercent}% (${heapUsedMB}/${heapTotalMB}MB) - potential memory leak`,
        'critical',
        {
          heapPercent,
          heapUsedMB,
          heapTotalMB,
          threshold: thresholds.heapCriticalPercent
        }
      )
    }
  } else if (heapPercent >= thresholds.heapWarningPercent) {
    if (emitAlerts) {
      addInfrastructureAlert(
        'High Heap Usage',
        `Heap usage at ${heapPercent}% (${heapUsedMB}/${heapTotalMB}MB)`,
        'warning',
        {
          heapPercent,
          heapUsedMB,
          heapTotalMB,
          threshold: thresholds.heapWarningPercent
        }
      )
    }
  }
}

export async function checkDatabaseHealth(
  emitAlerts = true
): Promise<DatabaseHealthResult> {
  const startTime = Date.now()

  try {
    const supabase = await db()

    const { error } = await supabase
      .from('guild_config')
      .select('count', { count: 'exact', head: true })

    const responseTimeMs = Date.now() - startTime

    if (error) {
      if (emitAlerts) {
        addDatabaseAlert(
          'Database Query Failed',
          `Database health check query failed: ${error.message}`,
          'error',
          {
            error: error.message,
            responseTimeMs
          }
        )
      }
      return { connected: false, responseTimeMs, error: error.message }
    }

    if (responseTimeMs > 2000) {
      if (emitAlerts) {
        addDatabaseAlert(
          'Slow Database Response',
          `Database health check took ${responseTimeMs}ms (>2000ms threshold)`,
          'warning',
          {
            responseTimeMs,
            threshold: 2000
          }
        )
      }
    }

    return { connected: true, responseTimeMs }
  } catch (error) {
    const responseTimeMs = Date.now() - startTime
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'

    if (emitAlerts) {
      addDatabaseAlert(
        'Database Connection Failed',
        `Unable to connect to database: ${errorMessage}`,
        'critical',
        {
          error: errorMessage,
          responseTimeMs
        }
      )
    }

    return { connected: false, responseTimeMs, error: errorMessage }
  }
}

export async function checkProcessUptime(emitAlerts = false): Promise<void> {
  const uptimeSeconds = process.uptime()
  const uptimeHours = uptimeSeconds / 3600

  if (emitAlerts && uptimeHours < 1) {
    addInfrastructureAlert(
      'Recent Process Restart',
      `Process uptime is only ${Math.round(uptimeSeconds / 60)} minutes - may indicate recent crash or restart`,
      'info',
      {
        uptimeSeconds: Math.round(uptimeSeconds),
        uptimeMinutes: Math.round(uptimeSeconds / 60)
      }
    )
  }
}

export async function checkEnvironmentHealth(emitAlerts = true): Promise<void> {
  const requiredVars = [
    'NEXT_PUBLIC_SUPABASE_URL',
    'NEXT_PUBLIC_SUPABASE_ANON_KEY',
    'SUPABASE_SERVICE_ROLE_KEY'
  ]

  const recommendedVars = ['RESEND_API_KEY', 'CRON_SECRET']

  const missingRequired = requiredVars.filter((v) => !process.env[v])
  const missingRecommended = recommendedVars.filter((v) => !process.env[v])

  if (missingRequired.length > 0) {
    if (emitAlerts) {
      addInfrastructureAlert(
        'Missing Required Environment Variables',
        `Missing required environment variables: ${missingRequired.join(', ')}`,
        'critical',
        {
          missingVars: missingRequired,
          type: 'required'
        }
      )
    }
  }

  if (missingRecommended.length > 0) {
    if (emitAlerts) {
      addInfrastructureAlert(
        'Missing Recommended Environment Variables',
        `Missing recommended environment variables: ${missingRecommended.join(', ')}`,
        'warning',
        {
          missingVars: missingRecommended,
          type: 'recommended'
        }
      )
    }
  }
}

export async function runInfrastructureHealthChecks(
  options: { emitAlerts?: boolean } = {}
): Promise<{
  memory: boolean
  database: DatabaseHealthResult
  uptime: boolean
  environment: boolean
  dependencies: {
    nginx: DependencyHealthResult
    cloudflared: DependencyHealthResult
    postgrest: DependencyHealthResult
  }
}> {
  const emitAlerts = options.emitAlerts ?? true
  const results = {
    memory: false,
    database: { connected: false, responseTimeMs: 0 } as DatabaseHealthResult,
    uptime: false,
    environment: false,
    dependencies: {
      nginx: { healthy: true, checked: false } as DependencyHealthResult,
      cloudflared: { healthy: true, checked: false } as DependencyHealthResult,
      postgrest: { healthy: true, checked: false } as DependencyHealthResult
    }
  }

  try {
    await checkMemoryHealth(DEFAULT_MEMORY_THRESHOLDS, emitAlerts)
    results.memory = true
  } catch (error) {
    console.error('Memory health check failed:', error)
  }

  try {
    results.database = await checkDatabaseHealth(emitAlerts)
  } catch (error) {
    console.error('Database health check failed:', error)
  }

  try {
    const emitRestartAlert =
      emitAlerts && process.env.ENABLE_PROCESS_RESTART_ALERTS === 'true'
    await checkProcessUptime(emitRestartAlert)
    results.uptime = true
  } catch (error) {
    console.error('Uptime check failed:', error)
  }

  try {
    await checkEnvironmentHealth(emitAlerts)
    results.environment = true
  } catch (error) {
    console.error('Environment health check failed:', error)
  }

  try {
    results.dependencies.nginx = await checkNginxRouting(emitAlerts)
  } catch (error) {
    console.error('Nginx routing check failed:', error)
  }

  try {
    results.dependencies.cloudflared = await checkCloudflaredTunnel(emitAlerts)
  } catch (error) {
    console.error('Cloudflared check failed:', error)
  }

  try {
    results.dependencies.postgrest =
      await checkPostgrestSchemaHealth(emitAlerts)
  } catch (error) {
    console.error('PostgREST schema check failed:', error)
  }

  return results
}
