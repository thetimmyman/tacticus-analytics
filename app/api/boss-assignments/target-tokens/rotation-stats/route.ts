/** The math behind target tokens for the current rotation. Any guild member may read. */

import { NextRequest, NextResponse } from 'next/server'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { requireActiveMembershipForApi } from '@/app/lib/auth'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { db } from '@/app/lib/db'
import { requireGuildMember } from '@/app/lib/auth/guild-permissions'
import { getCurrentRotationBossStats } from '@/app/lib/data/guild-boss-rotation-stats'
import { parseSeasonParam } from '@/app/lib/boss-assignments/target-token-season'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger(
  'api.boss-assignments.target-tokens.rotation-stats'
)

export const dynamic = 'force-dynamic'

const ENDPOINT = '/api/boss-assignments/target-tokens/rotation-stats'

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const authData = await requireActiveMembershipForApi()
    const profile = authData.profile
    const searchParams = request.nextUrl.searchParams
    const requestedGuild = searchParams.get('guild_code')
    const guildCode = requestedGuild ?? profile.guild_code
    if (!guildCode) {
      throw Errors.fromStatus(400, 'guild_code required', {
        code: 'VALIDATION_ERROR'
      })
    }
    const supabase = await db()
    // profile.guild_code may be stale.
    await requireGuildMember(supabase, authData.user.id, guildCode, ENDPOINT)

    const season = parseSeasonParam(searchParams.get('season'))
    if (!season) {
      throw Errors.fromStatus(400, 'season must be a positive integer string', {
        code: 'VALIDATION_ERROR'
      })
    }

    const stats = await getCurrentRotationBossStats(supabase, guildCode, season)
    return NextResponse.json({ stats })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error({ err: error }, 'Error in target-tokens/rotation-stats GET:')
    throw Errors.fromStatus(500, 'Internal error', { code: 'INTERNAL_ERROR' })
  }
})
