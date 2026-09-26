/** Per (player, boss) token performance for the badges on /boss-assignments and /upcoming. */

import { NextRequest, NextResponse } from 'next/server'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { db } from '@/app/lib/db'
import { requireRoleForApi } from '@/app/lib/auth'
import { requireGuildOfficerOrClusterLeader } from '@/app/lib/auth/guild-permissions'
import { CLUSTER_LOOKUP_SELECT } from '@/app/lib/guild-config-selects'
import { throwUserFacingError } from '@/app/lib/errors/user-facing'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { getGuildTokenPerformance } from '@/app/lib/data/guild-token-performance'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.upcoming.token-performance')

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const authData = await requireRoleForApi('officer')
    const profile = authData.profile

    const searchParams = request.nextUrl.searchParams
    const guildCode = searchParams.get('guild_code') || profile.guild_code
    const seasonParam = searchParams.get('season')
    const compareModeParam =
      searchParams.get('compare_mode') === 'cluster' ? 'cluster' : 'guild'
    // Comma-separated; defaults to Legendary,Mythic.
    const raritiesParamRaw = searchParams.get('rarities')
    const raritiesParam = raritiesParamRaw
      ? raritiesParamRaw
          .split(',')
          .filter(
            (r): r is 'Legendary' | 'Mythic' =>
              r === 'Legendary' || r === 'Mythic'
          )
      : undefined
    const includePerLoop = searchParams.get('include_per_loop') === 'true'
    const includeHistoricalPlayers =
      searchParams.get('include_historical_players') === 'true'
    // Opt-in: Player Performance includes primes; assignment badges are main-boss only.
    const includePrimes = searchParams.get('include_primes') === 'true'

    if (!guildCode) {
      throwUserFacingError('VALIDATION_ERROR', 'Guild code is required', 400, {
        component: 'token-performance',
        action: 'validate_guild_code'
      })
    }

    const supabase = await db()
    await requireGuildOfficerOrClusterLeader(
      supabase,
      authData.user.id,
      guildCode,
      '/api/upcoming/token-performance'
    )
    const { data: guildConfig, error: guildConfigError } = await supabase
      .from('guild_config')
      .select(CLUSTER_LOOKUP_SELECT)
      .eq('guild_code', guildCode)
      .maybeSingle()
    if (guildConfigError || !guildConfig) {
      throwUserFacingError(
        'ACCESS_DENIED',
        'Unable to authorize the requested guild',
        403,
        { component: 'token-performance', action: 'resolve_guild_scope' }
      )
    }

    const data = await getGuildTokenPerformance(guildCode, {
      seasonOverride: seasonParam || null,
      compareMode: compareModeParam,
      // The target guild's guild_config row, not query/profile copies, decides the cohort.
      clusterCode: guildConfig.cluster_code ?? null,
      rarities: raritiesParam,
      includePerLoop,
      includeHistoricalPlayers,
      includePrimes
    })
    return NextResponse.json(data)
  } catch (error: unknown) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)

    logger.error({ err: error }, 'Error in token-performance API:')

    throwUserFacingError(
      'HISTORICAL_DATA_FAILED',
      'Failed to fetch token performance data',
      500,
      { component: 'token-performance', action: 'fetch_data' },
      { cause: error }
    )
  }
})
