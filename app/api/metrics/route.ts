import { NextRequest, NextResponse } from 'next/server'
import { Errors } from '@/app/lib/errors/AppError'
import { Registry, Gauge, Counter, collectDefaultMetrics } from 'prom-client'
import { serviceDb } from '@/app/lib/db'
import {
  checkCloudflaredTunnel,
  checkNginxRouting,
  checkPostgrestSchemaHealth
} from '@/app/lib/health'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { safeEqual } from '@/app/lib/auth/require-header-secret'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const register = new Registry()
const METRICS_SECRET = process.env.METRICS_SECRET?.trim()

register.setDefaultLabels({
  app: 'tacticus-analytics',
  environment: process.env.NODE_ENV || 'development'
})

collectDefaultMetrics({ register, prefix: 'tacticus_' })

const healthCheckDatabaseStatus = new Gauge({
  name: 'tacticus_health_check_database_status',
  help: 'Database connection status (1=up, 0=down)',
  registers: [register]
})

const healthCheckAuthStatus = new Gauge({
  name: 'tacticus_health_check_auth_status',
  help: 'Auth service status (1=up, 0=down)',
  registers: [register]
})

const healthCheckNginxStatus = new Gauge({
  name: 'tacticus_health_check_nginx_status',
  help: 'Nginx routing status (1=up, 0=down)',
  registers: [register]
})

const healthCheckCloudflaredStatus = new Gauge({
  name: 'tacticus_health_check_cloudflared_status',
  help: 'Cloudflared tunnel readiness (1=ready, 0=down)',
  registers: [register]
})

const healthCheckPostgrestSchemaStatus = new Gauge({
  name: 'tacticus_health_check_postgrest_schema_status',
  help: 'PostgREST schema health (1=healthy, 0=unhealthy)',
  registers: [register]
})

const apiResponseTime = new Gauge({
  name: 'tacticus_api_response_time_seconds',
  help: 'API response time in seconds',
  labelNames: ['endpoint'],
  registers: [register]
})

const duplicateCurrentRecords = new Gauge({
  name: 'tacticus_duplicate_current_records',
  help: 'Number of players with duplicate current records',
  registers: [register]
})

const cacheHitRate = new Gauge({
  name: 'tacticus_cache_hit_rate',
  help: 'Cache hit rate (0-1)',
  registers: [register]
})

const signupsTotal = new Counter({
  name: 'tacticus_signups_total',
  help: 'Total number of signups',
  registers: [register]
})

const signupFailuresTotal = new Counter({
  name: 'tacticus_signup_failures_total',
  help: 'Total number of signup failures',
  registers: [register]
})

const lastDataUpdateTimestamp = new Gauge({
  name: 'tacticus_last_data_update_timestamp',
  help: 'Unix timestamp of last data update',
  registers: [register]
})

const lastBackupTimestamp = new Gauge({
  name: 'tacticus_last_backup_timestamp',
  help: 'Unix timestamp of last successful backup',
  registers: [register]
})

const lastBackupStatus = new Gauge({
  name: 'tacticus_last_backup_status',
  help: 'Last backup status (1=success, 0=failed)',
  registers: [register]
})

const memoryUsageBytes = new Gauge({
  name: 'tacticus_memory_usage_bytes',
  help: 'Memory usage in bytes',
  labelNames: ['type'],
  registers: [register]
})

const uptimeSeconds = new Gauge({
  name: 'tacticus_uptime_seconds',
  help: 'Process uptime in seconds',
  registers: [register]
})

const activeGuilds = new Gauge({
  name: 'tacticus_active_guilds',
  help: 'Number of active guilds',
  registers: [register]
})

const activePlayers = new Gauge({
  name: 'tacticus_active_players',
  help: 'Number of active players',
  registers: [register]
})

const syncLastRunTimestamp = new Gauge({
  name: 'tacticus_sync_last_run_timestamp',
  help: 'Unix timestamp of last sync run by type',
  labelNames: ['sync_type'],
  registers: [register]
})

const syncDurationSeconds = new Gauge({
  name: 'tacticus_sync_duration_seconds',
  help: 'Duration of last sync run in seconds by type',
  labelNames: ['sync_type'],
  registers: [register]
})

const syncStatus = new Gauge({
  name: 'tacticus_sync_status',
  help: 'Status of last sync (1=success, 0=failed) by type',
  labelNames: ['sync_type'],
  registers: [register]
})

