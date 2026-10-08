import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/app/lib/auth/server'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-tokens')
import { loadGuildTokenStatuses } from '@/app/api/guild-tokens/token-service'
import { Errors } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'
import { requireTokenSeason } from '@/app/api/members/token-usage/parameters'

export const dynamic = 'force-dynamic'

export const GET = withErrorHandler(async (request: NextRequest) => {
  const searchParams = request.nextUrl.searchParams
  const requestedGuildCode = searchParams.get('guild')
  const season = searchParams.get('season')

  if (!requestedGuildCode) {
    throw Errors.validation('Guild code is required')
  }
  if (season) requireTokenSeason(season)
  const desktop = getRuntimeProfile() === 'desktop'

  const authClient = await createClient()

  const user = await requireSessionUser(authClient, () =>
    Errors.unauthorized('Authentication required')
  )

  const { data: userProfile, error: profileError } = await authClient
    .from('player_with_cluster')
    .select('guild_code, role, cluster_code')
    .eq('user_id', user.id)
    .eq('is_current', true)
    .single()

  if (profileError || !userProfile) {
    logger.warn(
      {
        userId: user.id,
        error: profileError?.message
      },
      'Guild tokens access denied: profile not found'
    )
    throw Errors.forbidden('Profile not found or access denied')
  }

  const userRole = userProfile.role || 'member'
  const isOfficerOrLeader = canManageHeraldRole(userRole)

  if (!isOfficerOrLeader) {
    throw Errors.forbidden('Insufficient permissions')
  }

  if (!userProfile.guild_code) {
    throw Errors.forbidden('Guild association required')
  }

  // Desktop reads retain the signed caller's RLS scope; hosted reads use the service client.
  const supabase = desktop ? authClient : serviceDb()

  const guildConfig = await GuildConfigService.getBasic(
    supabase,
    requestedGuildCode
  )

  if (!guildConfig) {
    throw Errors.notFound('Guild')
  }

  const guildCode = guildConfig.guild_code

  const clusterCode = guildConfig.cluster_code

  const userClusterCode = userProfile.cluster_code || null
  const userGuildCode = userProfile.guild_code
  const sameGuild =
    normalizeGuildIdentifier(userGuildCode) ===
    normalizeGuildIdentifier(guildCode)
  const sameCluster =
    clusterCode && userClusterCode && userClusterCode === clusterCode

  if (
    !sameGuild &&
    clusterCode &&
    userClusterCode &&
    userClusterCode !== clusterCode
  ) {
    throw Errors.forbidden('Access denied - different cluster')
  }

  if (!sameGuild && !sameCluster) {
    throw Errors.forbidden('Access denied - guild mismatch')
  }

  // Live Tacticus overlay only on ?live=true; cron keeps the DB fresh.
  const wantLive = searchParams.get('live') === 'true'
  if (desktop && wantLive) {
    throw Errors.forbidden(
      'Live token acquisition is unavailable on cached reads'
    )
  }

  const { players, debug } = await loadGuildTokenStatuses(supabase, {
    guildCode,
    season,
    clusterCode,
    skipLiveOverlay: desktop || !wantLive
  })

  return NextResponse.json(
    {
      players,
      cluster: clusterCode,
      debug,
      ...(desktop
        ? { read_mode: 'cached', computed_at: new Date().toISOString() }
        : {})
    },
    desktop ? { headers: { 'Cache-Control': 'no-store' } } : undefined
  )
})
