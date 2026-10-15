import { NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { requireAuthForApi } from '@/app/lib/auth'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'

export const dynamic = 'force-dynamic'

const POLL_CADENCE_SECONDS = 60

export type TelemetryResponse = {
  /** Legacy key: latest recorded successful sync, not a physical poll time. */
  last_poll_at: string | null
  /** Legacy nominal interval, not measured feed cadence. */
  poll_cadence_seconds: number
  /** Legacy key: filtered webhook log rows, not provider HTTP calls. */
  api_calls_24h: number
  /** Failed rows in the same webhook log population. */
  errors_24h: number
}

// Auth-gated as defence in depth (aggregate-only, but a service-role reader).
export const GET = withErrorHandler(async () => {
  await requireAuthForApi()

  try {
    const supabase = serviceDb()
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // Keep suppression and manual aggregate audits outside these log counts.
    const [latestSync, totalLogs, failedLogs] = await Promise.all([
      supabase
        .from('sync_health')
        .select('last_successful_sync')
        .order('last_successful_sync', { ascending: false, nullsFirst: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from('discord_webhook_logs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since)
        .eq('suppressed_by_master_toggle', false)
        .eq('manual_override', false),
      supabase
        .from('discord_webhook_logs')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since)
        .eq('suppressed_by_master_toggle', false)
        .eq('manual_override', false)
        .eq('status', 'failed')
    ])

    // Failed or uncounted reads cannot establish a measured zero.
    if (
      latestSync.error ||
      totalLogs.error ||
      failedLogs.error ||
      totalLogs.count === null ||
      totalLogs.count === undefined ||
      failedLogs.count === null ||
      failedLogs.count === undefined
    ) {
      throw new Error('Telemetry query unavailable')
    }

    const body: TelemetryResponse = {
      last_poll_at: latestSync.data?.last_successful_sync ?? null,
      poll_cadence_seconds: POLL_CADENCE_SECONDS,
      api_calls_24h: totalLogs.count,
      errors_24h: failedLogs.count
    }

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'no-store' }
    })
  } catch (error) {
    console.error('[health/telemetry] error', error)
    return NextResponse.json(
      { error: 'telemetry_unavailable' },
      { status: 503 }
    )
  }
})