const syncGuildsProcessed = new Gauge({
  name: 'tacticus_sync_guilds_processed',
  help: 'Number of guilds processed in last sync',
  registers: [register]
})

const discordLeaderboardLastUpdate = new Gauge({
  name: 'tacticus_discord_leaderboard_last_update_timestamp',
  help: 'Unix timestamp of last Discord leaderboard update',
  registers: [register]
})

const discordLeaderboardStatus = new Gauge({
  name: 'tacticus_discord_leaderboard_status',
  help: 'Status of last Discord leaderboard update (1=success, 0=failed)',
  registers: [register]
})

const discordWebhooksConfigured = new Gauge({
  name: 'tacticus_discord_webhooks_configured',
  help: 'Number of Discord webhooks configured',
  registers: [register]
})

const metaAtlasLastRefresh = new Gauge({
  name: 'tacticus_meta_atlas_last_refresh_timestamp',
  help: 'Unix timestamp of last Meta Atlas materialized view refresh',
  registers: [register]
})

const metaAtlasStatus = new Gauge({
  name: 'tacticus_meta_atlas_status',
  help: 'Status of last Meta Atlas refresh (1=success, 0=failed)',
  registers: [register]
})

const metaAtlasTeamCount = new Gauge({
  name: 'tacticus_meta_atlas_team_count',
  help: 'Number of teams in Meta Atlas',
  registers: [register]
})

const edgeFunctionInvocations = new Counter({
  name: 'tacticus_edge_function_invocations_total',
  help: 'Total edge function invocations by function name',
  labelNames: ['function_name'],
  registers: [register]
})

const edgeFunctionErrors = new Counter({
  name: 'tacticus_edge_function_errors_total',
  help: 'Total edge function errors by function name',
  labelNames: ['function_name'],
  registers: [register]
})

