import { NextResponse } from 'next/server'
import { db, serviceDb } from '@/app/lib/db'
import { requireSessionUser } from '@/app/lib/api/session-user'
import { tacticusAPI } from '@/app/lib/api/tacticus-client'
import { loopIndexFromTier } from '@/app/lib/calculations/loop-from-tier'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.player-api-key.sync')
import { getPlayerApiKey } from '@tacticus/app-core/api-key-helper'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { truncateIsoToWholeSecond } from '@/app/lib/sync/transformers'

interface TokenTimer {
  current?: number
  nextTokenInSeconds?: number
}

interface PlayerProgress {
  guildRaid?: {
    tokens?: TokenTimer
    bombTokens?: TokenTimer
  }
  arena?: {
    tokens?: TokenTimer
  }
  onslaught?: {
    tokens?: TokenTimer
  }
  salvageRun?: {
    tokens?: TokenTimer
  }
  expedition?: {
    tokens?: TokenTimer
  }
}

interface TacticusPlayerData {
  progress?: PlayerProgress
  username?: string
  userId?: string
}

interface TacticusGuildRaidEntry {
  username: string
  userId?: string
  damageType?: 'Battle' | 'Bomb'
  damageDealt?: number
  tier?: number
  set?: number
  startedOn?: number
  completedOn?: number
  encounterType?: string
  encounterIndex?: number
}

interface TacticusGuildRaidData {
  entries?: TacticusGuildRaidEntry[]
  season?: number
}

function toWholeSecondIsoFromEpoch(seconds: number | undefined): string | null {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds)) return null
  const iso = new Date(seconds * 1000).toISOString()
  return truncateIsoToWholeSecond(iso) ?? iso
}

