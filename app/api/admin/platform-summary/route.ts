import { NextRequest, NextResponse } from 'next/server'
import { serviceDb } from '@/app/lib/db'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { withAdminGuards } from '@/app/api/admin/_lib/with-admin-guards'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

interface PlatformSummaryRow {
  registered_users: number
  clusters_with_guilds: number
  distinct_guilds_battle: number
  player_mappings: number
  distinct_players_battle: number
  boss_battle_records: number
  guild_war_battles: number
}

type SummaryRpcClient = {
  rpc(fn: 'get_platform_summary_metrics'): Promise<{
    data: PlatformSummaryRow[] | PlatformSummaryRow | null
    error: { message: string } | null
  }>
}

// The COUNT(DISTINCT) scans are expensive and the totals barely move.
let cache: { at: number; data: PlatformSummaryRow } | null = null
const TTL_MS = 5 * 60 * 1000
const ADMIN_UNAUTHORIZED_METADATA = { error: 'Unauthorized' }
const ADMIN_DENIED_METADATA = { error: 'Forbidden' }

export const GET = withAdminGuards(
  {
    guard: 'app-admin-session',
    unauthorizedMessage: 'Unauthorized',
    unauthorizedMetadata: ADMIN_UNAUTHORIZED_METADATA,
    deniedMessage: 'Forbidden',
    deniedMetadata: ADMIN_DENIED_METADATA
  },
  async (_request: NextRequest) => {
    const now = Date.now()
    if (cache && now - cache.at < TTL_MS) {
      return NextResponse.json({
        summary: cache.data,
        cachedAt: new Date(cache.at).toISOString()
      })
    }

    try {
      const svc = serviceDb() as unknown as SummaryRpcClient
      const { data, error } = await svc.rpc('get_platform_summary_metrics')

      if (error) {
        console.error('Platform summary RPC error:', error)
        throw Errors.fromResponse(500, { error: error.message })
      }

      const row = (Array.isArray(data) ? data[0] : data) as
        PlatformSummaryRow | undefined

      if (!row) {
        throw Errors.fromResponse(500, { error: 'No platform summary data' })
      }

      cache = { at: now, data: row }

      return NextResponse.json({
        summary: row,
        cachedAt: new Date(now).toISOString()
      })
    } catch (err) {
      rethrowIfAppError(err)
      console.error('Platform summary error:', err)
      throw Errors.fromResponse(500, { error: 'Internal server error' })
    }
  }
)