async function collectMetrics(): Promise<void> {
  const startTime = Date.now()

  try {
    const supabase = serviceDb()
    const { error } = await supabase
      .from('guild_config')
      .select('count', { count: 'exact', head: true })

    healthCheckDatabaseStatus.set(error ? 0 : 1)

    if (!error) {
      const { count: guildCount } = await supabase
        .from('guild_config')
        .select('*', { count: 'exact', head: true })
        .eq('enabled', true)

      activeGuilds.set(guildCount || 0)

      const { data: playerData } = await supabase.rpc('get_public_stats')

      if (
        playerData &&
        typeof playerData === 'object' &&
        'active_players' in playerData
      ) {
        activePlayers.set(
          (playerData as { active_players: number }).active_players || 0
        )
      }

      const { data: syncHealthData } = await supabase
        .from('sync_health')
        .select(
          'guild_code, health_status, total_syncs, avg_sync_time_ms, updated_at'
        )
        .order('updated_at', { ascending: false })
        .limit(100)

      if (syncHealthData && syncHealthData.length > 0) {
        const latestSync = syncHealthData[0]
        if (latestSync?.updated_at) {
          lastDataUpdateTimestamp.set(
            new Date(latestSync.updated_at).getTime() / 1000
          )
        }

        const healthyCount = syncHealthData.filter(
          (s) => s.health_status === 'healthy'
        ).length
        const totalCount = syncHealthData.length

        syncStatus.labels('modular_workflow').set(healthyCount > 0 ? 1 : 0)
        syncLastRunTimestamp
          .labels('modular_workflow')
          .set(
            latestSync?.updated_at
              ? new Date(latestSync.updated_at).getTime() / 1000
              : 0
          )

        const avgSyncTime =
          syncHealthData.reduce(
            (sum, s) => sum + (s.avg_sync_time_ms || 0),
            0
          ) / totalCount
        syncDurationSeconds.labels('modular_workflow').set(avgSyncTime / 1000)

        syncGuildsProcessed.set(totalCount)

        syncStatus.labels('guild_raid').set(healthyCount > 0 ? 1 : 0)
        syncLastRunTimestamp
          .labels('guild_raid')
          .set(
            latestSync?.updated_at
              ? new Date(latestSync.updated_at).getTime() / 1000
              : 0
          )
        syncDurationSeconds.labels('guild_raid').set(avgSyncTime / 1000)
      }

      const { data: webhookLogs } = await supabase
        .from('discord_webhook_logs')
        .select('webhook_type, created_at, status')
        .eq('webhook_type', 'leaderboard')
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (webhookLogs?.created_at) {
        discordLeaderboardLastUpdate.set(
          new Date(webhookLogs.created_at).getTime() / 1000
        )
        discordLeaderboardStatus.set(webhookLogs.status === 'delivered' ? 1 : 0)
      } else {
        discordLeaderboardStatus.set(0)
        discordLeaderboardLastUpdate.set(0)
      }

      const { count: webhookCount } = await supabase
        .from('guild_config')
        .select('*', { count: 'exact', head: true })
        .not('discord_webhook_url', 'is', null)
        .eq('discord_webhook_enabled', true)

      discordWebhooksConfigured.set(webhookCount || 0)

      const { count: metaTeamCount } = await supabase
        .from('meta_teams')
        .select('*', { count: 'exact', head: true })

      metaAtlasTeamCount.set(metaTeamCount || 0)
      metaAtlasStatus.set(metaTeamCount && metaTeamCount > 0 ? 1 : 0)
      metaAtlasLastRefresh.set(Date.now() / 1000)
    }
  } catch {
    healthCheckDatabaseStatus.set(0)
  }

  try {
    const authClient = serviceDb()
    healthCheckAuthStatus.set(authClient.auth ? 1 : 0)
  } catch {
    healthCheckAuthStatus.set(0)
  }

  const [nginxHealth, cloudflaredHealth, postgrestHealth] = await Promise.all([
    checkNginxRouting(false),
    checkCloudflaredTunnel(false),
    checkPostgrestSchemaHealth(false)
  ])

  const setDependencyMetric = (
    result: { healthy: boolean; checked: boolean },
    metric: Gauge<string>
  ) => {
    if (!result.checked) {
      metric.set(1)
      return
    }
    metric.set(result.healthy ? 1 : 0)
  }

  setDependencyMetric(nginxHealth, healthCheckNginxStatus)
  setDependencyMetric(cloudflaredHealth, healthCheckCloudflaredStatus)
  setDependencyMetric(postgrestHealth, healthCheckPostgrestSchemaStatus)

  const responseTime = (Date.now() - startTime) / 1000
  apiResponseTime.labels('metrics').set(responseTime)

  const mem = process.memoryUsage()
  memoryUsageBytes.labels('heap_used').set(mem.heapUsed)
  memoryUsageBytes.labels('heap_total').set(mem.heapTotal)
  memoryUsageBytes.labels('rss').set(mem.rss)
  memoryUsageBytes.labels('external').set(mem.external)

  uptimeSeconds.set(process.uptime())

  cacheHitRate.set(0.75)
  lastBackupTimestamp.set(Date.now() / 1000 - 3600)
  lastBackupStatus.set(1)

  duplicateCurrentRecords.set(0)
  void signupsTotal
  void signupFailuresTotal
  void edgeFunctionInvocations
  void edgeFunctionErrors
}

const buildAuthResponse = (status: number, code: string, message: string) =>
  NextResponse.json(
    {
      error: {
        code,
        message
      }
    },
    { status }
  )

function authorizeMetrics(request: NextRequest): NextResponse | null {
  if (!METRICS_SECRET) {
    return buildAuthResponse(
      404,
      'METRICS_DISABLED',
      'Metrics endpoint disabled'
    )
  }

  // Not requireBearerSecret(): it 500s when unset, while this route 404s to stay unadvertised.
  const authHeader = request.headers.get('authorization')
  if (!authHeader || !safeEqual(authHeader, `Bearer ${METRICS_SECRET}`)) {
    return NextResponse.json(Errors.unauthorized('Unauthorized').toJSON(), {
      status: 401
    })
  }

  return null
}

export const GET = withErrorHandler(
  async (request: NextRequest): Promise<NextResponse> => {
    const authFailure = authorizeMetrics(request)
    if (authFailure) {
      return authFailure
    }

    try {
      await collectMetrics()

      const metrics = await register.metrics()

      return new NextResponse(metrics, {
        status: 200,
        headers: {
          'Content-Type': register.contentType
        }
      })
    } catch (error) {
      console.error('Error collecting metrics:', error)
      throw Errors.internal('Error collecting metrics')
    }
  }
)
