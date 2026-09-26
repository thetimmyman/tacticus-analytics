import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import {
  callGlobalWarMetaRpc,
  loadGlobalWarMetaFilters
} from '../_global-meta-rpc'
import { parseGuildWarAnalyticsQuery } from '../_query-helpers'

const logger = createComponentLogger('api.wars.analytics.lineups')

export const GET = withErrorHandler(async (request: NextRequest) => {
  await requireActiveMembershipForApi()

  try {
    const { side, limit, seasonCount, seasons, battlefieldLevels, minUses } =
      parseGuildWarAnalyticsQuery(new URL(request.url).searchParams, {
        limit: 100,
        minUses: 3
      })
    const supabase = serviceDb()
    const [{ data, error }, filtersResult] = await Promise.all([
      callGlobalWarMetaRpc<unknown[]>(supabase, 'get_global_war_lineup_stats', {
        p_side: side,
        p_seasons: seasons ?? null,
        p_battlefield_levels: battlefieldLevels ?? null,
        p_limit: limit,
        p_min_uses: minUses,
        p_season_count: seasonCount
      }),
      loadGlobalWarMetaFilters(supabase)
    ])

    if (error) {
      logger.error({ error, side }, 'Failed to fetch global lineup stats')
      throw Errors.fromResponse(500, {
        error: 'Failed to fetch lineup stats'
      })
    }
    if (filtersResult.error) {
      logger.warn(
        { error: filtersResult.error.message },
        'Failed to load global war meta filters'
      )
    }

    return NextResponse.json({
      lineups: data || [],
      filters: filtersResult.data ?? { seasons: [], battlefieldLevels: [] }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Lineup stats API error')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})
