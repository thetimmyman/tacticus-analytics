import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild.claim')
import { encryptApiKey } from '@tacticus/app-core/encryption'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import {
  validateApiKeyWithTacticus,
  generateApiKeyUpdatePayload
} from '@tacticus/app-core/api-key-validation'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { resolveVerifiedPlayers } from '@/app/lib/auth/verified-player-authority'

/** Claims an existing guild into a cluster; the key must validate upstream for it. */
export const POST = withErrorHandler(
  async (request: NextRequest): Promise<NextResponse> => {
    const securityResult = await apiSecurityMiddleware(request, {
      requireAuth: true,
      skipRateLimit: false
    })
    if (securityResult) return securityResult

    const supabaseAuth = await db()
    const user = await requireSessionUser(supabaseAuth, () =>
      Errors.authenticationRequired('Authentication required to claim a guild')
    )

    const body = await request.json()
    const { guild_code, api_key, cluster_code, api_key_owner } = body

    if (!guild_code || typeof guild_code !== 'string') {
      throw Errors.validation('guild_code is required', {
        endpoint: '/api/guild/claim'
      })
    }
    if (!api_key || typeof api_key !== 'string') {
      throw Errors.validation('api_key is required', {
        endpoint: '/api/guild/claim'
      })
    }
    if (!cluster_code || typeof cluster_code !== 'string') {
      throw Errors.validation('cluster_code is required', {
        endpoint: '/api/guild/claim'
      })
    }

    const normalizedGuildCode = guild_code.toUpperCase().trim()
    const normalizedClusterCode = cluster_code.toUpperCase().trim()

    const supabase = serviceDb()

    const { data: existingGuild, error: lookupError } = await supabase
      .from('guild_config')
      .select(
        'guild_code, display_name, cluster_code, cluster_id, enabled, api_key_is_valid'
      )
      .ilike('guild_code', normalizedGuildCode)
      .maybeSingle()

    if (lookupError) {
      logger.error({ err: lookupError }, '[claim] Guild lookup failed:')
      throw Errors.internal('Database error looking up guild', {
        endpoint: '/api/guild/claim'
      })
    }

    if (!existingGuild) {
      throw Errors.fromResponse(404, {
        error: 'Guild not found',
        details: `No guild with code ${normalizedGuildCode} exists. Use the normal creation flow instead.`
      })
    }

    if (existingGuild.cluster_code === normalizedClusterCode) {
      throw Errors.conflict(
        `Guild ${normalizedGuildCode} is already in cluster ${normalizedClusterCode}`,
        { endpoint: '/api/guild/claim' }
      )
    }

    // A valid key proves possession only. Verified officer/leader (or app admin) of the target guild is
    // resolved before any service-role write.
    const verifiedPlayers = await resolveVerifiedPlayers(supabase, [user.id])
    const isAppAdmin = verifiedPlayers.some(
      (mapping) => mapping.isAppAdmin === true
    )
    const hasTargetGuildAuthority =
      isAppAdmin ||
      verifiedPlayers.some(
        (mapping) =>
          mapping.guildCode?.toUpperCase() === normalizedGuildCode &&
          typeof mapping.role === 'string' &&
          ['officer', 'leader'].includes(mapping.role.toLowerCase())
      )

    // Deferred: a cluster admin with an upstream-validated key is a second consent path.
    if (!hasTargetGuildAuthority) {
      logger.info(
        { userId: user.id, guildCode: normalizedGuildCode },
        '[claim] Caller lacks target-guild authority; falling back to the validated-key cluster-admin path'
      )
    }

    logger.info(
      { guildCode: normalizedGuildCode },
      '[claim] Validating API key for guild'
    )
    const validation = await validateApiKeyWithTacticus(api_key, false)

    if (!validation.isValid) {
      throw Errors.fromResponse(400, {
        error: 'API key validation failed',
        details: validation.error || 'The API key is invalid or expired'
      })
    }

    // Upstream returns guildTag, not our guild_code, so compare by guildId.
    if (!validation.guildInfo?.guildId) {
      throw Errors.fromResponse(400, {
        error: 'Could not determine guild from API key',
        details: 'The API key is valid but did not return guild information'
      })
    }

    const { data: claimTarget } = await supabase
      .from('guild_config')
      .select('guild_id')
      .eq('guild_code', normalizedGuildCode)
      .single()

    if (
      claimTarget?.guild_id &&
      validation.guildInfo.guildId !== claimTarget.guild_id
    ) {
      throw Errors.fromResponse(400, {
        error: 'API key belongs to a different guild',
        details: `This API key is for guild "${validation.guildInfo.guildName}", not ${normalizedGuildCode}`
      })
    }

    const { data: cluster, error: clusterError } = await supabase
      .from('clusters')
      .select('id, created_by')
      .eq('cluster_code', normalizedClusterCode)
      .maybeSingle()

    if (clusterError || !cluster) {
      logger.error({ err: clusterError }, '[claim] Cluster lookup failed:')
      throw Errors.fromResponse(404, {
        error: 'Cluster not found',
        details: `No cluster with code ${normalizedClusterCode} exists`
      })
    }

    // Creator, app admin, or verified leader in the cluster; must complete before any service write.
    let hasClusterAuthority = cluster.created_by === user.id

    if (!hasClusterAuthority) {
      hasClusterAuthority = isAppAdmin

      if (!hasClusterAuthority) {
        const leaderGuildCodes = verifiedPlayers.flatMap((mapping) =>
          typeof mapping.role === 'string' &&
          mapping.role.toLowerCase() === 'leader' &&
          typeof mapping.guildCode === 'string' &&
          mapping.guildCode.length > 0
            ? [mapping.guildCode]
            : []
        )

        if (leaderGuildCodes.length > 0) {
          const { data: inClusterGuilds, error: clusterMembershipError } =
            await supabase
              .from('guild_config')
              .select('guild_code')
              .in('guild_code', leaderGuildCodes)
              .eq('cluster_id', cluster.id)
              .limit(1)

          if (clusterMembershipError) {
            logger.error(
              { err: clusterMembershipError },
              '[claim] Canonical cluster membership lookup failed'
            )
            throw Errors.internal('Unable to verify cluster membership', {
              endpoint: '/api/guild/claim'
            })
          }

          hasClusterAuthority = (inClusterGuilds?.length ?? 0) > 0
        }
      }
    }

    if (!hasClusterAuthority) {
      logger.warn(
        { userId: user.id, clusterCode: normalizedClusterCode },
        '[claim] Caller lacks target-cluster authority'
      )
      throw Errors.forbidden(
        hasTargetGuildAuthority
          ? 'You do not have permission to add guilds to this cluster. Ask the cluster owner to add it, or to make your guild a member of the cluster first.'
          : 'You do not have permission to add guilds to this cluster, and you are not an officer or leader of this guild. Either path is enough on its own: claim it as an officer/leader of the guild, or hold cluster authority and supply a valid API key for the guild you are adding.'
      )
    }

    // May bring an unclustered guild in, never pull one out of another admin's cluster.
    if (!hasTargetGuildAuthority) {
      const alreadyInAnotherCluster =
        typeof existingGuild.cluster_id === 'string' &&
        existingGuild.cluster_id.length > 0 &&
        existingGuild.cluster_id !== cluster.id

      if (alreadyInAnotherCluster) {
        logger.warn(
          {
            userId: user.id,
            guildCode: normalizedGuildCode,
            currentCluster: existingGuild.cluster_code,
            requestedCluster: normalizedClusterCode
          },
          '[claim] Validated-key path refused: target guild already belongs to another cluster'
        )
        throw Errors.conflict(
          `Guild ${normalizedGuildCode} already belongs to cluster ${existingGuild.cluster_code ?? 'another cluster'}. A validated API key lets you add a guild that is not in a cluster; it does not move a guild out of one. Ask an officer or leader of ${normalizedGuildCode} to claim it, or have them send you a cluster invite code.`,
          { endpoint: '/api/guild/claim' }
        )
      }

      logger.info(
        {
          userId: user.id,
          guildCode: normalizedGuildCode,
          clusterCode: normalizedClusterCode
        },
        '[claim] Validated-key cluster-admin consent accepted'
      )
    }

    let encryptedApiKey: string
    try {
      encryptedApiKey = await encryptApiKey(api_key)
    } catch (error) {
      rethrowIfAppError(error)
      logger.error({ err: error }, '[claim] API key encryption failed:')
      throw Errors.internal('Failed to encrypt API key', {
        endpoint: '/api/guild/claim'
      })
    }

    const apiKeyPayload = generateApiKeyUpdatePayload(
      encryptedApiKey,
      validation,
      api_key_owner
    )

    const previousCluster = existingGuild.cluster_code
    if (previousCluster && previousCluster !== normalizedClusterCode) {
      logger.warn(
        {
          guildCode: normalizedGuildCode,
          previousClusterCode: previousCluster,
          currentClusterCode: normalizedClusterCode
        },
        '[claim] Guild is moving between clusters'
      )
    }

    const { error: updateError } = await supabase
      .from('guild_config')
      .update({
        ...apiKeyPayload,
        guild_tag: validation.guildInfo?.guildCode || undefined,
        cluster_code: normalizedClusterCode,
        cluster_id: cluster.id,
        is_cluster: true,
        enabled: true,
        // Never copy the shared LOKI_SCRAPER_* secret into the row; readers fall back to env.
        updated_at: new Date().toISOString()
      })
      .eq('guild_code', normalizedGuildCode)

    if (updateError) {
      logger.error({ err: updateError }, '[claim] Guild update failed:')
      throw Errors.internal('Failed to update guild configuration', {
        endpoint: '/api/guild/claim',
        details: updateError.message
      })
    }

    logger.info(
      {
        guildCode: normalizedGuildCode,
        previousClusterCode: previousCluster,
        currentClusterCode: normalizedClusterCode
      },
      '[claim] Guild successfully claimed into cluster'
    )

    return NextResponse.json({
      success: true,
      action: 'guild_claimed',
      data: {
        guild_code: normalizedGuildCode,
        display_name: existingGuild.display_name,
        previous_cluster: previousCluster,
        new_cluster: normalizedClusterCode
      }
    })
  }
)
