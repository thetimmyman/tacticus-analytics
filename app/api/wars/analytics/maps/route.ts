import { NextRequest, NextResponse } from 'next/server'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.wars.analytics.maps')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'

export const GET = withErrorHandler(async (request: NextRequest) => {
  const { profile } = await requireActiveMembershipForApi()

  try {
    const guildCode = profile.guild_code

    if (!guildCode) {
      throw Errors.fromResponse(400, { error: 'No guild associated with user' })
    }

    const { searchParams } = new URL(request.url)
    const daysBack = parseInt(searchParams.get('days') || '30', 10)

    const supabase = serviceDb()

    const { data, error } = await supabase.rpc('get_zone_stats', {
      p_guild_code: guildCode,
      p_days_back: daysBack,
      p_season_count: undefined
    })

    if (error) {
      logger.error({ error, guildCode }, 'Failed to fetch zone stats')
      throw Errors.fromResponse(500, { error: 'Failed to fetch zone stats' })
    }

    // Raw `zone_type`: only the render site formats it. `zone_display_name`, `map_code` are legacy.
    return NextResponse.json({ maps: data ?? [] })
  } catch (err) {
    rethrowIfAppError(err)
    logger.error({ error: err }, 'Zone stats API error')
    throw Errors.fromResponse(500, { error: 'Internal server error' })
  }
})
