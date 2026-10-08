'use client'

import { useQuery } from '@tanstack/react-query'
import { dbClient } from '@/app/lib/db/client'
import { logQuery } from '@tacticus/app-core/performance-monitor'
import { getBossDistributionPalette as getBossDistributionColors } from '@tacticus/charting/theme'
import type { Rarity } from '@/app/lib/config'
import { normalizeGuildIdentifier } from '@/app/lib/format/guild'

import {
  type PlayerTokens,
  type BossTokenData,
  type RpcTokenUsageRow,
  type TokenAvailabilityRow,
  type GuildTokenAvailabilityRow,
  type TokenAvailabilityData,
  type RpcTokenData,
  type BattleDataRow,
  type TokenUsageResult,
  DEFAULT_RARITIES
} from '../types'
import {
  fetchSeasonForecast,
  type SeasonForecastEnvelope
} from '@/app/lib/season-forecast/forecast-service'
import { mergeLapProjection } from '@/app/lib/season-forecast/lap-projection-display'
import { mergePlayerProjection } from '@/app/lib/season-forecast/pace-figures'
import type { SeasonOutlookProjection } from '@/app/lib/season-forecast/season-outlook-reduce'
import type { PlayerTokenPaceRow } from '@/app/lib/season-forecast/season-token-economy'

import {
  parseRpcTokenRow,
  parseAvailabilityRow,
  processBattleData,
  processHistoricalData,
  createEmptyTokensByRarity,
  calculateTotalStats,
  calculateBurnedTokens,
  computeGuildMaxPossibleTokens
} from '../utils'

interface UseTokenUsageDataOptions {
  guildCode: string
  season: string
  selectedRarities: Rarity[]
  enabled?: boolean
  enableForecast?: boolean
}

function toNullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason) throw signal.reason
  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}

function setUniqueName<T>(
  map: Map<string, T>,
  duplicates: Set<string>,
  nameKey: string,
  value: T
) {
  if (!nameKey || duplicates.has(nameKey)) return
  if (map.has(nameKey)) {
    map.delete(nameKey)
    duplicates.add(nameKey)
    return
  }
  map.set(nameKey, value)
}

async function fetchBattleHistory(
  guildCode: string,
  seasons: string[],
  rarities: Rarity[],
  signal?: AbortSignal
): Promise<BattleDataRow[]> {
  const params = new URLSearchParams({
    guild: guildCode,
    seasons: seasons.join(','),
    rarities: rarities.join(',')
  })
  const response = await fetch(`/api/members/token-usage/battles?${params}`, {
    signal
  })
  if (!response.ok) {
    if (process.env.NEXT_PUBLIC_RUNTIME_PROFILE === 'desktop')
      throw new Error('Saved battle history is unavailable')
    return []
  }
  const body = (await response.json()) as unknown
  if (!Array.isArray(body)) {
    if (process.env.NEXT_PUBLIC_RUNTIME_PROFILE === 'desktop')
      throw new Error('Saved battle history is malformed')
    return []
  }
  return body as BattleDataRow[]
}

// /api/guild-tokens: the same source as GR Availability and the Discord /tokens overview.
async function fetchGuildTokens(
  guildCode: string,
  season: string,
  signal?: AbortSignal
): Promise<GuildTokenAvailabilityRow[]> {
  const params = new URLSearchParams({ guild: guildCode, season })
  const response = await fetch(`/api/guild-tokens?${params}`, { signal })
  if (!response.ok) {
    if (process.env.NEXT_PUBLIC_RUNTIME_PROFILE === 'desktop')
      throw new Error('Saved token availability is unavailable')
    return []
  }
  const body = (await response.json()) as { players?: unknown }
  if (!body || !Array.isArray(body.players)) {
    if (process.env.NEXT_PUBLIC_RUNTIME_PROFILE === 'desktop')
      throw new Error('Saved token availability is malformed')
    return []
  }
  // TokenUsage passes these rows on to GRAvailability to avoid a second request.
  return body.players as GuildTokenAvailabilityRow[]
}

// Rotation-aware outlook via the auth-gated route (the sim is server-only).
// Failures fall back to the envelope's projection; pace rows are role-scoped.
interface SeasonOutlookRouteResponse {
  projection: SeasonOutlookProjection | null
  players: PlayerTokenPaceRow[] | null
}

