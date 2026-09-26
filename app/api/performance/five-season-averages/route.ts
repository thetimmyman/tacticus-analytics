/** Service client because the SECURITY INVOKER RPC joins player_mapping; gated on membership. */

import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { requireGuildMember } from '@/app/lib/auth/guild-permissions'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { Errors } from '@/app/lib/errors/AppError'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('api.performance.five-season-averages')

const ENDPOINT = '/api/performance/five-season-averages'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams
  const guildCode = searchParams.get('guild')?.trim()
  const seasonParam = searchParams.get('season')

  if (!guildCode) {
    throw Errors.validation('guild query parameter is required')
  }

  const currentSeason = Number.parseInt(seasonParam ?? '', 10)
  if (!Number.isFinite(currentSeason) || currentSeason <= 0) {
    throw Errors.validation('season query parameter must be a positive number')
  }

  const supabase = await db()
  const user = await requireSessionUser(supabase, () =>
    Errors.unauthorized('Authentication required')
  )
  await requireGuildMember(supabase, user.id, guildCode, ENDPOINT)

  const { data, error } = await serviceDb().rpc(
    'get_player_five_season_averages',
    {
      p_guild_code: guildCode,
      p_current_season: currentSeason
    }
  )

  if (error) {
    logger.error(
      { guildCode, currentSeason, error },
      'get_player_five_season_averages RPC failed'
    )
    throw Errors.internal('Failed to load five-season averages', {
      endpoint: ENDPOINT
    })
  }

  return NextResponse.json(Array.isArray(data) ? data : [], {
    headers: { 'Cache-Control': 'private, no-store' }
  })
})
