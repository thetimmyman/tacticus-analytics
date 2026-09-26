import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/app/lib/db'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'

export const dynamic = 'force-dynamic'
import { getComprehensiveHistoricalPerformance } from '@/app/lib/data/historical-boss-performance'
import { requireRoleForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.upcoming.historical-performance')
import { throwUserFacingError } from '@/app/lib/errors/user-facing'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const authData = await requireRoleForApi('officer')
    const profile = authData.profile

    const searchParams = request.nextUrl.searchParams
    const guildCode = searchParams.get('guild_code') || profile.guild_code

    if (!guildCode) {
      throwUserFacingError('VALIDATION_ERROR', 'Guild code is required', 400, {
        component: 'historical-performance',
        action: 'validate_guild_code'
      })
    }

    const supabase = await db()
    await requireGuildOfficerOrClusterLeader(
      supabase,
      authData.user.id,
      guildCode,
      '/api/upcoming/historical-performance'
    )

    const performanceData =
      await getComprehensiveHistoricalPerformance(guildCode)

    return NextResponse.json(performanceData)
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)

    logger.error({ err: error }, 'Error in historical-performance API:')

    throwUserFacingError(
      'HISTORICAL_DATA_FAILED',
      'Failed to fetch historical performance data',
      500,
      { component: 'historical-performance', action: 'fetch_data' },
      { cause: error }
    )
  }
})
