import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild.create-config')
import { encryptApiKey } from '@tacticus/app-core/encryption'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { resolveVerifiedPlayers } from '@/app/lib/auth/verified-player-authority'
import { isClusterLeaderRole } from '@/app/lib/auth/role-predicates'
import { validateApiKeyWithTacticus } from '@tacticus/app-core/api-key-validation'
import { validateGuildCode } from '@tacticus/app-core/api-errors'
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'
import { buildGuildConfigData } from './config-data'
import { runInitialGuildSync } from './initial-sync'
import {
  detectCurrentGuildRaidSeason,
  discoverGuildData,
  refreshGuildLokiSession
} from '@/app/lib/api/guild-config-probe'

type Supabase = SupabaseClient<Database>

export const POST = withErrorHandler(
  async (request: NextRequest): Promise<NextResponse> => {
    if (
      !process.env.LOKI_SCRAPER_USER_ID ||
      !process.env.LOKI_SCRAPER_CLIENT_SECRET
    ) {
      throw Errors.internal('LOKI credentials not configured', {
        endpoint: '/api/guild/create-config',
        details:
          'LOKI_SCRAPER_USER_ID and LOKI_SCRAPER_CLIENT_SECRET environment variables are required'
      })
    }

    const securityResult = await apiSecurityMiddleware(request, {
      requireAuth: true,
      skipRateLimit: false // Enable strict rate limiting (5 requests per hour)
    })

    if (securityResult) return securityResult

    try {
      const body = await request.json()
      const {
        guild_code,
        display_name,
        api_key,
        cluster_code,
        // Persisted by the service upsert: the browser never writes guild_config (cluster columns are guarded).
        api_owner,
        gr_ranking,
        gw_ranking,
        token_offender_threshold,
        token_abuser_threshold,
        enabled
      } = body

      logger.debug(
        {
          guild_code,
          display_name,
          has_api_key: !!api_key,
          cluster_code
        },
        '[create-config] Request received:'
      )

      if (!guild_code || !display_name || !api_key) {
        throw Errors.validation(
          'Missing required fields: guild_code, display_name, and api_key are required',
          {
            endpoint: '/api/guild/create-config',
            suggestion:
              'Ensure all required fields are provided in the request body'
          }
        )
      }

      const guildValidation = validateGuildCode(guild_code)
      if (!guildValidation.valid) {
        if (guildValidation.error === 'PROTECTED_GUILD_CODE') {
          throw Errors.protectedGuildCode(guild_code.toUpperCase())
        }
        throw Errors.invalidGuildCode(guild_code.toUpperCase())
      }

      let normalizedGuildCode = guild_code.toUpperCase().trim()
      const normalizedClusterCode =
        typeof cluster_code === 'string'
          ? cluster_code.trim().toUpperCase()
          : ''

      let supabase: Supabase
      try {
        supabase = serviceDb()
        logger.debug('[create-config] Using service role client')
      } catch (error) {
        rethrowIfAppError(error)
        logger.error(
          { err: error },
          '[create-config] Service role not available:'
        )
        throw Errors.internal(
          'Server configuration error - service role required',
          {
            endpoint: '/api/guild/create-config'
          }
        )
      }

      let resolvedClusterId: string | null = null

      if (normalizedClusterCode) {
        const authedSupabase = await db()
        const user = await requireSessionUser(authedSupabase, () =>
          Errors.fromResponse(401, { error: 'Unauthorized' })
        )

        const { data: clusterRow, error: clusterError } = await supabase
          .from('clusters')
          .select('id, cluster_code, created_by')
          .eq('cluster_code', normalizedClusterCode)
          .maybeSingle()

        if (clusterError) {
          logger.error(
            { err: clusterError },
            '[create-config] Cluster ownership lookup failed'
          )
          throw Errors.fromResponse(500, {
            error: 'Unable to verify cluster ownership.',
            details: clusterError.message
          })
        }

        if (!clusterRow) {
          throw Errors.fromResponse(404, {
            error: `Cluster ${normalizedClusterCode} was not found.`
          })
        }

        let canAddGuild = clusterRow.created_by === user.id
        if (!canAddGuild) {
          // Use the guild's canonical cluster linkage, never a profile or request cluster id.
          const verifiedPlayers = await resolveVerifiedPlayers(supabase, [
            user.id
          ])

          // isAppAdmin comes from the resolver (unrevoked ownership proof), never a client or profile role.
          canAddGuild = verifiedPlayers.some(
            (player) => player.isAppAdmin === true
          )

          if (!canAddGuild) {
            // A user may lead two guilds with only one in this cluster.
            const leaderMappingIds = verifiedPlayers.flatMap((player) =>
              isClusterLeaderRole(player.role) &&
              typeof player.guildCode === 'string' &&
              player.guildCode.length > 0
                ? [player.mappingId]
                : []
            )

            if (leaderMappingIds.length > 0) {
              const { data: activeLeaderRows, error: activeError } =
                await supabase
                  .from('player_mapping')
                  .select('guild_code')
                  .in('id', leaderMappingIds)
                  .eq('user_id', user.id)
                  .eq('is_current', true)
                  .eq('is_active', true)

              if (activeError) {
                throw Errors.internal(
                  'Unable to verify active cluster leadership'
                )
              }

              // Derived from the active rows so the checked and used mappings are the same.
              const activeLeaderGuildCodes = [
                ...new Set(
                  (activeLeaderRows ?? []).flatMap((row) =>
                    typeof row.guild_code === 'string' &&
                    row.guild_code.length > 0
                      ? [row.guild_code]
                      : []
                  )
                )
              ]

              if (activeLeaderGuildCodes.length > 0) {
                const { data: inClusterGuilds, error: membershipError } =
                  await supabase
                    .from('guild_config')
                    .select('guild_code')
                    .in('guild_code', activeLeaderGuildCodes)
                    .eq('cluster_id', clusterRow.id)
                    .limit(1)

                if (membershipError) {
                  throw Errors.internal('Unable to verify cluster membership')
                }
                canAddGuild = (inClusterGuilds?.length ?? 0) > 0
              }
            }
          }
        }

        if (!canAddGuild) {
          throw Errors.fromResponse(403, {
            error:
              'Only the cluster creator, an app admin, or an active guild leader within the cluster can add guilds.'
          })
        }

        resolvedClusterId = clusterRow.id
      }

      logger.debug('[create-config] Checking for existing guild...')
      const { data: existingGuildRow, error: checkError } = await supabase
        .from('guild_config')
        .select(
          'guild_code, display_name, created_at, onboarding_source, onboarding_completed'
        )
        .ilike('guild_code', normalizedGuildCode)
        .maybeSingle()

      if (checkError && !checkError.message.includes('Row not found')) {
        logger.error(
          { err: checkError },
          '[create-config] Error checking existing guild:'
        )
        throw Errors.internal('Database error checking guild existence', {
          endpoint: '/api/guild/create-config',
          guild_code: normalizedGuildCode,
          details: checkError.message
        })
      }

      const existingGuild = existingGuildRow as {
        guild_code: string
        display_name: string | null
        onboarding_source?: string | null
        onboarding_completed?: boolean
        created_at?: string
      } | null

      const isScrapedGuild =
        existingGuild?.onboarding_source === 'scraped_leaderboard'
      // Allow retry when onboarding never completed (prevents a 409 loop).
      const isIncompleteOnboarding =
        existingGuild &&
        !existingGuild.onboarding_completed &&
        (existingGuild.onboarding_source === 'standard' ||
          existingGuild.onboarding_source === null)

      if (existingGuild && !isScrapedGuild && !isIncompleteOnboarding) {
        throw Errors.guildAlreadyExists(normalizedGuildCode)
      }

      if (isScrapedGuild) {
        logger.info(
          { guildCode: normalizedGuildCode },
          '[create-config] Claiming scraped guild'
        )
      }
      if (isIncompleteOnboarding) {
        logger.info(
          { guildCode: normalizedGuildCode },
          '[create-config] Retrying incomplete onboarding'
        )
      }

      logger.info('[create-config] Validating API key with Tacticus API...')
      const apiKeyValidation = await validateApiKeyWithTacticus(api_key, false)

      if (!apiKeyValidation.isValid) {
        logger.error(
          {
            error: apiKeyValidation.error,
            statusCode: apiKeyValidation.statusCode,
            canAccessGuild: apiKeyValidation.canAccessGuild,
            canAccessRaidData: apiKeyValidation.canAccessRaidData
          },
          '[create-config] API key validation failed:'
        )

        throw Errors.unauthorized(
          apiKeyValidation.error ||
            'API key validation failed - please check your Guild Raid API key is correct',
          {
            endpoint: '/api/guild/create-config',
            guild_code: normalizedGuildCode,
            details: !apiKeyValidation.canAccessGuild
              ? 'API key cannot access guild data - verify the key has Guild permissions'
              : !apiKeyValidation.canAccessRaidData
                ? 'API key cannot access Guild Raid data - verify the key has Guild Raid permissions'
                : 'API key validation failed with Tacticus servers',
            suggestion:
              'Generate a new API key from the Tacticus game settings with both Guild and Guild Raid permissions enabled'
          }
        )
      }

      logger.info(
        {
          canAccessGuild: apiKeyValidation.canAccessGuild,
          canAccessRaidData: apiKeyValidation.canAccessRaidData,
          guildId: apiKeyValidation.guildInfo?.guildId,
          guildName: apiKeyValidation.guildInfo?.guildName
        },
        '[create-config] API key validated successfully:'
      )

      // guildId is the canonical identity; the guildTag is not our guild_code.
      if (!apiKeyValidation.guildInfo?.guildId) {
        logger.warn(
          {
            targetGuild: normalizedGuildCode,
            guildInfo: apiKeyValidation.guildInfo
          },
          '[create-config] API key validated but guild identity could not be determined'
        )
        throw Errors.fromResponse(400, {
          error: 'Could not determine guild from API key',
          details:
            'The API key was accepted by the Tacticus API but did not return guild information. This can happen if the key has the wrong permissions or the guild is not active.',
          recommendation:
            'Generate a new API key at https://api.tacticusgame.com/ with both "Guild" and "Guild Raid" read access selected. Do NOT use a Player-only key here.'
        })
      }

      // A row for this guildId under another code is claimed or refused; its guild_code is adopted,
      // not renamed, so Discord links and bookmarks keep working.
      const { data: claimStatusRows } = await supabase.rpc(
        'get_guild_config_by_guild_id',
        { p_guild_id: apiKeyValidation.guildInfo.guildId }
      )
      const claimableRow =
        Array.isArray(claimStatusRows) && claimStatusRows.length > 0
          ? claimStatusRows[0]
          : null
      const guildIdCollision =
        !!claimableRow && claimableRow.guild_code !== normalizedGuildCode
      let isClaimingByGuildId = false

      if (guildIdCollision) {
        const collisionRow = claimableRow!
        if (collisionRow.claimed_by_user) {
          // A claimed guild may join a cluster only if the caller passed the cluster-authority gate, the key
          // validated for this guildId, and it is not in another cluster. Nothing else about ownership changes.
          const { data: collisionConfig, error: collisionConfigError } =
            await supabase
              .from('guild_config')
              .select('guild_code, cluster_id')
              .eq('guild_code', collisionRow.guild_code)
              .maybeSingle()

          if (collisionConfigError) {
            logger.error(
              { err: collisionConfigError },
              '[create-config] Collision-row cluster lookup failed'
            )
            throw Errors.internal('Unable to verify existing guild cluster', {
              endpoint: '/api/guild/create-config'
            })
          }

          const alreadyInAnotherCluster =
            !!collisionConfig?.cluster_id &&
            collisionConfig.cluster_id !== resolvedClusterId

          const mayAttachToCluster =
            resolvedClusterId !== null && !alreadyInAnotherCluster

          if (!mayAttachToCluster) {
            logger.warn(
              {
                attemptedGuild: normalizedGuildCode,
                existingGuild: collisionRow.guild_code,
                guildId: apiKeyValidation.guildInfo.guildId,
                requestedCluster: resolvedClusterId,
                alreadyInAnotherCluster
              },
              '[create-config] API key guild already claimed by another user'
            )
            throw Errors.fromResponse(409, {
              error: alreadyInAnotherCluster
                ? 'This guild already belongs to another cluster'
                : 'This guild is already registered',
              details: alreadyInAnotherCluster
                ? `"${collisionRow.display_name ?? collisionRow.guild_code}" is already a member of a different cluster. A guild must be removed from its current cluster before it can join another.`
                : `This API key belongs to "${collisionRow.display_name ?? collisionRow.guild_code}" which is already managed by another account.`,
              recommendation: alreadyInAnotherCluster
                ? `Ask that cluster's leader to remove the guild first, then add it here.`
                : `If this is your guild, sign in to the existing account or contact support to recover access.`
            })
          }

          logger.info(
            {
              attemptedGuild: normalizedGuildCode,
              existingGuild: collisionRow.guild_code,
              guildId: apiKeyValidation.guildInfo.guildId,
              clusterId: resolvedClusterId
            },
            '[create-config] Attaching already-registered guild to cluster'
          )
          normalizedGuildCode = collisionRow.guild_code
          isClaimingByGuildId = true
        } else {
          logger.info(
            {
              attemptedGuild: normalizedGuildCode,
              existingGuild: collisionRow.guild_code,
              guildId: apiKeyValidation.guildInfo.guildId
            },
            '[create-config] Claiming existing unclaimed guild row by guild_id'
          )
          normalizedGuildCode = collisionRow.guild_code
          isClaimingByGuildId = true
        }
      }

      logger.info('[create-config] Auto-discovering guild data...')
      const discoveredData = await discoverGuildData(api_key)

      if (!discoveredData?.isLeader) {
        logger.warn(
          '[create-config] API key does not appear to be a leader key'
        )
      }

      const currentSeason = await detectCurrentGuildRaidSeason(api_key)

      // Non-blocking: Loki being down must not block registration.
      logger.info('[create-config] Refreshing session_id for new guild...')
      const sessionId = await refreshGuildLokiSession(
        normalizedGuildCode,
        process.env.LOKI_SCRAPER_USER_ID!,
        process.env.LOKI_SCRAPER_CLIENT_SECRET!
      )

      if (!sessionId) {
        logger.warn(
          { guildCode: normalizedGuildCode },
          '[create-config] LOKI session refresh failed; sync will be deferred'
        )
      } else {
        logger.info(
          '[create-config] Successfully obtained session_id for new guild'
        )
      }

      let encryptedApiKey: string
      try {
        encryptedApiKey = await encryptApiKey(api_key)
      } catch (error) {
        rethrowIfAppError(error)
        logger.error(
          { err: error },
          '[create-config] Failed to encrypt API key:'
        )
        throw Errors.internal('Failed to encrypt guild API key', {
          endpoint: '/api/guild/create-config',
          guild_code: normalizedGuildCode,
          details:
            error instanceof Error ? error.message : 'Unknown encryption error'
        })
      }

      const configData = buildGuildConfigData({
        guildCode: normalizedGuildCode,
        clusterCode: normalizedClusterCode,
        clusterId: resolvedClusterId,
        encryptedApiKey,
        apiKeyIsValid: apiKeyValidation.isValid,
        sessionId,
        discovered: discoveredData,
        overrides: {
          displayName: display_name,
          apiOwner: api_owner,
          grRanking: gr_ranking,
          gwRanking: gw_ranking,
          tokenOffenderThreshold: token_offender_threshold,
          tokenAbuserThreshold: token_abuser_threshold,
          enabled
        }
      })

      // Upsert (not the RPC, which drops fields).
      logger.debug(
        `[create-config] Using upsert for guild config (Claiming: ${isScrapedGuild})...`
      )
      const { data: createdRow, error } = await supabase
        .from('guild_config')
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        .upsert(configData as any, { onConflict: 'guild_code' })
        .select(
          'guild_code, cluster_id, cluster_code, is_cluster, enabled, ' +
            'API_Owner, GR_Ranking, GW_Ranking, token_offender_threshold, ' +
            'token_abuser_threshold'
        )
        .single()

      if (error) {
        logger.error({ err: error }, '[create-config] Insert error:')
        const duplicateError =
          error.code === '23505' ||
          /duplicate|unique/i.test(error.message ?? '')

        if (duplicateError) {
          // The conflict may be on guild_id, not guild_code.
          const constraintDetail =
            error.details ?? error.message ?? 'constraint violation'
          throw Errors.conflict(
            `Guild ${normalizedGuildCode} conflicts with an existing record (${constraintDetail})`,
            {
              endpoint: '/api/guild/create-config',
              guild_code: normalizedGuildCode
            }
          )
        }

        throw Errors.internal(
          error.message ?? 'Failed to create guild configuration',
          {
            endpoint: '/api/guild/create-config',
            guild_code: normalizedGuildCode
          }
        )
      }

      logger.info(
        {
          guild_code: normalizedGuildCode,
          auto_discovered: {
            guild_id: discoveredData?.guildId,
            is_leader: discoveredData?.isLeader,
            season: currentSeason
          }
        },
        '[create-config] Guild config created successfully:'
      )

      const { initialSyncTriggered, playerMappingsCreated } =
        await runInitialGuildSync({
          supabase,
          guildCode: normalizedGuildCode,
          apiKey: api_key,
          reconcileRoles: Boolean(discoveredData?.guildId)
        })

      // Report cluster linkage as persisted: the client treats a null cluster_id as a failure.

      const authoritativeRow = (createdRow ?? null) as {
        cluster_id?: string | null
        cluster_code?: string | null
        is_cluster?: boolean | null
      } | null

      return NextResponse.json({
        success: true,
        data: {
          guild_code: normalizedGuildCode,
          claimed: isClaimingByGuildId,
          cluster_id: authoritativeRow?.cluster_id ?? null,
          cluster_code: authoritativeRow?.cluster_code ?? null,
          is_cluster: authoritativeRow?.is_cluster ?? false,
          autoDiscovered: {
            guildId: discoveredData?.guildId,
            guildName: discoveredData?.guildName,
            isLeaderKey: discoveredData?.isLeader,
            season: currentSeason,
            sessionIdCreated: Boolean(sessionId)
          },
          initialSyncTriggered,
          playerMappingsCreated,
          message: isClaimingByGuildId
            ? `Guild already existed in our system as "${normalizedGuildCode}" — successfully claimed under your account.`
            : playerMappingsCreated
              ? 'Guild registered and player roster synced. Members can now join.'
              : initialSyncTriggered
                ? 'Guild registered and battle data synced. Player roster sync may take a few more minutes.'
                : 'Guild registered. Initial sync may take a few minutes before players can join.'
        },
        message: isClaimingByGuildId
          ? `Guild ${normalizedGuildCode} claimed`
          : playerMappingsCreated
            ? 'Guild config created with player roster'
            : initialSyncTriggered
              ? 'Guild config created and synced successfully'
              : 'Guild config created successfully (sync pending)'
      })
    } catch (error) {
      rethrowIfAppError(error)
      throw Errors.internal(
        'An unexpected error occurred during guild creation',
        {
          endpoint: '/api/guild/create-config',
          details:
            error instanceof Error ? error.message : 'Internal server error',
          suggestion:
            'Please try again or contact support if the issue persists'
        }
      )
    }
  }
)
