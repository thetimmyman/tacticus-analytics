import { NextResponse } from 'next/server'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import {
  SYNC_FEEDS,
  readFeed,
  resolveRaidCadenceSeconds
} from '@/app/lib/sync/feed-freshness'

const logger = createComponentLogger('api.sync.freshness')

export const dynamic = 'force-dynamic'

/** Session-derived guild (no param, so not a cross-guild oracle). Age uses last_successful_sync. */
export const GET = withErrorHandler(async () => {
  const { profile } = await requireActiveMembershipForApi()
  const guildCode = profile?.guild_code ?? null

  if (!guildCode) {
    return NextResponse.json(
      { feeds: [], guildCode: null, reason: 'no-guild' },
      { headers: { 'Cache-Control': 'private, no-store' } }
    )
  }

  const db = serviceDb()

  const raidResult = await db
    .from('guild_config')
    .select('last_successful_sync, realtime_sync, sync_tier')
    .eq('guild_code', guildCode)
    .maybeSingle()

  if (raidResult.error) {
    logger.warn({ err: raidResult.error }, 'raid sync freshness read failed')
  }

  const toMs = (value: string | null | undefined): number | null => {
    if (!value) return null
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }

  const lastByKey: Record<string, number | null> = {
    raid: toMs(raidResult.data?.last_successful_sync)
  }

  // An hourly guild judged by the realtime cron would read as a stopped feed forever.
  const raidCadenceSeconds = resolveRaidCadenceSeconds({
    realtimeSync: raidResult.data?.realtime_sync,
    syncTier: raidResult.data?.sync_tier
  })
  const cadenceByKey: Record<string, number> = { raid: raidCadenceSeconds }

  const nowMs = Date.now()
  const feeds = SYNC_FEEDS.map((definition) =>
    readFeed(
      definition,
      lastByKey[definition.key] ?? null,
      nowMs,
      cadenceByKey[definition.key]
    )
  )

  return NextResponse.json(
    { feeds, guildCode, serverTime: new Date(nowMs).toISOString() },
    { headers: { 'Cache-Control': 'private, no-store' } }
  )
})
