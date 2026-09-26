import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'api.discord.interactions.command-handlers.handlers.tokens.fetch-guild-tokens'
)
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import { loadGuildTokenStatuses } from '@/app/api/guild-tokens/token-service'
import type { Supabase } from '../../types'
import { getCurrentSeason } from './shared'
import { fetchGuildTokensFast } from './guild-raid-tokens'
import { resolveVerifiedDiscordIdentities } from '@/app/lib/auth/verified-player-authority'

export type FetchGuildTokensSuccess = {
  ok: true
  players: Array<{
    displayName: string
    discordUserId: string | null
    tokensAvailable: number
    tokensUsed: number
    bombsAvailable: number
    tokenCooldown: string | null
    tokenNextSeconds: number | null
    bombCooldown: string | null
  }>
}

export type GuildTokenCandidate = FetchGuildTokensSuccess['players'][number] & {
  playerId: string
}

export type FetchGuildTokenCandidatesResult =
  | {
      ok: true
      players: GuildTokenCandidate[]
    }
  | FetchGuildTokensFailure

export type FetchGuildTokensFailure = {
  ok: false
  message: string
}

export type FetchGuildTokensResult =
  FetchGuildTokensSuccess | FetchGuildTokensFailure

async function retainVerifiedDiscordIds(
  supabase: Supabase,
  guildCode: string,
  result: Extract<FetchGuildTokenCandidatesResult, { ok: true }>
): Promise<FetchGuildTokensSuccess> {
  const verified = await resolveVerifiedDiscordIdentities(
    supabase,
    result.players
      .map((player) => player.discordUserId)
      .filter((id): id is string => Boolean(id))
  )
  const allowed = new Set(
    verified
      .filter((row) => row.guildCode === guildCode)
      .map((row) => `${row.playerId}\u0000${row.discordUserId}`)
  )
  return {
    ...result,
    players: result.players.map(({ playerId, ...player }) => ({
      ...player,
      discordUserId:
        player.discordUserId &&
        allowed.has(`${playerId}\u0000${player.discordUserId}`)
          ? player.discordUserId
          : null
    }))
  }
}

export async function fetchGuildTokens(
  supabase: Supabase,
  guildCode: string,
  season?: string,
  clusterCode?: string | null
): Promise<FetchGuildTokensResult> {
  // Fast path: one /guildRaid call; needs the current season and a guild key.
  const requestedSeason = (season ?? '').trim()
  let requestsCurrentSeason = !requestedSeason
  if (requestedSeason) {
    try {
      requestsCurrentSeason =
        requestedSeason === (await getCurrentSeason(supabase))
    } catch {
      requestsCurrentSeason = false
    }
  }
  if (requestsCurrentSeason) {
    const fastResult = await fetchGuildTokensFast(supabase, guildCode)
    if (fastResult) {
      return fastResult.ok
        ? retainVerifiedDiscordIds(supabase, guildCode, fastResult)
        : fastResult
    }
  }

  try {
    let resolvedSeason = (season ?? '').trim()
    if (!resolvedSeason) {
      resolvedSeason = await getCurrentSeason(supabase)
    }

    if (!resolvedSeason) {
      return {
        ok: false,
        message:
          'Unable to determine which season to evaluate. Provide a season value and retry.'
      }
    }

    const { players } = await loadGuildTokenStatuses(supabase, {
      guildCode,
      season: resolvedSeason,
      clusterCode,
      verifyLiveRoster: true
    })

    return retainVerifiedDiscordIds(supabase, guildCode, {
      ok: true,
      players: players.map((player) => ({
        playerId: player.player_id,
        displayName: player.display_name || 'Unknown',
        discordUserId: player.discord_user_id ?? null,
        tokensAvailable: player.tokens_available,
        tokensUsed: player.tokens_used,
        bombsAvailable: player.bombs_available,
        tokenCooldown: player.token_cooldown,
        tokenNextSeconds:
          player.token_next_in_seconds ?? player.next_token_seconds ?? null,
        bombCooldown: player.bomb_cooldown
      }))
    })
  } catch (error) {
    rethrowIfAppError(error)
    logger.error(
      { err: error },
      'Failed to load guild token data for Discord command:'
    )
    return {
      ok: false,
      message:
        'Unable to load guild token data right now. Please try again later.'
    }
  }
}
