import { NextResponse } from 'next/server'
import { getTokenUsage, type TokenUsageData } from '@/app/lib/data/token-usage'
import { serviceDb } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('api.members.token-usage')
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { Errors, rethrowIfAppError } from '@/app/lib/errors/AppError'
import { loadGuildTokenStatuses } from '@/app/api/guild-tokens/token-service'
import { requireTokenUsageGuildAccess } from './access'

export const dynamic = 'force-dynamic'

interface TokenUsagePayloadRow {
  display_name: string
  player_id: string | null
  tokens_used: number
  max_possible: number
  bombs_used: number
  bombs_available: number
  tokens_available: number | null
  token_next_in_seconds: number | null
  bombs_available_live: number | null
  bomb_next_in_seconds: number | null
  burned_tokens: number | null
  time_over_cap_seconds: number | null
  data_source: string | null
}

// Each compute is a ~30s rate-limited fan-out; the TTL must exceed it and stay far below the 12h regen.
const CACHE_TTL_MS = 5 * 60 * 1000
const tokenUsageCache = new Map<
  string,
  { at: number; payload: TokenUsagePayloadRow[] }
>()
const inflight = new Map<string, Promise<TokenUsagePayloadRow[]>>()

function createComputeFailure(stage: string, reason: unknown): Error {
  return new Error(`${stage} failed`, { cause: reason })
}

/** Service client on purpose: guild-wide result, requests gated by requireTokenUsageGuildAccess. */
async function computeTokenUsagePayload(
  guild: string,
  season: string,
  clusterCode: string | null
): Promise<TokenUsagePayloadRow[]> {
  const supabase = serviceDb()
  const t0 = Date.now()
  const timings: Record<string, number> = {}

  const wrappedGetTokenUsage = getTokenUsage(guild, season, supabase).then(
    (r) => {
      timings['getTokenUsage'] = Date.now() - t0
      return r
    },
    (err) => {
      timings['getTokenUsage_failed'] = Date.now() - t0
      throw err
    }
  )
  const wrappedLoadStatuses = loadGuildTokenStatuses(supabase, {
    guildCode: guild,
    season,
    clusterCode,
    verifyLiveRoster: false,
    // Capped at ~3s wall-clock; paid once per TTL window.
    skipLiveOverlay: false
  }).then(
    (r) => {
      timings['loadStatuses'] = Date.now() - t0
      return r
    },
    (err) => {
      timings['loadStatuses_failed'] = Date.now() - t0
      throw err
    }
  )

  const [usageResult, statusResult] = await Promise.allSettled([
    wrappedGetTokenUsage,
    wrappedLoadStatuses
  ])

  if (usageResult.status === 'rejected') {
    throw createComputeFailure('token usage query', usageResult.reason)
  }
  const usage: TokenUsageData[] = usageResult.value

  if (statusResult.status === 'rejected') {
    throw createComputeFailure(
      'guild token statuses query',
      statusResult.reason
    )
  }
  const { players: availabilityPlayers } = statusResult.value

  // Separate namespaces so a display name cannot shadow another player's stable id.
  const usageByPlayerId = new Map<string, TokenUsageData>()
  const usageByDisplayName = new Map<string, TokenUsageData>()
  const usageByNormalizedName = new Map<string, TokenUsageData>()
  const normalize = (value?: string | null) =>
    (value ?? '').trim().toLowerCase()
  usage.forEach((row) => {
    if (row.display_name) usageByDisplayName.set(row.display_name, row)
    if (row.player_id) usageByPlayerId.set(row.player_id, row)
    const userId =
      'user_id' in row && typeof row.user_id === 'string' ? row.user_id : null
    if (userId) usageByPlayerId.set(userId, row)
    const norm = normalize(row.display_name)
    if (norm) usageByNormalizedName.set(norm, row)
  })

  const payload: TokenUsagePayloadRow[] = availabilityPlayers.map((player) => {
    const name = player.display_name || ''
    const usageRow =
      (player.player_id ? usageByPlayerId.get(player.player_id) : undefined) ||
      usageByDisplayName.get(name) ||
      usageByNormalizedName.get(normalize(name))

    return {
      display_name: name,
      player_id: player.player_id || null,
      tokens_used: usageRow?.tokens_used ?? player.tokens_used ?? 0,
      max_possible: usageRow?.max_possible ?? player.max_possible ?? 0,
      bombs_used: usageRow?.bombs_used ?? 0,
      bombs_available: usageRow?.bombs_available ?? 0,
      tokens_available: player.tokens_available,
      token_next_in_seconds: player.token_next_in_seconds,
      bombs_available_live: player.bombs_available,
      bomb_next_in_seconds: player.next_bomb_seconds,
      burned_tokens: null,
      time_over_cap_seconds: null,
      data_source: player.data_source
    }
  })

  timings['total'] = Date.now() - t0
  if (timings['total'] > 1500) {
    logger.warn(
      { guild, season, timings, playerCount: payload.length },
      'Token usage slow compute breakdown'
    )
  }

  return payload
}

export const GET = withErrorHandler(async (request: Request) => {
  try {
    const { searchParams } = new URL(request.url)
    const requestedGuild = searchParams.get('guild')
    const season = searchParams.get('season')

    if (!requestedGuild || !season) {
      throw Errors.fromResponse(400, {
        error: 'Guild and season parameters required'
      })
    }

    // Runs on every call, cache hits included.
    const { guild, clusterCode } =
      await requireTokenUsageGuildAccess(requestedGuild)

    const key = `${guild}:${season}`
    const cached = tokenUsageCache.get(key)
    const isFresh = cached && Date.now() - cached.at < CACHE_TTL_MS
    if (isFresh) {
      return NextResponse.json(cached.payload)
    }

    let refresh = inflight.get(key)
    if (!refresh) {
      refresh = computeTokenUsagePayload(guild, season, clusterCode)
        .then((payload) => {
          // Empty payloads may be a transient failure.
          if (payload.length > 0) {
            tokenUsageCache.set(key, { at: Date.now(), payload })
          }
          return payload
        })
        .catch((err) => {
          // Never cache failures; cold requests reject so callers can tell failure from an empty guild.
          const stalePayload = tokenUsageCache.get(key)?.payload
          if (stalePayload) {
            logger.error(
              { guild, season, err },
              'Token usage background refresh failed; serving stale cache'
            )
            return stalePayload
          }
          throw err
        })
        .finally(() => {
          inflight.delete(key)
        })
      inflight.set(key, refresh)
    }

    if (cached) {
      return NextResponse.json(cached.payload)
    }
    return NextResponse.json(await refresh)
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Token usage API error:')
    throw Errors.external('Token usage data temporarily unavailable', 503, {
      cause: error instanceof Error ? error.message : String(error)
    })
  }
})
