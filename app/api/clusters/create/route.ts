import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { CURRENT_USER_PLAYER_MAPPING } from '@/app/lib/player-mapping-relations'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.clusters.create')
import { apiSecurityMiddleware } from '@/app/lib/middleware/rate-limit'
import { generateInviteCode } from '@/app/lib/utils/invite-codes'
import { encryptApiKey } from '@tacticus/app-core/encryption'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { validateDiscordWebhookUrl } from '@/app/lib/webhooks/validate-url'
import {
  validateApiKeyWithTacticus,
  generateApiKeyUpdatePayload
} from '@tacticus/app-core/api-key-validation'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { isClusterLeaderRole } from '@/app/lib/auth/role-predicates'
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

interface ClusterCreationData {
  clusterCode: string
  displayName: string
  tagline?: string
  description?: string
  timezone?: string
  primaryLanguage?: string
  primaryColor?: string
  secondaryColor?: string
  accentColor?: string
  logoUrl?: string
  bannerUrl?: string
  discordServerId?: string
  discordInviteUrl?: string
  discordWebhookUrl?: string
  maxGuilds?: number
  tokenOffenderThreshold?: number
  tokenAbuserThreshold?: number
  setupMethod?: 'direct' | 'invite_code' // New field for setup method choice
  generateInviteCode?: boolean // Whether to generate invite code
  foundingGuilds?: Array<{
    guildCode: string
    displayName: string
    leaderEmail: string
    apiKey?: string
  }>
}

