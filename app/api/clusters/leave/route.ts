import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { requireAuthForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { isClusterLeaderRole } from '@/app/lib/auth/role-predicates'
import { apiSecurityMiddleware } from '@/app/lib/middleware/api-security-middleware'
import { guildIdentitiesMatch } from '@/app/api/clusters/_lib/guild-identity'

const logger = createComponentLogger('api.clusters.leave')

interface LeaveClusterBody {
  clusterCode?: unknown
}

interface LeaveRpcError {
  code?: string
  hint?: string | null
}

// The leader's guild leaves its cluster. Members keep their guild, roles and logins; the
// guild keeps syncing. leave_guild_cluster rechecks leadership under the guild row lock.
export const POST = withErrorHandler(async (request: NextRequest) => {
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: true,
    requiredRole: ['leader', 'Leader'],
    skipRateLimit: false
  })

  if (securityResult) return securityResult

  try {
    const { profile, user } = await requireAuthForApi()

    if (!isClusterLeaderRole(profile.role)) {
      throw Errors.fromResponse(403, {
        error: 'Only guild leaders can take their guild out of a cluster'
      })
    }

    let body: LeaveClusterBody
    try {
      body = (await request.json()) as LeaveClusterBody
    } catch {
      body = {}
    }
    const expectedClusterCode =
      typeof body.clusterCode === 'string' ? body.clusterCode.trim() : ''
    if (!expectedClusterCode) {
      throw Errors.fromResponse(400, {
        error: 'Missing required field: clusterCode'
      })
    }

    const supabase = await db()

    // requireAuthForApi() may be cached; privileged mutations use a fresh mapping read.
    const { data: currentMapping, error: mappingLookupError } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select('id, user_id, guild_code, role, is_current')
      .eq('id', profile.id)
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    if (mappingLookupError) {
      logger.error(
        { userId: user.id, failure: 'mapping_lookup_failed' },
        'Failed to verify current mapping for cluster leave'
      )
      throw Errors.fromResponse(500, {
        error: 'Guild leadership could not be verified.',
        code: 'CLUSTER_LEAVE_AUTHORITY_LOOKUP_FAILED'
      })
    }

    if (
      !currentMapping ||
      !isClusterLeaderRole(currentMapping.role) ||
      !currentMapping.guild_code
    ) {
      throw Errors.fromResponse(403, {
        error:
          'Only the current leader of the guild can take it out of a cluster'
      })
    }

    const { data: guild, error: guildLookupError } = await supabase
      .from('guild_config')
      .select('guild_code, cluster_id, cluster_code')
      .eq('guild_code', currentMapping.guild_code)
      .maybeSingle()

    if (guildLookupError) {
      logger.error(
        {
          guildCode: currentMapping.guild_code,
          failure: 'guild_lookup_failed'
        },
        'Failed to read guild for cluster leave'
      )
      throw Errors.fromResponse(500, {
        error: 'The guild could not be read.',
        code: 'CLUSTER_LEAVE_GUILD_LOOKUP_FAILED'
      })
    }

    if (!guild?.cluster_id || !guild.cluster_code) {
      throw Errors.fromResponse(409, {
        error: 'Your guild is not in a cluster.',
        code: 'CLUSTER_LEAVE_NOT_IN_CLUSTER'
      })
    }

    // The leader confirmed leaving one named cluster; a guild moved since then is not left.
    if (!guildIdentitiesMatch(guild.cluster_code, expectedClusterCode)) {
      throw Errors.fromResponse(409, {
        error:
          "Your guild's cluster has changed since this page loaded. Refresh and try again.",
        code: 'CLUSTER_LEAVE_CLUSTER_CHANGED'
      })
    }

    const { data: left, error: leaveError } = await serviceDb().rpc(
      'leave_guild_cluster',
      {
        p_guild_code: guild.guild_code,
        p_expected_cluster_id: guild.cluster_id,
        p_actor_user_id: user.id
      }
    )

    if (leaveError) {
      const { code, hint } = leaveError as LeaveRpcError
      if (code === '42501' && hint === 'cluster_creator') {
        throw Errors.fromResponse(403, {
          error:
            "You created this cluster, so your guild can't leave it. Ask an app admin to hand the cluster over first.",
          code: 'CLUSTER_LEAVE_CREATOR'
        })
      }
      if (code === '42501') {
        throw Errors.fromResponse(403, {
          error:
            'Only the current leader of the guild can take it out of a cluster',
          code: 'CLUSTER_LEAVE_FORBIDDEN'
        })
      }
      if (code === '55000') {
        throw Errors.fromResponse(409, {
          error:
            "Your guild's cluster has changed since this page loaded. Refresh and try again.",
          code: 'CLUSTER_LEAVE_CLUSTER_CHANGED'
        })
      }
      if (code === 'P0002') {
        throw Errors.fromResponse(404, {
          error: 'Your guild could not be found.',
          code: 'CLUSTER_LEAVE_GUILD_NOT_FOUND'
        })
      }
      logger.error(
        {
          guildCode: guild.guild_code,
          clusterId: guild.cluster_id,
          failure: 'leave_rpc_failed',
          pgCode: code
        },
        'leave_guild_cluster failed'
      )
      throw Errors.fromResponse(500, {
        error: 'The guild could not leave the cluster.',
        code: 'CLUSTER_LEAVE_FAILED'
      })
    }

    const receipt = Array.isArray(left) ? left[0] : null
    if (!receipt) {
      logger.error(
        {
          guildCode: guild.guild_code,
          clusterId: guild.cluster_id,
          failure: 'leave_receipt_missing'
        },
        'leave_guild_cluster returned no receipt'
      )
      throw Errors.fromResponse(500, {
        error:
          'The cluster leave outcome could not be verified. Refresh before retrying.',
        code: 'CLUSTER_LEAVE_STATE_UNKNOWN'
      })
    }

    logger.info(
      {
        guildCode: receipt.guild_code,
        clusterId: receipt.previous_cluster_id,
        clusterCode: receipt.previous_cluster_code,
        clearedMappings: receipt.cleared_mappings,
        userId: user.id
      },
      'Guild left its cluster'
    )

    return NextResponse.json({
      success: true,
      message: 'Your guild has left the cluster',
      guild: { guild_code: receipt.guild_code },
      previousCluster: { cluster_code: receipt.previous_cluster_code },
      clearedMappings: receipt.cleared_mappings,
      action: 'guild_left_cluster'
    })
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error(
      { failure: 'unhandled_cluster_leave_error' },
      'Error in cluster leave endpoint'
    )
    throw Errors.fromResponse(500, {
      error: 'The cluster leave could not be completed.',
      code: 'CLUSTER_LEAVE_INTERNAL_ERROR'
    })
  }
})
