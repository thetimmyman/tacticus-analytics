import { NextRequest, NextResponse } from 'next/server'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-raid.season-plan.generate')
import { generateSeasonPlanForGuild } from '@/app/lib/boss-assignments/season-planner/generate-season-plan'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import {
  clampInt,
  requireSeasonPlanOfficerContext,
  resolveSeasonPlanSeason,
  toPositiveInt
} from '../_shared'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const { profile } = await requireSeasonPlanOfficerContext({
      requireFeatureAccess: true
    })

    const searchParams = request.nextUrl.searchParams
    const season = await resolveSeasonPlanSeason(searchParams.get('season'))
    const snapshotAt =
      searchParams.get('snapshot_at') || new Date().toISOString()
    const lookbackDays = clampInt(
      toPositiveInt(searchParams.get('lookback_days'), 30),
      1,
      180
    )
    const sessionsPerDay = clampInt(
      toPositiveInt(searchParams.get('sessions_per_day'), 1),
      1,
      3
    )
    const timeZone = searchParams.get('time_zone')
    // A non-live season is planned against its selected config's rotation.
    const configId = searchParams.get('config_id')

    const result = await generateSeasonPlanForGuild({
      guildCode: profile.guild_code,
      season,
      snapshotAt,
      lookbackDays,
      sessionsPerDay,
      timeZone,
      configId
    })

    return NextResponse.json(result)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Error generating season plan:')
    throw Errors.fromResponse(500, {
      error: 'Internal server error',
      details: error instanceof Error ? error.message : 'Unknown error'
    })
  }
})