export const POST = withErrorHandler(async () => {
  try {
    const supabase = await db()

    const user = await requireSessionUser(supabase, () =>
      Errors.fromResponse(401, {
        error: 'Authentication required',
        code: 'AUTH_REQUIRED'
      })
    )
    const privilegedSupabase = serviceDb()

    // The encrypted key is not readable by `authenticated`.
    const { data: playerMapping, error: fetchError } = await privilegedSupabase
      .from('player_mapping')
      .select(
        `
        tacticus_api_key_encrypted,
        player_id,
        display_name,
        guild_code
      `
      )
      .eq('user_id', user.id)
      .eq('is_current', true)
      .single()

    if (fetchError) {
      logger.error({ err: fetchError }, 'Failed to fetch player mapping:')
      if (fetchError.code === 'PGRST116') {
        throw Errors.fromResponse(404, {
          error:
            'Player profile not found. Please ensure you have claimed a player.',
          code: 'NO_PROFILE'
        })
      }
      throw Errors.fromResponse(500, {
        error: 'Database error while fetching player profile',
        code: 'DB_ERROR',
        details: fetchError.message
      })
    }

    if (!playerMapping) {
      throw Errors.fromResponse(404, {
        error: 'Player profile not found',
        code: 'NO_PROFILE'
      })
    }

    const apiKey = await getPlayerApiKey(playerMapping)

    if (!apiKey) {
      throw Errors.fromResponse(400, {
        error: 'No API key found. Please add your API key first.',
        code: 'NO_API_KEY'
      })
    }

    let guildConfig: {
      cluster_code: string | null
      cluster_id: string | null
    } | null = null
    if (playerMapping.guild_code) {
      const configData = await GuildConfigService.getBasic(
        supabase,
        playerMapping.guild_code
      )
      if (configData) {
        guildConfig = {
          cluster_code: configData.cluster_code,
          cluster_id: configData.cluster_id
        }
      }
    }

    const isValidKey = await tacticusAPI.validateApiKey(apiKey)
    if (!isValidKey) {
      const { error: invalidationError } = await privilegedSupabase
        .from('player_mapping')
        .update({
          api_key_is_valid: false,
          api_key_last_verified: new Date().toISOString()
        })
        .eq('user_id', user.id)
        .eq('is_current', true)

      if (invalidationError) throw invalidationError

      throw Errors.fromResponse(401, {
        error: 'Your API key is no longer valid. Please update it.',
        code: 'INVALID_API_KEY'
      })
    }

    const playerData = await tacticusAPI.getPlayer(apiKey)
    if (!playerData) {
      throw Errors.fromResponse(503, {
        error: 'Failed to fetch player data from Tacticus API',
        code: 'PLAYER_DATA_FAILED'
      })
    }

    const guildRaidData = (await tacticusAPI.getCurrentGuildRaid(
      apiKey
    )) as TacticusGuildRaidData | null

    // Token status still updates without guild raid data.
    let syncMessage = ''
    let battlesUpdated = 0

    if (guildRaidData?.entries && playerMapping.guild_code) {
      // Names are not unique: match by userId, falling back to display name for id-less entries.
      const playerEntries = guildRaidData.entries.filter((entry) =>
        entry.userId
          ? entry.userId === playerMapping.player_id
          : entry.username === playerMapping.display_name
      )

      if (playerEntries.length > 0) {
        const { data: seasonData } = await supabase.rpc('get_current_season')

        const currentSeason =
          (seasonData as string | null) ||
          guildRaidData.season?.toString() ||
          'unknown'
        const guildCode = playerMapping.guild_code

        const dbEntries = playerEntries.flatMap((entry) => {
          const startedOn = toWholeSecondIsoFromEpoch(entry.startedOn)
          const completedOn = toWholeSecondIsoFromEpoch(entry.completedOn)
          const userId = entry.userId || playerMapping.player_id
          if (!startedOn || !completedOn || !userId) return []

          const encounterIndex =
            typeof entry.encounterIndex === 'number' ? entry.encounterIndex : 0
          const tier = entry.tier || 0
          const loopIndex = loopIndexFromTier(tier)

          return [
            {
              Guild: guildCode,
              Season: currentSeason,
              displayName: playerMapping.display_name,
              userId,
              damageType: entry.damageType || 'Battle',
              damageDealt: entry.damageDealt || 0,
              tier: tier,
              set: entry.set || 0,
              startedOn,
              completedOn,
              encounterType: entry.encounterType || 'Boss',
              encounterIndex: encounterIndex,
              encounterId: encounterIndex,
              cluster_code: guildConfig?.cluster_code || null,
              cluster_id: guildConfig?.cluster_id || null,
              loopIndex: loopIndex
            }
          ]
        })

        if (dbEntries.length > 0) {
          // `authenticated` has no INSERT on EOT_GR_data (cross-tenant risk). Safe here because Guild, Season
          // and displayName come from the caller's own mapping and userId is pinned to the caller's player_id.
          const { error: upsertError } = await serviceDb()
            .from('EOT_GR_data')
            .upsert(dbEntries, {
              onConflict:
                'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType',
              ignoreDuplicates: true
            })

          if (!upsertError) {
            battlesUpdated = dbEntries.length
            syncMessage = `Synced ${battlesUpdated} battles`
          } else {
            logger.error({ err: upsertError }, 'Failed to upsert entries:')
            syncMessage = 'Failed to sync battle data'
          }
        } else {
          syncMessage = 'No valid battles found for current season'
        }
      } else {
        syncMessage = 'No battles found for current season'
      }
    } else {
      syncMessage = 'Battle history unavailable, but token status retrieved'
    }

    let tokenInfo = null
    if (
      playerData &&
      typeof playerData === 'object' &&
      'progress' in playerData
    ) {
      const progress = (playerData as TacticusPlayerData).progress

      tokenInfo = {
        tokensAvailable: progress?.guildRaid?.tokens?.current ?? 0,
        bombsAvailable: progress?.guildRaid?.bombTokens?.current ?? 0,
        nextTokenSeconds:
          progress?.guildRaid?.tokens?.nextTokenInSeconds ?? null,
        nextBombSeconds:
          progress?.guildRaid?.bombTokens?.nextTokenInSeconds ?? null,

        arenaTokens: progress?.arena?.tokens?.current ?? null,
        nextArenaTokenSeconds:
          progress?.arena?.tokens?.nextTokenInSeconds ?? null,

        onslaughtTokens: progress?.onslaught?.tokens?.current ?? null,
        nextOnslaughtTokenSeconds:
          progress?.onslaught?.tokens?.nextTokenInSeconds ?? null,

        salvageTokens: progress?.salvageRun?.tokens?.current ?? null,
        nextSalvageTokenSeconds:
          progress?.salvageRun?.tokens?.nextTokenInSeconds ?? null,

        expeditionTokens: progress?.expedition?.tokens?.current ?? null,
        nextExpeditionTokenSeconds:
          progress?.expedition?.tokens?.nextTokenInSeconds ?? null
      }

      if (progress?.guildRaid) {
        const { error: tokenUpdateError } = await privilegedSupabase
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
          .eq('user_id', user.id)
          .eq('is_current', true)

        if (tokenUpdateError) throw tokenUpdateError

        if (battlesUpdated > 0) {
          syncMessage = `${syncMessage} and token status updated`
        } else {
          syncMessage = 'Token status updated successfully'
        }
      }
    } else {
      const { error: verificationUpdateError } = await privilegedSupabase
        .from('player_mapping')
        .update({
          api_key_last_verified: new Date().toISOString(),
          api_key_is_valid: true
        })
        .eq('user_id', user.id)
        .eq('is_current', true)

      if (verificationUpdateError) throw verificationUpdateError
    }

    return NextResponse.json({
      success: true,
      message: syncMessage || 'Sync completed',
      battlesUpdated,
      tokenInfo,
      playerName: playerMapping.display_name
    })
  } catch (error: unknown) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Sync error:')
    const errorMessage = extractSyncErrorMessage(error)
    throw Errors.fromResponse(500, {
      error: 'An error occurred while syncing',
      code: 'SYNC_ERROR',
      details: errorMessage
    })
  }
})

function extractSyncErrorMessage(error: unknown): string {
  if (typeof error === 'string') {
    return error
  }

  if (error instanceof Error) {
    return error.message
  }

  if (error && typeof error === 'object') {
    const nested = error as { message?: unknown; error?: { message?: unknown } }
    if (typeof nested.message === 'string') {
      return nested.message
    }

    if (nested.error && typeof nested.error.message === 'string') {
      return nested.error.message
    }
  }

  return 'Unknown error'
}
