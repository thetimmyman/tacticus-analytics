import { NextRequest, NextResponse } from 'next/server'
import { requireRoleForApi } from '@/app/lib/auth'
import { isAppAdminProfile } from '@/app/lib/auth/app-admin'
import { serviceDb } from '@/app/lib/db'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { createComponentLogger } from '@/app/lib/logging'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

const logger = createComponentLogger('api.cluster.guilds')

/** `"API_Owner"` is not granted to `authenticated`, so this reads as service role after proving leadership. */

const normalize = (value: string | null | undefined) =>
  value ? value.trim().toUpperCase() : null

const CLUSTER_GUILD_SELECT =
  'guild_code, guild_tag, display_name, user_id, "API_Owner", api_key_is_valid, api_key_last_validated, enabled, "GR_Ranking", "GW_Ranking", token_offender_threshold, token_abuser_threshold, cluster_code'

const resolveUserCluster = async (
  supabase: TypedSupabaseClient,
  profile: { cluster_code?: string | null; guild_code?: string | null }
) => {
  const derived = normalize(profile.cluster_code)
  if (derived) {
    return derived
  }

  const guildCode = normalize(profile.guild_code)
  if (!guildCode) {
    return null
  }

  const guildRow = await GuildConfigService.getBasic(supabase, guildCode)

  if (!guildRow) {
    logger.warn(
      { guildCode },
      'Failed to resolve user cluster from guild_config'
    )
  }

  return normalize(guildRow?.cluster_code)
}

export const GET = withErrorHandler(async (request: NextRequest) => {
  try {
    const auth = await requireRoleForApi('leader')
    const supabase = serviceDb()
    const derivedCluster = await resolveUserCluster(supabase, auth.profile)

    const requestedCluster = normalize(
      request.nextUrl.searchParams.get('cluster')
    )
    const targetCluster = requestedCluster ?? derivedCluster

    if (!targetCluster) {
      throw Errors.fromResponse(400, {
        success: false,
        error: 'Cluster code is required.'
      })
    }

    // Must use profile.is_app_admin: a role of 'admin' can come from client-writable user_metadata.
    const isAppAdmin = isAppAdminProfile(auth.profile)
    const hasMatchingCluster =
      derivedCluster !== null && derivedCluster === targetCluster

    if (!hasMatchingCluster && !isAppAdmin) {
      throw Errors.fromResponse(403, {
        success: false,
        error: 'Access denied for this cluster.'
      })
    }

    const { data, error } = await supabase
      .from('guild_config')
      .select(CLUSTER_GUILD_SELECT)
      .eq('cluster_code', targetCluster)
      .not('cluster_code', 'is', null)
      .order('guild_code')

    if (error) {
      logger.error(
        { cluster: targetCluster, error: error.message },
        'Failed to load cluster guild directory'
      )
      throw Errors.fromResponse(500, {
        success: false,
        error: 'Unable to load guild directory.'
      })
    }

    return NextResponse.json(
      {
        success: true,
        data: { clusterCode: targetCluster, guilds: data ?? [] }
      },
      { status: 200 }
    )
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error, { successFalseEnvelope: true })
    logger.error({ error }, 'Unexpected error in cluster guilds route')
    throw Errors.fromResponse(500, {
      success: false,
      error: 'Unexpected server error.'
    })
  }
})