async function fetchSeasonOutlookProjection(
  guildCode: string,
  season: string,
  signal?: AbortSignal
): Promise<SeasonOutlookRouteResponse> {
  const params = new URLSearchParams({ guildCode, season })
  const response = await fetch(`/api/season-forecast/outlook?${params}`, {
    signal
  })
  if (!response.ok) return { projection: null, players: null }
  const body = (await response.json()) as Partial<SeasonOutlookRouteResponse>
  return {
    projection: body?.projection ?? null,
    players: body?.players ?? null
  }
}

async function fetchTokenUsageData(
  guildCode: string,
  season: string,
  selectedRarities: Rarity[],
  enableForecast: boolean,
  signal?: AbortSignal
): Promise<TokenUsageResult> {
  logQuery('TokenUsage', 'fetchTokenUsageData')

  const supabase = dbClient()
  const useRpc = process.env.NEXT_PUBLIC_ENABLE_TOKEN_USAGE_RPC !== 'false'
  const normalizedGuild = normalizeGuildIdentifier(guildCode)
  const desktop = process.env.NEXT_PUBLIC_RUNTIME_PROFILE === 'desktop'

  const currentSeasonNum = Number.parseInt(season, 10)

  if (!normalizedGuild || Number.isNaN(currentSeasonNum)) {
    return {
      players: [],
      bossDistribution: [],
      totalStats: {
        totalTokens: 0,
        maxTokens: 0,
        averageUsage: 0,
        tokensAvailableAvg: 0,
        bombsAvailableCount: 0
      },
      availabilityRows: [],
      forecast: null,
      outlook: null
    }
  }

  const past5Seasons = Array.from({ length: 5 }, (_, i) =>
    (currentSeasonNum - 1 - i).toString()
  ).filter((value) => Number(value) > 0)
  const allSeasons = [season, ...past5Seasons]
  const activeRarities =
    selectedRarities.length > 0 ? selectedRarities : DEFAULT_RARITIES

  // The forecast skips the server cache because React Query owns staleness.
  const [
    rpcRawData,
    availabilityRaw,
    allBattleData,
    forecastEnvelope,
    outlookResponse
  ] = await Promise.all([
    desktop
      ? (async () => {
          const params = new URLSearchParams({ guild: normalizedGuild, season })
          const response = await fetch(`/api/members/token-usage?${params}`, {
            signal
          })
          if (!response.ok) throw new Error('Saved token usage is unavailable')
          const rows: unknown = await response.json()
          if (!Array.isArray(rows))
            throw new Error('Saved token usage is malformed')
          return rows
        })()
      : useRpc && normalizedGuild
        ? (async () => {
            try {
              const r = await supabase.rpc('get_token_usage_for_guild', {
                p_guild_code: normalizedGuild,
                p_season: season
              })
              return r.error ? null : r.data
            } catch {
              return null
            }
          })()
        : Promise.resolve(null),

    fetchGuildTokens(normalizedGuild, season, signal).catch((error) => {
      if (desktop || isAbortError(error)) throw error
      return [] as GuildTokenAvailabilityRow[]
    }),

    // Via a server route so the client never reads EOT_GR_data directly.
    fetchBattleHistory(normalizedGuild, allSeasons, activeRarities, signal),

    // per_player is scoped by the RPC's SECURITY INVOKER RLS; the officer gate is UI
    // only. Failures resolve to null so the page still renders.
    enableForecast && normalizedGuild
      ? fetchSeasonForecast(supabase, {
          guildCode: normalizedGuild,
          seasonNumber: currentSeasonNum,
          includePerPlayer: true,
          skipCache: true
        }).catch(() => null)
      : Promise.resolve(null),

    // Merged onto lap_projection so the Forecast tab matches the home outlook card.
    enableForecast && normalizedGuild
      ? fetchSeasonOutlookProjection(normalizedGuild, season, signal).catch(
          (error): SeasonOutlookRouteResponse | null => {
            if (isAbortError(error)) throw error
            return null
          }
        )
      : Promise.resolve(null)
  ])

  const outlookProjection = outlookResponse?.projection ?? null
  const outlookPaceRows = outlookResponse?.players ?? null

  throwIfAborted(signal)

  const availabilityByPlayerId = new Map<string, TokenAvailabilityData>()
  const availabilityByName = new Map<string, TokenAvailabilityData>()
  const duplicateAvailabilityNames = new Set<string>()
  const rpcTotalsByPlayerId = new Map<string, RpcTokenData>()
  const rpcTotalsByName = new Map<string, RpcTokenData>()
  const duplicateRpcNames = new Set<string>()
  const rpcTotalsForStats = new Map<string, RpcTokenData>()

  if (Array.isArray(rpcRawData)) {
    ;(rpcRawData as RpcTokenUsageRow[]).forEach((row) => {
      const parsed = parseRpcTokenRow(row)
      if (!parsed) return
      if (parsed.data.playerId) {
        rpcTotalsByPlayerId.set(parsed.data.playerId, parsed.data)
        rpcTotalsForStats.set(`id:${parsed.data.playerId}`, parsed.data)
      } else {
        rpcTotalsForStats.set(`name:${parsed.nameKey}`, parsed.data)
      }
      setUniqueName(
        rpcTotalsByName,
        duplicateRpcNames,
        parsed.nameKey,
        parsed.data
      )
    })
  }

  if (Array.isArray(availabilityRaw)) {
    ;(availabilityRaw as TokenAvailabilityRow[]).forEach((row) => {
      const parsed = parseAvailabilityRow(row)
      if (!parsed) return
      if (parsed.data.playerId) {
        availabilityByPlayerId.set(parsed.data.playerId, parsed.data)
      }
      setUniqueName(
        availabilityByName,
        duplicateAvailabilityNames,
        parsed.nameKey,
        parsed.data
      )
    })
  }

  const battleRows = (allBattleData as BattleDataRow[] | null) ?? []
  const battleData = battleRows.filter((d) => d.Season === season)
  const historicalData = battleRows.filter((d) => d.Season !== season)

  const { playerStats, bossTokens, totalTokensUsed } =
    processBattleData(battleData)
  const playerHistoricalAvgs = processHistoricalData(historicalData)

  const existingPlayerNames = new Set(
    Object.values(playerStats).map((s) => s.displayName.trim().toUpperCase())
  )
  const existingPlayerIds = new Set(Object.keys(playerStats))

  const findRpc = (playerId: string, nameKey: string) =>
    (playerId ? rpcTotalsByPlayerId.get(playerId) : undefined) ??
    rpcTotalsByName.get(nameKey)
  const findAvailability = (playerId: string, nameKey: string) =>
    (playerId ? availabilityByPlayerId.get(playerId) : undefined) ??
    availabilityByName.get(nameKey)

  const playersArray: PlayerTokens[] = Object.entries(playerStats).map(
    ([playerId, stats]) => {
      const nameKey = stats.displayName.trim().toUpperCase()
      const rpc = findRpc(playerId, nameKey)
      const avail = findAvailability(playerId, nameKey)
      const tokensOverride = rpc?.tokens ?? stats.tokens
      const tokensAvailable =
        avail?.tokensAvailable ?? rpc?.tokensAvailable ?? undefined
      const burnedTokens = toNullableNumber(
        avail?.burnedTokens ?? rpc?.burnedTokens ?? null
      )
      const timeOverCapSeconds = toNullableNumber(
        avail?.timeOverCapSeconds ?? rpc?.timeOverCapSeconds ?? null
      )
      const burnedTokensUsage = burnedTokens

      const dataSource = avail?.dataSource ?? (rpc ? 'calculated' : 'default')

      return {
        userId: playerId,
        displayName: stats.displayName,
        totalTokens: tokensOverride,
        bossTokens: rpc?.bossTokens ?? stats.bossTokens,
        primeTokens: rpc?.primeTokens ?? stats.primeTokens,
        tokensAvailable,
        tokenNextSeconds:
          avail?.tokenNextSeconds ?? rpc?.tokenNextSeconds ?? null,
        bombsAvailable:
          avail?.bombsAvailable ?? rpc?.bombsAvailable ?? undefined,
        bombNextSeconds: avail?.bombNextSeconds ?? rpc?.bombNextSeconds ?? null,
        burnedTokens,
        burnedTokensUsage,
        burnedDelta: null,
        timeOverCapSeconds,
        avgTokensPerLoop:
          stats.loops.size > 0 ? stats.tokens / stats.loops.size : 0,
        efficiency: stats.tokens > 0 ? stats.totalDamage / stats.tokens : 0,
        historicalAvg: playerHistoricalAvgs[playerId],
        tokensByRarity: stats.tokensByRarity,
        dataSource
      }
    }
  )

  const appendRpcOnlyPlayer = (
    userId: string,
    displayName: string,
    rpc: RpcTokenData,
    avail: TokenAvailabilityData | undefined
  ) => {
    const burnedTokens = toNullableNumber(
      avail?.burnedTokens ?? rpc.burnedTokens ?? null
    )
    playersArray.push({
      userId,
      displayName,
      totalTokens: rpc.tokens,
      bossTokens: rpc.bossTokens,
      primeTokens: rpc.primeTokens,
      tokensAvailable:
        avail?.tokensAvailable ?? rpc.tokensAvailable ?? undefined,
      tokenNextSeconds: avail?.tokenNextSeconds ?? rpc.tokenNextSeconds ?? null,
      bombsAvailable: avail?.bombsAvailable ?? rpc.bombsAvailable ?? undefined,
      bombNextSeconds: avail?.bombNextSeconds ?? rpc.bombNextSeconds ?? null,
      burnedTokens,
      burnedTokensUsage: burnedTokens,
      burnedDelta: null,
      timeOverCapSeconds: toNullableNumber(
        avail?.timeOverCapSeconds ?? rpc.timeOverCapSeconds ?? null
      ),
      avgTokensPerLoop: 0,
      efficiency: 0,
      historicalAvg: undefined,
      tokensByRarity: createEmptyTokensByRarity(),
      dataSource: avail?.dataSource ?? 'calculated'
    })
  }

  const appendAvailabilityOnlyPlayer = (
    userId: string,
    displayName: string,
    avail: TokenAvailabilityData
  ) => {
    const burnedTokens = toNullableNumber(avail.burnedTokens ?? null)
    playersArray.push({
      userId,
      displayName,
      totalTokens: 0,
      bossTokens: 0,
      primeTokens: 0,
      tokensAvailable: avail.tokensAvailable,
      tokenNextSeconds: avail.tokenNextSeconds,
      bombsAvailable: avail.bombsAvailable,
      bombNextSeconds: avail.bombNextSeconds,
      burnedTokens,
      burnedTokensUsage: burnedTokens,
      burnedDelta: null,
      timeOverCapSeconds: toNullableNumber(avail.timeOverCapSeconds ?? null),
      avgTokensPerLoop: 0,
      efficiency: 0,
      historicalAvg: undefined,
      tokensByRarity: createEmptyTokensByRarity(),
      dataSource: avail.dataSource ?? 'default'
    })
  }

  rpcTotalsByPlayerId.forEach((rpc, playerId) => {
    if (!existingPlayerIds.has(playerId)) {
      appendRpcOnlyPlayer(
        playerId,
        rpc.displayName ?? playerId,
        rpc,
        availabilityByPlayerId.get(playerId)
      )
    }
  })

  rpcTotalsByName.forEach((rpc, nameKey) => {
    if (rpc.playerId || existingPlayerNames.has(nameKey)) return
    appendRpcOnlyPlayer(
      `rpc-${nameKey}`,
      nameKey,
      rpc,
      availabilityByName.get(nameKey)
    )
  })

  availabilityByPlayerId.forEach((avail, playerId) => {
    if (
      !existingPlayerIds.has(playerId) &&
      !rpcTotalsByPlayerId.has(playerId)
    ) {
      appendAvailabilityOnlyPlayer(
        playerId,
        avail.displayName ?? playerId,
        avail
      )
    }
  })

  availabilityByName.forEach((avail, nameKey) => {
    if (
      !avail.playerId &&
      !existingPlayerNames.has(nameKey) &&
      !rpcTotalsByName.has(nameKey)
    ) {
      appendAvailabilityOnlyPlayer(`avail-${nameKey}`, nameKey, avail)
    }
  })

  // Burn calc shared with the Discord bot: maxPossible = min(28, max(used + available)),
  // burned = floor(max(0, maxPossible - (used + available + regenProgress))). The RPC's
  // history-driven burn is not a fallback: it over-reports active players.
  const guildMaxPossible = computeGuildMaxPossibleTokens(playersArray)
  for (const p of playersArray) {
    p.burnedTokensUsage = calculateBurnedTokens(
      guildMaxPossible,
      p.tokensAvailable,
      p.totalTokens,
      p.tokenNextSeconds
    )
    p.burnedTokens = p.burnedTokensUsage
    // One wasted token per full 12h regen cycle at cap; distinct from burnedTokens.
    p.overcappedTokens = Math.max(
      0,
      Math.floor((p.timeOverCapSeconds ?? 0) / 43200)
    )
  }

  // Joined on userId === player_id; a mismatch silently yields null projections.
  // Pace rows overlay projections; the envelope stays authoritative for live facts.
  if (forecastEnvelope) {
    const projectionByPlayerId = new Map(
      forecastEnvelope.per_player.map((row) => [row.player_id, row])
    )
    const paceByPlayerId = new Map(
      (outlookPaceRows ?? []).map((row) => [row.playerId, row])
    )
    for (const p of playersArray) {
      p.projection = mergePlayerProjection(
        projectionByPlayerId.get(p.userId) ?? null,
        paceByPlayerId.get(p.userId) ?? null
      )
    }
  }

  const colors = getBossDistributionColors(Object.keys(bossTokens).length)
  const fallbackColor = colors[0] ?? '#888888'
  const bossDistribution: BossTokenData[] = Object.entries(bossTokens)
    .map(([boss, count], index) => ({
      bossName: boss,
      tokenCount: count,
      percentage: totalTokensUsed > 0 ? (count / totalTokensUsed) * 100 : 0,
      color: colors[index] ?? fallbackColor
    }))
    .sort((a, b) => b.tokenCount - a.tokenCount)

  const totalStats = calculateTotalStats(
    playersArray,
    rpcTotalsForStats,
    totalTokensUsed
  )

  // The rotation sim owns projected finish and confidence; no-op if either is missing.
  const forecast = forecastEnvelope
    ? {
        ...forecastEnvelope,
        lap_projection:
          mergeLapProjection(
            forecastEnvelope.lap_projection ?? null,
            outlookProjection
          ) ?? undefined
      }
    : null

  return {
    players: playersArray,
    bossDistribution,
    totalStats,
    availabilityRows: availabilityRaw,
    forecast,
    outlook: outlookProjection ?? null,
    computedAt:
      desktop && Array.isArray(rpcRawData)
        ? ((rpcRawData as Array<{ computed_at?: string }>).find(
            (row) => row.computed_at
          )?.computed_at ?? null)
        : null
  }
}

