import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import { NextRequest, NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { settledMapWithConcurrency } from '@/app/lib/utils/bounded-fanout'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.guild-tokens.sync')
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import { validateApiKeyWithTacticus } from '@tacticus/app-core/api-key-validation'
import { CLUSTER_LOOKUP_SELECT } from '@/app/lib/guild-config-selects'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'

interface GuildMember {
  player_id: string
  display_name: string
  tacticus_api_key_encrypted: string | null
  user_id: string | null
}

interface MemberSyncResult {
  success: boolean
  player?: string
  reason?: string
  tokens?: number
  bombs?: number
}

interface SyncDetailSuccess {
  success: true
  player: string
  tokens: number
  bombs: number
}

interface SyncDetailFailure {
  success: false
  player?: string
  reason: string
}

type SyncDetail = SyncDetailSuccess | SyncDetailFailure

interface SyncResult {
  success: boolean
  message: string
  syncedCount: number
  failedCount: number
  totalMembers: number
  failureSummary?: Record<string, number>
  failedMembers?: string[]
  failedMemberDetails?: Array<{ player?: string; reason: string }>
  details?: SyncDetail[]
  fromCache?: boolean
  cacheAge?: number
}

const syncCache = new Map<string, { timestamp: number; data: SyncResult }>()
const CACHE_DURATION = 2 * 60 * 1000 // 2 minutes in milliseconds
// Guilds cap at 30 members, so the member cap is a runaway guard only.
const MEMBER_SYNC_FANOUT_CONCURRENCY = 4
const MAX_MEMBER_SYNC_FANOUT_MEMBERS = 40

interface TokenInfo {
  tokensAvailable: number
  bombsAvailable: number
  nextTokenSeconds: number | null
  nextBombSeconds: number | null
}

interface PlayerGuildRaidProgress {
  guildRaid?: {
    tokens?: {
      current: number
      nextTokenInSeconds?: number
    }
    bombTokens?: {
      current: number
      nextTokenInSeconds?: number
    }
  }
}

interface PlayerData {
  progress?: PlayerGuildRaidProgress
}

export const POST = withErrorHandler(async (request: NextRequest) => {
  try {
    const { guild } = await request.json()

    if (typeof guild !== 'string' || !guild.trim()) {
      throw Errors.fromResponse(400, {
        error: 'Guild code is required'
      })
    }

    const supabase = await db()
    const serviceSupabase = serviceDb()

    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, {
        error: 'Authentication required'
      })
    )

    const resolvedGuild = await GuildConfigService.findByCodeOrTag(
      serviceSupabase,
      guild
    )
    const normalizedGuild =
      resolvedGuild?.guild_code ?? GuildConfigService.normalizeCode(guild)

    const { data: userProfile } = await supabase
      .from('player_with_cluster')
      .select(CLUSTER_LOOKUP_SELECT)
      .eq('user_id', user.id)
      .single()

    if (
      !userProfile ||
      !userProfile.guild_code ||
      GuildConfigService.normalizeCode(userProfile.guild_code) !==
        normalizedGuild
    ) {
      throw Errors.fromResponse(403, {
        error: 'You can only sync data for your own guild'
      })
    }

    const userClusterCode = userProfile.cluster_code

    const guildConfig =
      resolvedGuild ??
      (await GuildConfigService.getBasic(serviceSupabase, normalizedGuild))
    const guildClusterCode = guildConfig?.cluster_code

    if (userClusterCode !== guildClusterCode) {
      throw Errors.fromResponse(403, {
        error: 'You can only sync data for guilds in your cluster'
      })
    }

    // Keep the cache read below both 403s: findByCodeOrTag accepts a public tag.
    const cacheKey = `guild_sync_${normalizedGuild}`
    const cached = syncCache.get(cacheKey)

    if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
      return NextResponse.json({
        ...cached.data,
        fromCache: true,
        cacheAge: Math.round((Date.now() - cached.timestamp) / 1000)
      })
    }

    const { data: members, error: membersError } = await guildRosterQuery(
      serviceSupabase,
      normalizedGuild,
      'player_id, display_name, tacticus_api_key_encrypted, user_id'
    )
      .eq('is_active', true)
      .not('tacticus_api_key_encrypted', 'is', null)
      .neq('tacticus_api_key_encrypted', '')

    if (membersError) {
      logger.error({ err: membersError }, 'Error fetching members:')
      throw Errors.fromResponse(500, {
        error: 'Failed to fetch guild members'
      })
    }

    if (!members || members.length === 0) {
      const result = {
        success: true,
        message: 'No members with API keys found',
        syncedCount: 0,
        failedCount: 0,
        totalMembers: 0
      }

      syncCache.set(cacheKey, {
        timestamp: Date.now(),
        data: result
      })

      return NextResponse.json(result)
    }

    // Bounded: the circuit breaker does not limit volume against a healthy upstream.
    const membersToSync = (members as GuildMember[]).slice(
      0,
      MAX_MEMBER_SYNC_FANOUT_MEMBERS
    )
    if ((members as GuildMember[]).length > membersToSync.length) {
      logger.warn(
        {
          eligible: (members as GuildMember[]).length,
          cap: MAX_MEMBER_SYNC_FANOUT_MEMBERS
        },
        'Member sync fan-out truncated to per-invocation cap'
      )
    }
    const syncResults = await settledMapWithConcurrency(
      membersToSync,
      MEMBER_SYNC_FANOUT_CONCURRENCY,
      async (member: GuildMember): Promise<MemberSyncResult> => {
        try {
          if (!member.tacticus_api_key_encrypted) {
            await serviceSupabase
              .from('player_mapping')
              .update({
                api_key_is_valid: false,
                api_key_last_verified: new Date().toISOString()
              })
              .eq('player_id', member.player_id)
              .eq('is_current', true)

            return {
              success: false,
              player: member.display_name,
              reason: 'No encrypted API key found - marked as invalid'
            }
          }

          const apiKey = await getPlayerApiKey(member)

          if (!apiKey) {
            return {
              success: false,
              player: member.display_name,
              reason: 'Failed to decrypt API key'
            }
          }

          const validationResult = await validateApiKeyWithTacticus(
            apiKey,
            true,
            { skipFormatValidation: true }
          )

          if (!validationResult.isValid) {
            const statusCode = validationResult.statusCode
            const isUnauthorized = statusCode === 401 || statusCode === 403

            if (isUnauthorized) {
              await serviceSupabase
                .from('player_mapping')
                .update({
                  api_key_is_valid: false,
                  api_key_last_verified: new Date().toISOString()
                })
                .eq('player_id', member.player_id)
                .eq('is_current', true)

              return {
                success: false,
                player: member.display_name,
                reason: 'API key rejected by Tacticus'
              }
            }

            const failureReason = validationResult.error
              ? `Validation error: ${validationResult.error}`
              : statusCode
                ? `Validation failed with status ${statusCode}`
                : 'Validation failed - unknown error'

            return {
              success: false,
              player: member.display_name,
              reason: failureReason
            }
          }

          const playerData = (await tacticusAPI.getPlayerWithRetry(
            apiKey
          )) as PlayerData | null

          if (!playerData || !playerData.progress) {
            return {
              success: false,
              player: member.display_name,
              reason: 'No player data'
            }
          }

          const progress = playerData.progress
          if (!progress?.guildRaid) {
            return {
              success: false,
              player: member.display_name,
              reason: 'No guild raid data'
            }
          }

          const tokenInfo: TokenInfo = {
            tokensAvailable: progress.guildRaid.tokens?.current || 0,
            bombsAvailable: progress.guildRaid.bombTokens?.current || 0,
            nextTokenSeconds:
              progress.guildRaid.tokens?.nextTokenInSeconds || null,
            nextBombSeconds:
              progress.guildRaid.bombTokens?.nextTokenInSeconds || null
          }

          const { error: updateError } = await serviceSupabase
            .from('player_mapping')
            .update({
              api_key_last_verified: new Date().toISOString(),
              api_key_is_valid: true,
              last_sync_tokens: tokenInfo.tokensAvailable,
              last_sync_bombs: tokenInfo.bombsAvailable,
              last_sync_at: new Date().toISOString(),
              next_token_seconds: tokenInfo.nextTokenSeconds,
              next_bomb_seconds: tokenInfo.nextBombSeconds
            })
            .eq('player_id', member.player_id)
            .eq('is_current', true)

          if (updateError) {
            logger.error(
              {
                code: updateError.code
              },
              'Failed to update member token state'
            )
            return {
              success: false,
              player: member.display_name,
              reason: `Database update failed: ${updateError.message || updateError.code || 'Unknown error'}`
            }
          }

          return {
            success: true,
            player: member.display_name,
            tokens: tokenInfo.tokensAvailable,
            bombs: tokenInfo.bombsAvailable
          }
        } catch (error) {
          rethrowIfAppError(error)
          logger.error({ err: error }, 'Error syncing member token state')
          return {
            success: false,
            player: member.display_name,
            reason: 'Sync error'
          }
        }
      }
    )

    const successful = syncResults.filter(
      (r) => r.status === 'fulfilled' && r.value.success
    ).length
    const failed = syncResults.filter(
      (r) =>
        r.status === 'rejected' ||
        (r.status === 'fulfilled' && !r.value.success)
    ).length

    const details: SyncDetail[] = syncResults.map((result) => {
      if (result.status === 'fulfilled') {
        const payload = result.value

        if (payload.success) {
          return {
            success: true as const,
            player: payload.player ?? 'Unknown',
            tokens: payload.tokens ?? 0,
            bombs: payload.bombs ?? 0
          }
        }

        return {
          success: false as const,
          player: payload.player,
          reason: payload.reason ?? 'Unknown error'
        }
      }

      return { success: false, reason: 'Network error' }
    })

    const failureSummary = details
      .filter((detail): detail is SyncDetailFailure => detail.success === false)
      .reduce<Record<string, number>>((acc, detail) => {
        const reason = detail.reason ?? 'Unknown error'
        acc[reason] = (acc[reason] || 0) + 1
        return acc
      }, {})

    const failedDetails = details.filter(
      (detail): detail is SyncDetailFailure => detail.success === false
    )
    const failedMembers = failedDetails
      .map((detail) => detail.player)
      .filter((player): player is string => Boolean(player && player.trim()))

    const failureSummaryText = Object.entries(failureSummary)
      .map(
        ([reason, count]) =>
          `${count} ${count === 1 ? 'member' : 'members'} (${reason})`
      )
      .join(', ')

    const failedMemberDescriptions = failedDetails
      .filter((detail) => detail.player && detail.reason)
      .map((detail) => `${detail.player}: ${detail.reason}`)

    const previewLimit = 3
    const issueDescriptions = failedMemberDescriptions.slice(0, previewLimit)
    const remainingCount =
      failedMemberDescriptions.length - issueDescriptions.length

    const detailedIssues = issueDescriptions.length
      ? `${issueDescriptions.join(', ')}${remainingCount > 0 ? `, +${remainingCount} more` : ''}`
      : ''

    const resultMessageBase = `Synced ${successful} of ${members.length} members with API keys`
    const namedReasons = new Set(
      failedDetails
        .filter((detail) => detail.player && detail.reason)
        .map((detail) => detail.reason as string)
    )

    const summaryForUnnamedFailures = Object.entries(failureSummary)
      .filter(([reason]) => !namedReasons.has(reason))
      .map(
        ([reason, count]) =>
          `${count} ${count === 1 ? 'member' : 'members'} (${reason})`
      )
      .join(', ')

    const issueSegments: string[] = []

    if (detailedIssues) {
      issueSegments.push(detailedIssues)
    }
    if (summaryForUnnamedFailures) {
      issueSegments.push(summaryForUnnamedFailures)
    } else if (!detailedIssues && failureSummaryText) {
      issueSegments.push(failureSummaryText)
    }

    const resultMessage = issueSegments.length
      ? `${resultMessageBase}. Issues: ${issueSegments.join('; ')}`
      : resultMessageBase

    const result: SyncResult = {
      success: true,
      message: resultMessage,
      syncedCount: successful,
      failedCount: failed,
      totalMembers: members.length,
      failedMembers,
      failedMemberDetails: failedDetails.map((detail) => ({
        player: detail.player,
        reason: detail.reason
      }))
    }

    if (failed > 0 && Object.keys(failureSummary).length > 0) {
      result.failureSummary = failureSummary
    }

    if (process.env.NODE_ENV === 'development') {
      result.details = details
    }

    syncCache.set(cacheKey, {
      timestamp: Date.now(),
      data: result
    })

    for (const [key, value] of syncCache.entries()) {
      if (Date.now() - value.timestamp > CACHE_DURATION * 5) {
        syncCache.delete(key)
      }
    }

    return NextResponse.json(result)
  } catch (error) {
    rethrowIfAppError(error)
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error'
    logger.error({ error: errorMessage }, 'Guild sync error:')
    throw Errors.fromResponse(500, {
      error: `Failed to sync guild data: ${errorMessage}`
    })
  }
})
