'use client'

import { useQuery } from '@tanstack/react-query'

import { dbClient } from '@/app/lib/db/client'
import { canManageHeraldRole } from '@/app/lib/auth/role-predicates'
import { normalizeDisplayName } from '@/app/lib/utils/normalize'
import {
  calculateBurnedTokens,
  computeGuildMaxPossibleTokens
} from '@/app/lib/calculations/token-burn'
import {
  isAbortError,
  setUniqueName,
  throwIfAborted,
  toCappedAvailabilityOrNull,
  toNonNegativeInt,
  toNonNegativeIntOrNull
} from './helpers'
import { queryKeys } from './query-keys'
import type { LiveAvailabilityRow, TokenUsageBurnRpcRow } from './types'

interface LiveAvailabilityEntry {
  tokensAvailable: number | null
  tokenNextSeconds: number | null
}

// Look up by stable player_id first; unique normalized display_name only as fallback.
function buildLiveAvailabilityLookups(rows: LiveAvailabilityRow[]) {
  const byPlayerId = new Map<string, LiveAvailabilityEntry>()
  const byName = new Map<string, LiveAvailabilityEntry>()
  const duplicates = new Set<string>()
  rows.forEach((row) => {
    const entry = {
      tokensAvailable: toCappedAvailabilityOrNull(row.tokens_available),
      tokenNextSeconds: toNonNegativeIntOrNull(row.token_next_in_seconds)
    }
    if (typeof row.player_id === 'string' && row.player_id) {
      byPlayerId.set(row.player_id, entry)
    }
    if (typeof row.display_name === 'string' && row.display_name) {
      setUniqueName(
        byName,
        duplicates,
        normalizeDisplayName(row.display_name),
        entry
      )
    }
  })
  return { byPlayerId, byName }
}

export function enrichTokenBurnRows(
  rpcRows: TokenUsageBurnRpcRow[],
  liveRows: LiveAvailabilityRow[]
) {
  const live = buildLiveAvailabilityLookups(liveRows)
  // Burn helper shared with Token Usage and the Discord bot, incl. fractional regen credit.
  const enriched = rpcRows.map((row) => {
    const playerId = typeof row.player_id === 'string' ? row.player_id : ''
    const displayName =
      typeof row.display_name === 'string' ? row.display_name : ''
    const current =
      (playerId ? live.byPlayerId.get(playerId) : undefined) ??
      (displayName
        ? live.byName.get(normalizeDisplayName(displayName))
        : undefined)
    return {
      ...row,
      tokens_used: toNonNegativeInt(row.tokens_used),
      tokens_available:
        current?.tokensAvailable ??
        toCappedAvailabilityOrNull(row.tokens_available),
      token_next_in_seconds:
        current?.tokenNextSeconds ??
        toNonNegativeIntOrNull(row.token_next_in_seconds)
    }
  })
  const maximum = computeGuildMaxPossibleTokens(
    enriched.map((row) => ({
      totalTokens: row.tokens_used ?? 0,
      tokensAvailable: row.tokens_available ?? 0
    }))
  )
  return enriched.map((row) => ({
    ...row,
    burned_tokens: calculateBurnedTokens(
      maximum,
      row.tokens_available,
      row.tokens_used ?? 0,
      row.token_next_in_seconds ?? null
    )
  })) as TokenUsageBurnRpcRow[]
}

export function useTokenBurnRows(
  selectedGuild: string,
  selectedSeason: string,
  enabled: boolean,
  userRole?: string
) {
  // The page supplies the freshly checked membership profile role, not Auth metadata.
  const includeAvailability = canManageHeraldRole(userRole)
  return useQuery({
    queryKey: [
      ...queryKeys.tokenBurnStats(selectedGuild, selectedSeason),
      includeAvailability
    ],
    queryFn: async ({ signal }) => {
      const supabase = dbClient()
      // Burn is recomputed client-side, so freshness can differ from the bot.
      const [rpcRows, liveRows] = await Promise.all([
        supabase
          .rpc('get_token_usage_for_guild', {
            p_guild_code: selectedGuild,
            p_season: selectedSeason
          })
          .then((result) => {
            if (result.error) throw result.error
            return Array.isArray(result.data)
              ? (result.data as TokenUsageBurnRpcRow[])
              : []
          }),
        includeAvailability
          ? fetch(
              `/api/guild-tokens?guild=${encodeURIComponent(selectedGuild)}&season=${encodeURIComponent(selectedSeason)}`,
              { signal }
            )
              .then((response) =>
                response.ok
                  ? (response.json() as Promise<{
                      players?: LiveAvailabilityRow[]
                    }>)
                  : { players: [] as LiveAvailabilityRow[] }
              )
              .then((body) => (Array.isArray(body.players) ? body.players : []))
              .catch((error) => {
                if (isAbortError(error)) throw error
                return [] as LiveAvailabilityRow[]
              })
          : Promise.resolve([] as LiveAvailabilityRow[])
      ])
      throwIfAborted(signal)
      return enrichTokenBurnRows(rpcRows, liveRows)
    },
    enabled,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}
