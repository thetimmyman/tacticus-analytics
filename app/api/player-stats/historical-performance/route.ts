import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { type NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.player-stats.historical-performance')
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { fetchHistoricalPerformance } from '@/app/lib/player-stats/fetchHistoricalPerformance'

function parseRequest(request: NextRequest) {
  const url = new URL(request.url)
  const playerName = url.searchParams.get('player') || ''
  const guildCode = url.searchParams.get('guild_code') || ''
  const season = url.searchParams.get('season') || ''
  const playerClusterCode = url.searchParams.get('cluster_code') || null

  if (!playerName || !guildCode || !season) {
    throw Errors.fromResponse(400, {
      error: 'player, guild_code, and season are required'
    })
  }

  return { playerName, guildCode, season, playerClusterCode }
}

function logTiming(
  clientCreatedAt: number,
  fetchStartedAt: number,
  fetchFinishedAt: number
) {
  logger.info(
    {
      createClientMs: Math.round(fetchStartedAt - clientCreatedAt),
      fetchMs: Math.round(fetchFinishedAt - fetchStartedAt),
      totalMs: Math.round(fetchFinishedAt - clientCreatedAt),
      supabaseConnection: process.env.SUPABASE_URL
        ? 'internal'
        : 'public-fallback'
    },
    'Historical performance query timing'
  )
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  // Deliberately not guild-bound: cross-guild comparison is a feature; RLS decides raw-data reads.
  await requireActiveMembershipForApi()

  const params = parseRequest(request)

  const requestStartedAt = performance.now()
  const supabase = await db()
  const fetchStartedAt = performance.now()

  try {
    const data = await fetchHistoricalPerformance({
      supabase,
      ...params
    })
    const fetchFinishedAt = performance.now()

    logTiming(requestStartedAt, fetchStartedAt, fetchFinishedAt)

    return NextResponse.json(data)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      {
        err: error
      },
      'Historical performance API error'
    )
    throw Errors.fromResponse(500, {
      error: 'Failed to fetch historical performance'
    })
  }
})
