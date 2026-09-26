import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { requireAuthForApi } from '@/app/lib/auth'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.clusters.join')
import { encryptApiKey } from '@tacticus/app-core/encryption'
import {
  rethrowIfAuthError,
  withErrorHandler
} from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { isClusterLeaderRole } from '@/app/lib/auth/role-predicates'
import {
  validateApiKeyWithTacticus,
  generateApiKeyUpdatePayload
} from '@tacticus/app-core/api-key-validation'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { validateInviteCode } from '@/app/lib/utils/invite-codes'
import {
  writeAndReconcileGuildAuthority,
  type GuildAuthorityTarget
} from '@/app/api/clusters/_lib/membership-authority'
import { completeClusterAuthoritySequence } from '@/app/api/clusters/_lib/authority-sequence'
import {
  apiKeyProvesGuild,
  canonicalizeGuildCode,
  findGuildByIdentity,
  guildIdentitiesMatch,
  nullableGuildIdentitiesMatch
} from '@/app/api/clusters/_lib/guild-identity'

interface JoinClusterData {
  inviteCode: string
  guildData: {
    guildCode: string
    displayName: string
    leaderEmail?: string
    apiKey?: string
    tagline?: string
    description?: string
    logoUrl?: string
  }
}

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
        error: 'Only guild leaders can join clusters'
      })
    }

    const body: JoinClusterData = await request.json()
    const { inviteCode, guildData } = body

    if (
      !inviteCode ||
      !guildData?.guildCode?.trim() ||
      !guildData?.displayName?.trim()
    ) {
      throw Errors.fromResponse(400, {
        error: 'Missing required fields: inviteCode, guildCode, displayName'
      })
    }

    const supabase = await db()

    // requireAuthForApi() may be cached; privileged mutations use a fresh mapping read.
    const { data: currentMapping, error: mappingLookupError } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select(
        'id, user_id, guild_code, cluster_id, cluster_code, role, is_current'
      )
      .eq('id', profile.id)
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    if (mappingLookupError) {
      logger.error(
        {
          userId: user.id,
          failure: 'mapping_lookup_failed'
        },
        'Failed to verify current mapping for cluster join'
      )
      throw Errors.fromResponse(500, {
        error: 'Guild leadership could not be verified.',
        code: 'CLUSTER_JOIN_AUTHORITY_LOOKUP_FAILED'
      })
    }

    if (
      !currentMapping ||
      !isClusterLeaderRole(currentMapping.role) ||
      !currentMapping.guild_code
    ) {
      throw Errors.fromResponse(403, {
        error: 'Only the current mapped guild leader can join a cluster'
      })
    }

    const { valid, cluster } = await validateInviteCode(inviteCode)
    if (!valid || !cluster?.id || !cluster.cluster_code) {
      throw Errors.fromResponse(400, {
        error: 'Invalid invite code',
        code: 'CLUSTER_JOIN_INVALID_INVITE'
      })
    }

    // Reads stay on the session client; vetted authority writes go through one service client.
    const authority = serviceDb()

    // Codes/tags only discover a candidate row; they never authorize a service write.
    const requestedGuildCode = canonicalizeGuildCode(guildData.guildCode)
    const confirmed = await findGuildByIdentity(supabase, requestedGuildCode)
    if (confirmed.error) {
      logger.error(
        {
          guildCode: guildData.guildCode,
          failure: 'guild_identity_lookup_failed'
        },
        'Failed to verify guild identity for cluster join'
      )
      throw Errors.fromResponse(500, {
        error: 'Guild ownership could not be verified.',
        code: 'CLUSTER_JOIN_GUILD_LOOKUP_FAILED'
      })
    }
    let existingGuild = confirmed.guild

    // An API key's guild_id may resolve a candidate row, but never grants write authority.
    let preValidatedApiKey: Awaited<
      ReturnType<typeof validateApiKeyWithTacticus>
    > | null = null
    if (!existingGuild && guildData.apiKey) {
      preValidatedApiKey = await validateApiKeyWithTacticus(
        guildData.apiKey.trim(),
        false
      )
      if (preValidatedApiKey.isValid && preValidatedApiKey.guildInfo?.guildId) {
        const byId = await findGuildByIdentity(
          supabase,
          preValidatedApiKey.guildInfo.guildId
        )
        if (byId.error) {
          logger.error(
            {
              guildId: preValidatedApiKey.guildInfo.guildId,
              failure: 'guild_identity_lookup_failed'
            },
            'Failed to verify API-key guild identity for cluster join'
          )
          throw Errors.fromResponse(500, {
            error: 'Guild ownership could not be verified.',
            code: 'CLUSTER_JOIN_GUILD_LOOKUP_FAILED'
          })
        }
        existingGuild = byId.guild
      }
    }

    // The canonical code, so updates hit the right row when the user typed a tag.
    const canonicalGuildCode = existingGuild?.guild_code ?? requestedGuildCode

    if (existingGuild) {
      // A readable API key is not ownership; existing-row writes require a fresh leader mapping.
      if (
        !guildIdentitiesMatch(
          currentMapping.guild_code,
          existingGuild.guild_code
        )
      ) {
        throw Errors.fromResponse(409, {
          error: `Guild code "${guildData.guildCode}" is already taken by another guild`
        })
      }

      if (!guildData.apiKey) {
        throw Errors.fromResponse(400, {
          error:
            'A guild API key is required to verify the existing guild identity'
        })
      }

      const validationResult =
        preValidatedApiKey ??
        (await validateApiKeyWithTacticus(guildData.apiKey.trim(), false))
      if (!validationResult.isValid) {
        throw Errors.fromResponse(400, {
          error: 'API key validation failed',
          code: 'CLUSTER_JOIN_API_KEY_INVALID',
          suggestion:
            'Please ensure your API key has both Guild and Guild Raid permissions'
        })
      }

      const storedGuildId = existingGuild.guild_id
      const liveGuildId = validationResult.guildInfo?.guildId
      if (!storedGuildId || !liveGuildId) {
        throw Errors.fromResponse(400, {
          error:
            'Existing guild identity is incomplete; contact support before joining a cluster'
        })
      }
      if (!guildIdentitiesMatch(storedGuildId, liveGuildId)) {
        throw Errors.fromResponse(400, {
          error: 'The API key belongs to a different guild'
        })
      }

      const encryptedKey = await encryptApiKey(guildData.apiKey)
      const apiKeyFields = generateApiKeyUpdatePayload(
        encryptedKey,
        validationResult,
        undefined
      )

      let guildAssignment = authority
        .from('guild_config')
        .update({
          cluster_id: cluster.id,
          cluster_code: cluster.cluster_code,
          is_cluster: true,
          display_name: guildData.displayName,
          tagline: guildData.tagline,
          description: guildData.description,
          logo_url: guildData.logoUrl,
          ...apiKeyFields,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingGuild.id)
        .eq('guild_code', canonicalGuildCode)
        .eq('guild_id', storedGuildId)

      guildAssignment =
        existingGuild.cluster_id != null
          ? guildAssignment.eq('cluster_id', existingGuild.cluster_id)
          : guildAssignment.is('cluster_id', null)
      guildAssignment =
        existingGuild.cluster_code != null
          ? guildAssignment.eq('cluster_code', existingGuild.cluster_code)
          : guildAssignment.is('cluster_code', null)
      guildAssignment =
        existingGuild.is_cluster != null
          ? guildAssignment.eq('is_cluster', existingGuild.is_cluster)
          : guildAssignment.is('is_cluster', null)

      const guildTarget: GuildAuthorityTarget = {
        guild_code: canonicalGuildCode,
        guild_id: storedGuildId,
        cluster_id: cluster.id,
        cluster_code: cluster.cluster_code,
        is_cluster: true
      }
      const guildOutcome = await writeAndReconcileGuildAuthority(
        authority,
        { mode: 'existing', prior: existingGuild },
        guildTarget,
        async () => {
          const { data, error } = await guildAssignment
            .select(
              'id, guild_code, guild_id, cluster_id, cluster_code, is_cluster, display_name'
            )
            .maybeSingle()
          return { data, error }
        }
      )

      if (guildOutcome.state === 'unknown') {
        logger.error(
          {
            guildCode: canonicalGuildCode,
            guildId: storedGuildId,
            inputGuildCode: guildData.guildCode,
            clusterId: cluster.id,
            writeOutcome: guildOutcome.writeOutcome,
            readOutcome: guildOutcome.readOutcome
          },
          'Existing guild state is unknown after cluster assignment'
        )
        throw Errors.fromResponse(500, {
          error:
            'The guild assignment outcome could not be verified. Contact support before retrying.',
          code: 'CLUSTER_JOIN_GUILD_STATE_UNKNOWN'
        })
      }

      if (guildOutcome.state !== 'target') {
        logger.error(
          {
            guildCode: canonicalGuildCode,
            guildId: storedGuildId,
            inputGuildCode: guildData.guildCode,
            clusterId: cluster.id,
            writeOutcome: guildOutcome.writeOutcome,
            readOutcome: guildOutcome.readOutcome
          },
          'Failed to update existing guild for cluster join'
        )
        throw Errors.fromResponse(500, {
          error: 'The guild could not be assigned to the cluster.',
          code: 'CLUSTER_JOIN_GUILD_UPDATE_FAILED'
        })
      }

      const targetCluster = {
        id: cluster.id,
        cluster_code: cluster.cluster_code,
        guild_code: canonicalGuildCode
      }
      const mappingOutcome = await completeClusterAuthoritySequence({
        authority,
        currentMapping,
        userId: user.id,
        clusterTarget: targetCluster
      })

      if (mappingOutcome.state === 'unknown') {
        logger.error(
          {
            userId: user.id,
            guildId: existingGuild.id,
            guildCode: canonicalGuildCode,
            clusterId: cluster.id,
            patchOutcome: mappingOutcome.patchOutcome,
            readOutcome: mappingOutcome.readOutcome
          },
          'Current mapping state is unknown after existing-guild cluster join'
        )
        throw Errors.fromResponse(500, {
          error:
            'The membership update outcome could not be verified. Contact support before retrying.',
          code: 'CLUSTER_JOIN_MAPPING_STATE_UNKNOWN'
        })
      }

      if (mappingOutcome.state === 'prior') {
        logger.error(
          {
            userId: user.id,
            guildId: existingGuild.id,
            guildCode: canonicalGuildCode,
            clusterId: cluster.id,
            patchOutcome: mappingOutcome.patchOutcome,
            readOutcome: mappingOutcome.readOutcome
          },
          'Failed to align current mapping after existing-guild cluster join'
        )

        const guildRollback = authority
          .from('guild_config')
          .update({
            cluster_id: existingGuild.cluster_id,
            cluster_code: existingGuild.cluster_code,
            is_cluster: existingGuild.is_cluster,
            updated_at: new Date().toISOString()
          })
          .eq('id', existingGuild.id)
          .eq('guild_code', canonicalGuildCode)
          .eq('guild_id', storedGuildId)
          .eq('cluster_id', cluster.id)
          .eq('cluster_code', cluster.cluster_code)
          .eq('is_cluster', true)

        const { data: restoredGuild, error: rollbackError } =
          await guildRollback
            .select(
              'id, guild_code, guild_id, cluster_id, cluster_code, is_cluster'
            )
            .maybeSingle()

        const rollbackWitnessMatches =
          restoredGuild?.id === existingGuild.id &&
          guildIdentitiesMatch(restoredGuild.guild_code, canonicalGuildCode) &&
          guildIdentitiesMatch(restoredGuild.guild_id, storedGuildId) &&
          nullableGuildIdentitiesMatch(
            restoredGuild.cluster_id,
            existingGuild.cluster_id
          ) &&
          nullableGuildIdentitiesMatch(
            restoredGuild.cluster_code,
            existingGuild.cluster_code
          ) &&
          restoredGuild.is_cluster === existingGuild.is_cluster

        if (rollbackError || !rollbackWitnessMatches) {
          logger.error(
            {
              userId: user.id,
              guildId: existingGuild.id,
              guildCode: canonicalGuildCode,
              clusterId: cluster.id,
              failure: rollbackError ? 'database_error' : 'witness_mismatch'
            },
            'CRITICAL: failed to roll back existing-guild cluster assignment'
          )
          throw Errors.fromResponse(500, {
            error:
              'Membership update failed and the guild assignment could not be restored. Contact support before retrying.',
            code: 'CLUSTER_JOIN_EXISTING_COMPENSATION_FAILED'
          })
        }

        throw Errors.fromResponse(500, {
          error:
            'Membership changed during cluster join. The guild assignment was restored; refresh your profile and retry.',
          code: 'CLUSTER_JOIN_RETRY_REQUIRED',
          retryable: true
        })
      }

      logger.info(
        {
          guildCode: canonicalGuildCode,
          guildId: storedGuildId,
          inputGuildCode: guildData.guildCode,
          clusterId: cluster.id,
          clusterCode: cluster.cluster_code,
          userId: user.id
        },
        'Existing mapped guild joined cluster via invite code'
      )

      return NextResponse.json({
        success: true,
        message: 'Successfully joined cluster with existing guild',
        cluster: {
          id: cluster.id,
          cluster_code: cluster.cluster_code,
          display_name: cluster.display_name
        },
        action: 'guild_joined'
      })
    } else {
      let apiKeyFields: Record<string, unknown> = {}
      let validationResult = preValidatedApiKey
      if (guildData.apiKey) {
        if (!validationResult) {
          validationResult = await validateApiKeyWithTacticus(
            guildData.apiKey.trim(),
            false
          )
        }
        if (!validationResult.isValid) {
          throw Errors.fromResponse(400, {
            error: 'API key validation failed',
            code: 'CLUSTER_JOIN_API_KEY_INVALID',
            suggestion:
              'Please ensure your API key has both Guild and Guild Raid permissions'
          })
        }
        if (!apiKeyProvesGuild(validationResult, canonicalGuildCode)) {
          throw Errors.fromResponse(400, {
            error: 'The API key belongs to a different guild'
          })
        }
        const encryptedKey = await encryptApiKey(guildData.apiKey)
        apiKeyFields = generateApiKeyUpdatePayload(
          encryptedKey,
          validationResult,
          undefined
        )
      }

      // guild_id makes identity-first lookups resolve; LOKI credentials stay null (shared account in env).
      const ownsNewGuildByMapping = guildIdentitiesMatch(
        currentMapping.guild_code,
        canonicalGuildCode
      )

      if (!ownsNewGuildByMapping) {
        throw Errors.fromResponse(403, {
          error:
            'Only the current mapped guild leader can create this guild in a cluster.'
        })
      }

      const expectedGuildId = validationResult?.guildInfo?.guildId ?? null
      const guildTarget: GuildAuthorityTarget = {
        guild_code: canonicalGuildCode,
        guild_id: expectedGuildId,
        cluster_id: cluster.id,
        cluster_code: cluster.cluster_code,
        is_cluster: true
      }
      const guildOutcome = await writeAndReconcileGuildAuthority(
        authority,
        { mode: 'insert' },
        guildTarget,
        async () => {
          const { data, error } = await authority
            .from('guild_config')
            .insert({
              guild_code: canonicalGuildCode,
              guild_tag: validationResult?.guildInfo?.guildCode || null,
              guild_id: expectedGuildId,
              display_name: guildData.displayName,
              cluster_id: cluster.id,
              cluster_code: cluster.cluster_code,
              enabled: true,
              is_cluster: true,
              tagline: guildData.tagline,
              description: guildData.description,
              logo_url: guildData.logoUrl,
              ...apiKeyFields,
              token_offender_threshold: 10,
              token_abuser_threshold: 15,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            })
            .select(
              'id, guild_code, guild_id, display_name, cluster_id, cluster_code, is_cluster'
            )
            .single()
          return { data, error }
        }
      )

      if (guildOutcome.state === 'unknown') {
        logger.error(
          {
            guildCode: guildData.guildCode,
            clusterId: cluster.id,
            writeOutcome: guildOutcome.writeOutcome,
            readOutcome: guildOutcome.readOutcome
          },
          'New guild state is unknown after cluster join insert'
        )
        throw Errors.fromResponse(500, {
          error:
            'The guild creation outcome could not be verified. Contact support before retrying.',
          code: 'CLUSTER_JOIN_GUILD_STATE_UNKNOWN'
        })
      }

      if (guildOutcome.state !== 'target' || !guildOutcome.guild) {
        logger.error(
          {
            guildCode: guildData.guildCode,
            clusterId: cluster.id,
            writeOutcome: guildOutcome.writeOutcome,
            readOutcome: guildOutcome.readOutcome
          },
          'Failed to create new guild for cluster join'
        )
        throw Errors.fromResponse(500, {
          error: 'The guild could not be created.',
          code: 'CLUSTER_JOIN_GUILD_CREATE_FAILED'
        })
      }
      const newGuild = guildOutcome.guild

      // Server-authority write so direct authenticated writes stay blocked in the DB.
      const targetCluster = {
        id: cluster.id,
        cluster_code: cluster.cluster_code,
        guild_code: canonicalGuildCode
      }
      const mappingOutcome = await completeClusterAuthoritySequence({
        authority,
        currentMapping,
        userId: user.id,
        clusterTarget: targetCluster
      })

      if (mappingOutcome.state === 'unknown') {
        logger.error(
          {
            userId: user.id,
            guildId: newGuild.id,
            guildCode: canonicalGuildCode,
            clusterId: cluster.id,
            patchOutcome: mappingOutcome.patchOutcome,
            readOutcome: mappingOutcome.readOutcome
          },
          'Current mapping state is unknown after new-guild cluster join'
        )
        throw Errors.fromResponse(500, {
          error:
            'The membership update outcome could not be verified. Contact support before retrying.',
          code: 'CLUSTER_JOIN_MAPPING_STATE_UNKNOWN'
        })
      }

      if (mappingOutcome.state === 'prior') {
        logger.error(
          {
            userId: user.id,
            guildCode: guildData.guildCode,
            patchOutcome: mappingOutcome.patchOutcome,
            readOutcome: mappingOutcome.readOutcome
          },
          'Failed to update player mapping for cluster join'
        )

        let cleanupQuery = authority
          .from('guild_config')
          .delete()
          .eq('id', newGuild.id)
          .eq('guild_code', canonicalGuildCode)
          .eq('cluster_id', cluster.id)
          .eq('cluster_code', cluster.cluster_code)
          .eq('is_cluster', true)

        cleanupQuery = newGuild.guild_id
          ? cleanupQuery.eq('guild_id', newGuild.guild_id)
          : cleanupQuery.is('guild_id', null)

        const { data: removedGuild, error: cleanupError } = await cleanupQuery
          .select(
            'id, guild_code, guild_id, cluster_id, cluster_code, is_cluster'
          )
          .maybeSingle()

        const cleanupWitnessMatches =
          removedGuild?.id === newGuild.id &&
          guildIdentitiesMatch(removedGuild.guild_code, canonicalGuildCode) &&
          removedGuild.cluster_id === cluster.id &&
          guildIdentitiesMatch(
            removedGuild.cluster_code,
            cluster.cluster_code
          ) &&
          removedGuild.is_cluster === true &&
          (newGuild.guild_id
            ? guildIdentitiesMatch(removedGuild.guild_id, newGuild.guild_id)
            : removedGuild.guild_id === null)

        if (cleanupError || !cleanupWitnessMatches) {
          logger.error(
            {
              userId: user.id,
              guildId: newGuild.id,
              guildCode: canonicalGuildCode,
              immutableGuildId: newGuild.guild_id,
              failure: cleanupError ? 'database_error' : 'witness_mismatch'
            },
            'CRITICAL: failed to compensate cluster-join guild creation'
          )
          throw Errors.fromResponse(500, {
            error:
              'Membership update failed and automatic cleanup could not be verified. Contact support before retrying.',
            code: 'CLUSTER_JOIN_COMPENSATION_FAILED'
          })
        }

        throw Errors.fromResponse(500, {
          error:
            'Membership changed during cluster join. No guild was retained; refresh your profile and retry.',
          code: 'CLUSTER_JOIN_RETRY_REQUIRED',
          retryable: true
        })
      }

      logger.info(
        {
          guildCode: guildData.guildCode,
          clusterId: cluster.id,
          clusterCode: cluster.cluster_code,
          userId: user.id
        },
        'New guild created and joined cluster via invite code'
      )

      return NextResponse.json({
        success: true,
        message: 'Successfully created guild and joined cluster',
        cluster: {
          id: cluster.id,
          cluster_code: cluster.cluster_code,
          display_name: cluster.display_name
        },
        guild: {
          id: newGuild.id,
          guild_code: newGuild.guild_code,
          display_name: newGuild.display_name
        },
        action: 'guild_created'
      })
    }
  } catch (error) {
    rethrowIfAppError(error)
    rethrowIfAuthError(error)
    logger.error(
      { failure: 'unhandled_cluster_join_error' },
      'Error in cluster join endpoint'
    )
    throw Errors.fromResponse(500, {
      error: 'The cluster join could not be completed.',
      code: 'CLUSTER_JOIN_INTERNAL_ERROR'
    })
  }
})

// Requires a session, or it would be an unauthenticated oracle for live codes.
export const GET = withErrorHandler(async (request: NextRequest) => {
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: true,
    skipRateLimit: false
  })

  if (securityResult) return securityResult

  try {
    const { searchParams } = new URL(request.url)
    const inviteCode = searchParams.get('invite_code')

    if (!inviteCode) {
      throw Errors.fromResponse(400, {
        error: 'Missing invite_code parameter'
      })
    }

    const { valid, cluster } = await validateInviteCode(inviteCode)

    if (!valid || !cluster) {
      return NextResponse.json(
        {
          valid: false,
          error: 'Invalid invite code',
          code: 'CLUSTER_JOIN_INVALID_INVITE'
        },
        { status: 200 }
      )
    }

    return NextResponse.json({
      valid: true,
      cluster: {
        cluster_code: cluster.cluster_code,
        display_name: cluster.display_name,
        max_guilds: cluster.max_guilds
      }
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      { failure: 'invite_validation_failed' },
      'Error validating invite code'
    )
    throw Errors.fromResponse(500, {
      valid: false,
      error: 'The invite code could not be validated.',
      code: 'CLUSTER_JOIN_INVITE_LOOKUP_FAILED'
    })
  }
})
