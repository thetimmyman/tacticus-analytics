import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.wars.analytics.cores')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { parseGuildWarAnalyticsQuery } from '../_query-helpers'
import {
  callGlobalWarMetaRpc,
  loadGlobalWarMetaFilters
} from '../_global-meta-rpc'

export const GET = withErrorHandler(async (request: NextRequest) => {
  await requireActiveMembershipForApi()

  try {
    const { searchParams } = new URL(request.url)
    const { side, limit, seasonCount, minUses, seasons, battlefieldLevels } =
      parseGuildWarAnalyticsQuery(searchParams, { limit: 100, minUses: 5 })
    const rawCoreSize = searchParams.get('core_size')
    const coreSize = rawCoreSize === null ? 3 : Number(rawCoreSize)

    if (!Number.isInteger(coreSize) || coreSize < 2 || coreSize > 5) {
      throw Errors.fromResponse(400, {
        error: 'core_size must be an integer between 2 and 5'
      })
    }

    const supabase = serviceDb()
    const [{ data, error }, filtersResult] = await Promise.all([
      callGlobalWarMetaRpc<unknown[]>(
        supabase,
        'get_global_war_core_compositions',
        {
          p_side: side,
          p_seasons: seasons ?? null,
          p_battlefield_levels: battlefieldLevels ?? null,
          p_min_uses: minUses,
          p_limit: limit,
          p_season_count: seasonCount,
          p_core_size: coreSize
        }
      ),
      loadGlobalWarMetaFilters(supabase)
    ])

    if (error) {
      // RPC not deployed or schema cache miss.
      if (error.code === '42883' || error.code === 'PGRST202') {
        logger.warn(
          { code: error.code, message: error.message },
          'get_global_war_core_compositions RPC unavailable'
        )
        return NextResponse.json({
          cores: [],
          filters: filtersResult.data ?? {
            seasons: [],
            battlefieldLevels: []
          }
        })
      }
      logger.error(
        { error: error.message, code: error.code, side },
        'Failed to fetch core compositions'
      )
      throw Errors.fromResponse(500, {
        error: `Failed to fetch core compositions: ${error.message}`
      })
    }

    if (filtersResult.error) {
      logger.warn(
        { error: filtersResult.error.message },
        'Failed to load global war meta filters'
      )
    }

    return NextResponse.json({
      cores: data || [],
      filters: filtersResult.data ?? { seasons: [], battlefieldLevels: [] }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ error }, 'Core compositions API error')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})