export function useTokenUsageData({
  guildCode,
  season,
  selectedRarities,
  enabled = true,
  enableForecast = false
}: UseTokenUsageDataOptions) {
  const normalizedGuild = normalizeGuildIdentifier(guildCode)
  const forecastEnabled =
    enableForecast && process.env.NEXT_PUBLIC_RUNTIME_PROFILE !== 'desktop'
  const raritiesKey = [...selectedRarities].sort().join(',')

  const query = useQuery({
    queryKey: [
      'tokenUsage',
      normalizedGuild,
      season,
      raritiesKey,
      forecastEnabled ? 'forecast' : 'no-forecast'
    ],
    queryFn: async ({ signal }) => {
      return fetchTokenUsageData(
        normalizedGuild,
        season,
        selectedRarities,
        forecastEnabled,
        signal
      )
    },
    enabled: enabled && !!normalizedGuild && !!season,
    staleTime: 2 * 60 * 1000,
    gcTime: 5 * 60 * 1000
  })

  return {
    players: query.data?.players ?? [],
    bossDistribution: query.data?.bossDistribution ?? [],
    totalStats: query.data?.totalStats ?? {
      totalTokens: 0,
      maxTokens: 0,
      averageUsage: 0,
      tokensAvailableAvg: 0,
      bombsAvailableCount: 0
    },
    availabilityRows: query.data?.availabilityRows ?? [],
    forecast: query.data?.forecast ?? (null as SeasonForecastEnvelope | null),
    outlook: query.data?.outlook ?? (null as SeasonOutlookProjection | null),
    loading: query.isLoading,
    error: query.error,
    computedAt: query.data?.computedAt ?? null,
    refetch: query.refetch,
    streamStatus: 'idle' as const
  }
}
