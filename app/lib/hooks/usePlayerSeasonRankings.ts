'use client'

import { useQuery, type UseQueryResult } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { PerformanceMode } from '@tacticus/app-core/performance-calculations.types'
import { createComponentLogger } from '@/app/lib/logging/client'
import {
  applyTokenRatios,
  battleRowsToLong,
  buildResult,
  getGuildPlayerScoresBatchRPC,
  getSeasonTokenStatsBatchRPC,
  targetRowsToLong,
  type LongScoreRow,
  type PlayerNameStatus,
  type PlayerSeasonRankingsResult,
  type TargetScoreRow
} from '@/app/lib/calculations/experimental/player-season-rankings'

const logger = createComponentLogger('hooks.usePlayerSeasonRankings')

// Includes every attacker with `isCurrent`; the roster toggle applies at select time, so queryKey ignores it.

interface PlayerMappingStatusRow {
  player_id?: string | null
  display_name?: string | null
  is_current?: boolean | null
}

async function fetchPlayerNameStatus(
  supabase: TypedSupabaseClient,
  guildCode: string
): Promise<Map<string, PlayerNameStatus>> {
  // Join on player_mapping.player_id (= the RPC's user_id), NOT
  // player_mapping.user_id (the nullable auth UID).
  const { data, error } = await supabase
    .from('player_mapping')
    .select('player_id, display_name, is_current')
    .eq('guild_code', guildCode)
  if (error) throw error

  const byPlayerId = new Map<string, PlayerNameStatus>()
  const rows = Array.isArray(data) ? (data as PlayerMappingStatusRow[]) : []
  for (const r of rows) {
    const id = typeof r.player_id === 'string' ? r.player_id.trim() : ''
    if (!id) continue
    const incoming: PlayerNameStatus = {
      displayName:
        typeof r.display_name === 'string' && r.display_name.trim().length > 0
          ? r.display_name.trim()
          : id,
      isCurrent: r.is_current === true
    }
    const existing = byPlayerId.get(id)
    if (!existing || (incoming.isCurrent && !existing.isCurrent)) {
      byPlayerId.set(id, incoming)
    }
  }
  return byPlayerId
}

async function fetchLongScores(
  supabase: TypedSupabaseClient,
  guildCode: string,
  seasons: string[],
  mode: PerformanceMode
): Promise<LongScoreRow[]> {
  if (mode === 'target-weighted') {
    const params = new URLSearchParams({
      guild: guildCode,
      seasons: seasons.join(',')
    })
    const res = await fetch(
      `/api/guild-trends/target-scores-batch?${params.toString()}`
    )
    if (!res.ok) {
      logger.warn(
        {
          status: res.status,
          statusText: res.statusText,
          guildCode
        },
        'Target-score batch fetch failed'
      )
      return []
    }
    const body = (await res.json()) as { rows?: TargetScoreRow[] }
    return targetRowsToLong(body.rows ?? [])
  }

  const battleRows = await getGuildPlayerScoresBatchRPC(supabase, {
    guild_code: guildCode,
    seasons
  })
  const battleLong = battleRowsToLong(battleRows)

  if (mode === 'token-weighted') {
    const tokenRows = await getSeasonTokenStatsBatchRPC(supabase, {
      guild_code: guildCode,
      seasons
    })
    return applyTokenRatios(battleLong, tokenRows)
  }

  return battleLong
}

export function usePlayerSeasonRankings(
  guildCode: string,
  seasons: string[],
  opts: { mode: PerformanceMode; enabled?: boolean }
): UseQueryResult<PlayerSeasonRankingsResult> {
  return useQuery({
    queryKey: ['player-season-rankings', guildCode, opts.mode, ...seasons],
    queryFn: async () => {
      const supabase = dbClient()
      const [long, nameStatus] = await Promise.all([
        fetchLongScores(supabase, guildCode, seasons, opts.mode),
        fetchPlayerNameStatus(supabase, guildCode)
      ])
      return buildResult(long, nameStatus, seasons)
    },
    enabled: opts.enabled ?? (!!guildCode && seasons.length > 0),
    staleTime: 5 * 60 * 1000,
    gcTime: 15 * 60 * 1000
  })
}
