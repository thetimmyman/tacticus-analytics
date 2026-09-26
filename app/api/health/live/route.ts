import { NextResponse } from 'next/server'
import { captureSentryMessage } from '@/app/lib/monitoring/sentry'

export const dynamic = 'force-dynamic'

/** 3 s timeout = degraded. HEAD, not GET: fetching the OpenAPI schema on every probe OOMs Kong. */
export async function GET() {
  const supabaseUrl = process.env.SUPABASE_URL
  if (!supabaseUrl) {
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 3000)

  try {
    await fetch(`${supabaseUrl}/rest/v1/`, {
      method: 'HEAD',
      signal: controller.signal,
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '' }
    })
    clearTimeout(timeoutId)
    return NextResponse.json({ status: 'ok' }, { status: 200 })
  } catch (error) {
    clearTimeout(timeoutId)
    const isTimeout = error instanceof Error && error.name === 'AbortError'
    if (isTimeout) {
      // 503 so the container is restarted.
      console.error(
        '[health/live] Fetch pool degraded — timeout after 3s, returning 503'
      )
      captureSentryMessage(
        'Fetch pool degraded — liveness probe timeout after 3s',
        {
          level: 'error',
          tags: { component: 'health-live', reason: 'fetch_pool_timeout' }
        }
      )
      return NextResponse.json(
        { status: 'degraded', reason: 'fetch_pool_timeout' },
        { status: 503 }
      )
    }
    // Upstream errors; restarting this process would not help.
    return NextResponse.json(
      { status: 'ok', note: 'upstream_unreachable' },
      { status: 200 }
    )
  }
}
