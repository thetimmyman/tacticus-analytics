import { NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'

export const dynamic = 'force-dynamic'

const STALE_THRESHOLD_MINUTES = 10
const STOPPED_THRESHOLD_MINUTES = 60
const ERROR_YELLOW_THRESHOLD = 5
const ERROR_RED_THRESHOLD = 50
// Failures degrade the pill only while active: within this window and no delivery since.
const FAILURE_ACTIVE_WINDOW_MINUTES = 120

export type StatusState = 'green' | 'yellow' | 'red'

export type StatusResponse = {
  state: StatusState
  summary: string
}

export async function GET() {
  try {
    const supabase = serviceDb()
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()

    // Aggregate manual-override rows are not Discord requests: excluded from the failure count, kept
    // in latest-outcome ordering.
    const [latestSync, failedLogs, lastFailure, lastDelivery] =
      await Promise.all([
        supabase
          .from('sync_health')
          .select('last_successful_sync')
          .order('last_successful_sync', {
            ascending: false,
            nullsFirst: false
          })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('discord_webhook_logs')
          .select('id', { count: 'exact', head: true })
          .gte('created_at', since)
          .eq('manual_override', false)
          .eq('status', 'failed'),
        supabase
          .from('discord_webhook_logs')
          .select('created_at')
          .eq('status', 'failed')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('discord_webhook_logs')
          .select('created_at')
          .eq('status', 'delivered')
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()
      ])

    const lastPoll = latestSync.data?.last_successful_sync
    const errorsRaw = failedLogs.count ?? 0
    const ageMinutes = lastPoll
      ? (Date.now() - new Date(lastPoll).getTime()) / 60_000
      : Infinity

    const lastFailureAt = lastFailure.data?.created_at
      ? new Date(lastFailure.data.created_at).getTime()
      : null
    const lastDeliveryAt = lastDelivery.data?.created_at
      ? new Date(lastDelivery.data.created_at).getTime()
      : null
    const failureAgeMinutes =
      lastFailureAt !== null ? (Date.now() - lastFailureAt) / 60_000 : Infinity
    const recoveredBySuccess =
      lastFailureAt !== null &&
      lastDeliveryAt !== null &&
      lastDeliveryAt > lastFailureAt
    const failureStreamActive =
      failureAgeMinutes < FAILURE_ACTIVE_WINDOW_MINUTES && !recoveredBySuccess
    const errors = failureStreamActive ? errorsRaw : 0

    let state: StatusState = 'green'
    const reasons: string[] = []

    if (
      ageMinutes >= STOPPED_THRESHOLD_MINUTES ||
      errors >= ERROR_RED_THRESHOLD
    ) {
      state = 'red'
      if (ageMinutes >= STOPPED_THRESHOLD_MINUTES) {
        reasons.push(
          ageMinutes === Infinity
            ? 'No successful sync recorded'
            : `Last sync ${Math.round(ageMinutes)}m ago`
        )
      }
      if (errors >= ERROR_RED_THRESHOLD) {
        reasons.push(`${errors} webhook errors in 24h`)
      }
    } else if (
      ageMinutes >= STALE_THRESHOLD_MINUTES ||
      errors >= ERROR_YELLOW_THRESHOLD
    ) {
      state = 'yellow'
      if (ageMinutes >= STALE_THRESHOLD_MINUTES) {
        reasons.push(`Last sync ${Math.round(ageMinutes)}m ago`)
      }
      if (errors >= ERROR_YELLOW_THRESHOLD) {
        reasons.push(`${errors} webhook errors in 24h`)
      }
    } else {
      reasons.push(
        lastPoll
          ? `Last sync ${Math.round(ageMinutes)}m ago`
          : 'No sync data yet'
      )
      if (errors > 0) {
        reasons.push(`${errors} errors in 24h`)
      } else if (errorsRaw > 0) {
        reasons.push(
          recoveredBySuccess
            ? `${errorsRaw} webhook errors in 24h (recovered — deliveries succeeding)`
            : `${errorsRaw} webhook errors in 24h (ceased ${Math.round(failureAgeMinutes)}m ago)`
        )
      }
    }

    const body: StatusResponse = {
      state,
      summary: reasons.join(' · ')
    }

    return NextResponse.json(body, {
      headers: { 'Cache-Control': 'no-store' }
    })
  } catch (error) {
    console.error('[health/status] error', error)
    return NextResponse.json(
      { state: 'red' as StatusState, summary: 'Status check failed' },
      { status: 503 }
    )
  }
}