// Each founding guild can cost an upstream key validation.
const MAX_FOUNDING_GUILDS = 10
export const POST = withErrorHandler(async (request: NextRequest) => {
  const securityResult = await apiSecurityMiddleware(request, {
    requireAuth: true,
    requiredRole: undefined, // Don't check role - we'll handle it manually
    skipRateLimit: false // Enable strict rate limiting
  })

  if (securityResult) return securityResult

  try {
    const supabase = await db()
    const user = await requireSessionUser(supabase, () =>
      Errors.unauthorized('Authentication required')
    )

    const { data: profile, error: profileError } = await supabase
      .from(CURRENT_USER_PLAYER_MAPPING)
      .select(
        'id, user_id, guild_code, cluster_id, cluster_code, role, is_current'
      )
      .eq('user_id', user.id)
      .eq('is_current', true)
      .maybeSingle()

    if (profileError) {
      logger.error(
        { userId: user.id, failure: 'mapping_lookup_failed' },
        'Failed to verify cluster creator profile'
      )
      throw Errors.fromResponse(500, {
        error: 'Cluster creation authority could not be verified.',
        code: 'CLUSTER_CREATE_AUTHORITY_LOOKUP_FAILED'
      })
    }

    // Members/officers are blocked so they cannot hijack their guild.
    if (profile && !isClusterLeaderRole(profile.role)) {
      throw Errors.forbidden(
        'Only guild leaders can create clusters with existing guild data. New users can create empty clusters.'
      )
    }

    const data: ClusterCreationData = await request.json()

    if (!data.clusterCode || !data.displayName) {
      throw Errors.validation('Cluster code and display name are required')
    }

    if (!/^[A-Z0-9]{2,10}$/.test(data.clusterCode)) {
      throw Errors.validation(
        'Cluster code must be 2-10 uppercase letters/numbers'
      )
    }

    // Validate before any write: webhook_config's CHECK would silently drop a non-webhook URL.
    let webhookUrl: string | null = null
    const rawWebhookUrl: unknown = data.discordWebhookUrl
    const webhookProvided =
      rawWebhookUrl !== undefined &&
      rawWebhookUrl !== null &&
      !(typeof rawWebhookUrl === 'string' && rawWebhookUrl.trim() === '')
    if (webhookProvided) {
      const urlValidation = validateDiscordWebhookUrl(
        rawWebhookUrl as string | null | undefined
      )
      if (!urlValidation.ok) {
        throw Errors.validation(
          'hint' in urlValidation
            ? `${urlValidation.message} ${urlValidation.hint}`
            : urlValidation.message
        )
      }
      webhookUrl = urlValidation.url
    }

    if ((data.foundingGuilds?.length ?? 0) > MAX_FOUNDING_GUILDS) {
      throw Errors.validation(
        `A cluster can be created with at most ${MAX_FOUNDING_GUILDS} founding guilds`
      )
    }

    const { data: existingCluster, error: clusterLookupError } = await supabase
      .from('clusters')
      .select('id')
      .eq('cluster_code', data.clusterCode)
      .maybeSingle()

    if (clusterLookupError) {
      logger.error(
        {
          clusterCode: data.clusterCode,
          failure: 'cluster_lookup_failed'
        },
        'Failed to verify cluster code availability'
      )
      throw Errors.fromResponse(500, {
        error: 'Cluster code availability could not be verified.',
        code: 'CLUSTER_CREATE_CODE_LOOKUP_FAILED'
      })
    }

    if (existingCluster) {
      throw Errors.conflict('Cluster code already exists')
    }

    // Reads stay on the session client; vetted authority mutations use this service client.
    const authority = serviceDb()

    const errors: string[] = []

    let inviteCode: string | null = null
    if (data.generateInviteCode || data.setupMethod === 'invite_code') {
      try {
        inviteCode = await generateInviteCode()
      } catch (error) {
        rethrowIfAppError(error)
        logger.error(
          { failure: 'invite_generation_failed' },
          'Failed to generate invite code'
        )
        throw Errors.fromResponse(500, {
          error: 'An invite code could not be generated.',
          code: 'CLUSTER_CREATE_INVITE_FAILED'
        })
      }
    }

    const { data: newCluster, error: clusterError } = await authority
      .from('clusters')
      .insert({
        cluster_code: data.clusterCode,
        display_name: data.displayName,
        tagline: data.tagline || null,
        description: data.description || null,
        logo_url: data.logoUrl || null,
        banner_url: data.bannerUrl || null,
        primary_color: data.primaryColor || null,
        secondary_color: data.secondaryColor || null,
        accent_color: data.accentColor || null,
        discord_server_id: data.discordServerId || null,
        discord_invite_url: data.discordInviteUrl || null,
        is_active: true,
        max_guilds: data.maxGuilds || 10,
        primary_language: data.primaryLanguage || 'en',
        time_zone: data.timezone || 'UTC',
        invite_code: inviteCode, // Add generated invite code
        created_by: user.id
      })
      .select()
      .single()

    if (
      clusterError ||
      !newCluster ||
      newCluster.cluster_code !== data.clusterCode ||
      newCluster.created_by !== user.id
    ) {
      logger.error(
        {
          clusterCode: data.clusterCode,
          failure: clusterError ? 'database_error' : 'witness_mismatch'
        },
        'Failed to create cluster authority row'
      )
      throw Errors.fromResponse(500, {
        error: 'The cluster could not be created.',
        code: 'CLUSTER_CREATE_INSERT_FAILED'
      })
    }

    if (webhookUrl) {
      const { error: webhookError } = await supabase
        .from('webhook_config')
        .insert({
          cluster_id: newCluster.id,
          webhook_url: webhookUrl,
          webhook_type: 'overall_leaderboard',
          enabled: true,
          description: 'Cluster overall leaderboard',
          updated_by: user.id
        })

      if (webhookError) {
        logger.error(
          { clusterId: newCluster.id, failure: 'webhook_insert_failed' },
          'Failed to create webhook configuration'
        )
        errors.push(
          'Webhook configuration could not be saved. (CLUSTER_CREATE_WEBHOOK_FAILED)'
        )
      }
    }

    if (data.foundingGuilds && data.foundingGuilds.length > 0) {
      for (const guild of data.foundingGuilds) {
        const canonicalRequestedGuildCode = canonicalizeGuildCode(
          guild.guildCode
        )
        const guildLabel = formatGuildDisplayLabel({
          guild_code: canonicalRequestedGuildCode,
          display_name: guild.displayName
        })
        // No raw `.or()` on user input. Fail closed so a read failure cannot become a duplicate insert.
        const guildLookup = await findGuildByIdentity(supabase, guild.guildCode)
        let existingGuild = guildLookup.guild
        const guildLookupError = guildLookup.error

        if (guildLookupError) {
          logger.error(
            {
              guildCode: canonicalRequestedGuildCode,
              failure: 'guild_identity_lookup_failed'
            },
            'Failed to resolve founding guild'
          )
          errors.push(
            `Guild ${guildLabel} could not be verified. (CLUSTER_CREATE_GUILD_LOOKUP_FAILED)`
          )
          continue
        }

        let validationResult: Awaited<
          ReturnType<typeof validateApiKeyWithTacticus>
        > | null = null
        if (guild.apiKey) {
          validationResult = await validateApiKeyWithTacticus(
            guild.apiKey.trim(),
            false
          )
          if (!validationResult.isValid) {
            errors.push(
              `Guild ${guildLabel}: API key validation failed. (CLUSTER_CREATE_API_KEY_INVALID)`
            )
            continue
          }

          // Re-resolve by the key's upstream guild ID so an existing guild never gets a second row.
          if (!existingGuild && validationResult.guildInfo?.guildId) {
            const byValidatedId = await findGuildByIdentity(
              supabase,
              validationResult.guildInfo.guildId
            )
            if (byValidatedId.error) {
              logger.error(
                {
                  guildCode: canonicalRequestedGuildCode,
                  failure: 'guild_identity_lookup_failed'
                },
                'Failed to re-resolve founding guild by immutable ID'
              )
              errors.push(
                `Guild ${guildLabel} could not be verified. (CLUSTER_CREATE_GUILD_LOOKUP_FAILED)`
              )
              continue
            }
            existingGuild = byValidatedId.guild
          }
        }

        if (existingGuild) {
          const ownsByMapping = guildIdentitiesMatch(
            profile?.guild_code,
            existingGuild.guild_code
          )
          const storedGuildId = existingGuild.guild_id
          const liveGuildId = validationResult?.guildInfo?.guildId

          if (
            profile &&
            ownsByMapping &&
            storedGuildId &&
            liveGuildId &&
            guildIdentitiesMatch(storedGuildId, liveGuildId)
          ) {
            let guildAssignment = authority
              .from('guild_config')
              .update({
                cluster_id: newCluster.id,
                cluster_code: data.clusterCode,
                is_cluster: true,
                enabled: true
              })
              .eq('id', existingGuild.id)
              .eq('guild_code', existingGuild.guild_code)
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
              guild_code: existingGuild.guild_code,
              guild_id: storedGuildId,
              cluster_id: newCluster.id,
              cluster_code: data.clusterCode,
              is_cluster: true
            }
            const guildOutcome = await writeAndReconcileGuildAuthority(
              authority,
              { mode: 'existing', prior: existingGuild },
              guildTarget,
              async () => {
                const { data: updatedGuild, error: updateError } =
                  await guildAssignment
                    .select(
                      'id, guild_code, guild_id, cluster_id, cluster_code, is_cluster, display_name'
                    )
                    .maybeSingle()
                return { data: updatedGuild, error: updateError }
              }
            )

            if (guildOutcome.state === 'unknown') {
              logger.error(
                {
                  guildCode: existingGuild.guild_code,
                  guildId: existingGuild.id,
                  writeOutcome: guildOutcome.writeOutcome,
                  readOutcome: guildOutcome.readOutcome
                },
                'Existing founding-guild assignment state is unknown'
              )
              errors.push(
                `Guild ${guildLabel} may require support before retrying. (CLUSTER_CREATE_GUILD_STATE_UNKNOWN)`
              )
              continue
            }

            if (guildOutcome.state !== 'target') {
              logger.error(
                {
                  guildCode: existingGuild.guild_code,
                  guildId: existingGuild.id,
                  writeOutcome: guildOutcome.writeOutcome,
                  readOutcome: guildOutcome.readOutcome
                },
                'Failed to assign existing founding guild'
              )
              errors.push(
                `Guild ${guildLabel} was not added. (CLUSTER_CREATE_GUILD_UPDATE_FAILED)`
              )
              continue
            }

            const targetCluster = {
              id: newCluster.id,
              cluster_code: data.clusterCode,
              guild_code: existingGuild.guild_code
            }
            const mappingOutcome = await completeClusterAuthoritySequence({
              authority,
              currentMapping: profile,
              userId: user.id,
              clusterTarget: targetCluster
            })

            if (mappingOutcome.state === 'unknown') {
              logger.error(
                {
                  guildCode: existingGuild.guild_code,
                  guildId: existingGuild.id,
                  patchOutcome: mappingOutcome.patchOutcome,
                  readOutcome: mappingOutcome.readOutcome
                },
                'Existing founding-guild mapping state is unknown'
              )
              errors.push(
                `Guild ${guildLabel} may require support before retrying. (CLUSTER_CREATE_MAPPING_STATE_UNKNOWN)`
              )
              continue
            }

            if (mappingOutcome.state === 'prior') {
              const guildRollback = authority
                .from('guild_config')
                .update({
                  cluster_id: existingGuild.cluster_id,
                  cluster_code: existingGuild.cluster_code,
                  is_cluster: existingGuild.is_cluster,
                  updated_at: new Date().toISOString()
                })
                .eq('id', existingGuild.id)
                .eq('guild_code', existingGuild.guild_code)
                .eq('guild_id', storedGuildId)
                .eq('cluster_id', newCluster.id)
                .eq('cluster_code', data.clusterCode)
                .eq('is_cluster', true)

              const { data: restoredGuild, error: rollbackError } =
                await guildRollback
                  .select(
                    'id, guild_code, guild_id, cluster_id, cluster_code, is_cluster'
                  )
                  .maybeSingle()
              const rollbackWitnessMatches =
                restoredGuild?.id === existingGuild.id &&
                guildIdentitiesMatch(
                  restoredGuild.guild_code,
                  existingGuild.guild_code
                ) &&
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
                    guildCode: existingGuild.guild_code,
                    guildId: existingGuild.id,
                    failure: rollbackError
                      ? 'database_error'
                      : 'witness_mismatch'
                  },
                  'Failed to restore existing founding-guild assignment'
                )
                errors.push(
                  `Guild ${guildLabel} may require support before retrying. (CLUSTER_CREATE_EXISTING_COMPENSATION_FAILED)`
                )
              } else {
                errors.push(
                  `Guild ${guildLabel} was not added because membership changed. Refresh and retry. (CLUSTER_CREATE_MAPPING_RETRY)`
                )
              }
            }
          } else {
            errors.push(
              ownsByMapping
                ? `Guild ${guildLabel} was not added because its stored and live guild IDs could not be verified.`
                : `Guild ${guildLabel} already exists and cannot be claimed. Only your current mapped guild can be added.`
            )
          }
          continue
        }

        const ownsByMapping = guildIdentitiesMatch(
          profile?.guild_code,
          canonicalRequestedGuildCode
        )
        let apiKeyFields: Record<string, unknown> = {}
        if (guild.apiKey) {
          if (
            !validationResult ||
            !apiKeyProvesGuild(validationResult, canonicalRequestedGuildCode)
          ) {
            errors.push(
              `Guild ${guildLabel}: API key belongs to a different guild`
            )
            continue
          }
          const encryptedKey = await encryptApiKey(guild.apiKey)
          apiKeyFields = generateApiKeyUpdatePayload(
            encryptedKey,
            validationResult,
            undefined
          )
        }

        if (!profile || !ownsByMapping) {
          errors.push(
            `Guild ${guildLabel} was not added because it is not the creator's current mapped guild.`
          )
          continue
        }

        const expectedGuildId = validationResult?.guildInfo?.guildId ?? null
        const guildTarget: GuildAuthorityTarget = {
          guild_code: canonicalRequestedGuildCode,
          guild_id: expectedGuildId,
          cluster_id: newCluster.id,
          cluster_code: data.clusterCode,
          is_cluster: true
        }
        const guildOutcome = await writeAndReconcileGuildAuthority(
          authority,
          { mode: 'insert' },
          guildTarget,
          async () => {
            const { data: insertedGuild, error: guildInsertError } =
              await authority
                .from('guild_config')
                .insert({
                  guild_code: canonicalRequestedGuildCode,
                  guild_tag: validationResult?.guildInfo?.guildCode || null,
                  guild_id: expectedGuildId,
                  display_name: guild.displayName,
                  cluster_id: newCluster.id,
                  cluster_code: data.clusterCode,
                  enabled: true,
                  is_cluster: true,
                  ...(apiKeyFields as Record<string, unknown>),
                  token_offender_threshold: data.tokenOffenderThreshold || 10,
                  token_abuser_threshold: data.tokenAbuserThreshold || 15
                })
                .select(
                  'id, guild_code, guild_id, cluster_id, cluster_code, is_cluster, display_name'
                )
                .single()
            return { data: insertedGuild, error: guildInsertError }
          }
        )

        if (guildOutcome.state === 'unknown') {
          logger.error(
            {
              guildCode: canonicalRequestedGuildCode,
              writeOutcome: guildOutcome.writeOutcome,
              readOutcome: guildOutcome.readOutcome
            },
            'New founding-guild state is unknown after insert'
          )
          errors.push(
            `Guild ${guildLabel} may require support before retrying. (CLUSTER_CREATE_GUILD_STATE_UNKNOWN)`
          )
          continue
        }

        if (guildOutcome.state !== 'target' || !guildOutcome.guild) {
          logger.error(
            {
              guildCode: canonicalRequestedGuildCode,
              writeOutcome: guildOutcome.writeOutcome,
              readOutcome: guildOutcome.readOutcome
            },
            'Failed to create founding guild'
          )
          errors.push(
            `Guild ${guildLabel} was not added. (CLUSTER_CREATE_GUILD_INSERT_FAILED)`
          )
          continue
        }
        const insertedGuild = guildOutcome.guild

        const targetCluster = {
          id: newCluster.id,
          cluster_code: data.clusterCode,
          guild_code: canonicalRequestedGuildCode
        }
        const mappingOutcome = await completeClusterAuthoritySequence({
          authority,
          currentMapping: profile,
          userId: user.id,
          clusterTarget: targetCluster
        })

        if (mappingOutcome.state === 'unknown') {
          logger.error(
            {
              guildCode: canonicalRequestedGuildCode,
              guildId: insertedGuild.id,
              patchOutcome: mappingOutcome.patchOutcome,
              readOutcome: mappingOutcome.readOutcome
            },
            'New founding-guild mapping state is unknown'
          )
          errors.push(
            `Guild ${guildLabel} may require support before retrying. (CLUSTER_CREATE_MAPPING_STATE_UNKNOWN)`
          )
          continue
        }

        if (mappingOutcome.state === 'prior') {
          let cleanupQuery = authority
            .from('guild_config')
            .delete()
            .eq('id', insertedGuild.id)
            .eq('guild_code', canonicalRequestedGuildCode)
            .eq('cluster_id', newCluster.id)
            .eq('cluster_code', data.clusterCode)
            .eq('is_cluster', true)

          cleanupQuery = expectedGuildId
            ? cleanupQuery.eq('guild_id', expectedGuildId)
            : cleanupQuery.is('guild_id', null)

          const { data: removedGuild, error: cleanupError } = await cleanupQuery
            .select(
              'id, guild_code, guild_id, cluster_id, cluster_code, is_cluster'
            )
            .maybeSingle()
          const cleanupWitnessMatches =
            removedGuild?.id === insertedGuild.id &&
            guildIdentitiesMatch(
              removedGuild.guild_code,
              canonicalRequestedGuildCode
            ) &&
            nullableGuildIdentitiesMatch(
              removedGuild.guild_id,
              expectedGuildId
            ) &&
            removedGuild.cluster_id === newCluster.id &&
            guildIdentitiesMatch(removedGuild.cluster_code, data.clusterCode) &&
            removedGuild.is_cluster === true

          if (cleanupError || !cleanupWitnessMatches) {
            logger.error(
              {
                guildCode: canonicalRequestedGuildCode,
                guildId: insertedGuild.id,
                failure: cleanupError ? 'database_error' : 'witness_mismatch'
              },
              'Failed to compensate founding-guild creation'
            )
            errors.push(
              `Guild ${guildLabel} may require support before retrying. (CLUSTER_CREATE_GUILD_COMPENSATION_FAILED)`
            )
          } else {
            errors.push(
              `Guild ${guildLabel} was not added because membership changed. Refresh and retry. (CLUSTER_CREATE_MAPPING_RETRY)`
            )
          }
          continue
        }

        if (guild.leaderEmail) {
          // Invitation email is not implemented.
        }
      }
    }

    const responseData: {
      success: true
      cluster: typeof newCluster
      message: string
      inviteCode?: string
      setupMethod?: 'invite_code'
      warnings?: string[]
    } = {
      success: true,
      cluster: newCluster,
      message: `Cluster ${data.clusterCode} successfully created!`
    }

    if (inviteCode) {
      responseData.inviteCode = inviteCode
      responseData.setupMethod = 'invite_code'
      responseData.message += ` Invite code: ${inviteCode}`
    }

    if (errors.length > 0) {
      responseData.warnings = errors
      responseData.message = `Cluster ${data.clusterCode} created with some issues. Please review warnings.`
    }

    return NextResponse.json(responseData)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      { failure: 'unhandled_cluster_create_error' },
      'Error creating cluster'
    )
    throw Errors.fromResponse(500, {
      error: 'The cluster could not be created.',
      code: 'CLUSTER_CREATE_INTERNAL_ERROR'
    })
  }
})
