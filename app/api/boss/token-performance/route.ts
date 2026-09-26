/** /boss heatmap data for one (boss, level), all 3 encounters. */

import { NextRequest, NextResponse } from 'next/server'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { throwUserFacingError } from '@/app/lib/errors/user-facing'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { getBossLevelTokenPerformance } from '@/app/lib/data/boss-level-token-performance'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.boss.token-performance')

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const authData = await requireActiveMembershipForApi()
    const profile = authData.profile

    const searchParams = request.nextUrl.searchParams
    const requestedGuild = searchParams.get('guild_code')
    const profileGuild = profile.guild_code
    // Another guild's `?guild_code=` is silently clamped to the caller's own.
    const guildCode =
      requestedGuild && profileGuild && requestedGuild === profileGuild
        ? requestedGuild
        : profileGuild
    const season = searchParams.get('season')
    const bossName = searchParams.get('boss')
    const level = searchParams.get('level')
    const includePerLoop = searchParams.get('include_per_loop') === 'true'

    if (!guildCode || !season || !bossName || !level) {
      throwUserFacingError(
        'VALIDATION_ERROR',
        'guild_code, season, boss, and level are required',
        400,
        { component: 'boss-token-performance', action: 'validate_params' }
      )
    }

    const data = await getBossLevelTokenPerformance({
      guildCode,
      season,
      bossName,
      level,
      includePerLoop
    })
    return NextResponse.json(data)
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)

    logger.error({ err: error }, 'Error in boss-token-performance API:')

    throwUserFacingError(
      'HISTORICAL_DATA_FAILED',
      'Failed to fetch boss-level token performance data',
      500,
      { component: 'boss-token-performance', action: 'fetch_data' },
      { cause: error }
    )
  }
})
