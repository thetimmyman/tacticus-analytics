import type { PerformanceSummary } from '@tacticus/app-core/performance.types'
import type { SeasonTokenStats } from '@tacticus/app-core/tokens.types'
import {
  buildTokenRatioMapsFromStats,
  mergeTokenRatioMap
} from '@tacticus/app-core/token-weighting'

import { normalizeDisplayName } from '@/app/lib/utils/normalize'
import type { TokenRatioMaps } from '@/app/components/performance/types'
import { setUniqueName, toNonNegativeInt } from './helpers'
import {
  EMPTY_BURN_SUMMARY,
  type BurnStatRow,
  type PerformanceBurnSummary,
  type PlayerMappingStatusRow,
  type TokenUsageBurnRpcRow
} from './types'

export function buildPlayerMembershipMap(entries: PlayerMappingStatusRow[]) {
  const map = new Map<string, boolean>()
  const apply = (key: string | null | undefined, current: boolean) => {
    if (!key || map.get(key) === true) return
    if (current) map.set(key, true)
    else if (!map.has(key)) map.set(key, false)
  }
  entries.forEach((entry) => {
    const current = entry.is_current === true
    const playerId =
      typeof entry.player_id === 'string' ? entry.player_id.trim() : ''
    apply(playerId, current)
    apply(normalizeDisplayName(entry.display_name), current)
  })
  return map
}

export function buildTokenRatioState(
  tokenStats: SeasonTokenStats[] | null,
  fallback: TokenRatioMaps
) {
  const empty: TokenRatioMaps = { max: new Map(), average: new Map() }
  const stats = Array.isArray(tokenStats) ? tokenStats : []
  const guild =
    stats.length > 0 ? buildTokenRatioMapsFromStats(stats, ['guild']) : empty
  const cluster =
    stats.length > 0 ? buildTokenRatioMapsFromStats(stats, ['cluster']) : empty
  return {
    mapsByContext: {
      guild: {
        max: mergeTokenRatioMap(guild.max, fallback.max),
        average: mergeTokenRatioMap(guild.average, fallback.average)
      },
      cluster: {
        max: mergeTokenRatioMap(cluster.max, fallback.max),
        average: mergeTokenRatioMap(cluster.average, fallback.average)
      }
    },
    hasRpc: {
      guild: guild.max.size > 0 || guild.average.size > 0,
      cluster: cluster.max.size > 0 || cluster.average.size > 0
    }
  }
}

export function buildBurnStatsLookup(rows: TokenUsageBurnRpcRow[]) {
  const byPlayerId = new Map<string, BurnStatRow>()
  const byName = new Map<string, BurnStatRow>()
  const duplicateNames = new Set<string>()
  if (!Array.isArray(rows)) return { byPlayerId, byName }

  rows.forEach((row) => {
    const playerId =
      typeof row.player_id === 'string' ? row.player_id.trim() : ''
    const displayName =
      typeof row.display_name === 'string' && row.display_name.trim()
        ? row.display_name.trim()
        : typeof row.displayName === 'string' && row.displayName.trim()
          ? row.displayName.trim()
          : 'Unknown'
    const stat: BurnStatRow = {
      playerId: playerId || undefined,
      displayName,
      burnedTokens: toNonNegativeInt(row.burned_tokens),
      overcappedTokens: Math.max(
        0,
        Math.floor(toNonNegativeInt(row.time_over_cap_seconds) / 43200)
      ),
      timeOverCapSeconds: toNonNegativeInt(row.time_over_cap_seconds)
    }
    if (playerId) byPlayerId.set(playerId, stat)
    const normalizedName = normalizeDisplayName(displayName)
    if (normalizedName) {
      setUniqueName(byName, duplicateNames, normalizedName, stat)
    }
  })
  return { byPlayerId, byName }
}

export function buildBurnStatsSummary({
  showFiveSeasonAverage,
  rows,
  summaries,
  lookup
}: {
  showFiveSeasonAverage: boolean
  rows: TokenUsageBurnRpcRow[]
  summaries: PerformanceSummary[]
  lookup: ReturnType<typeof buildBurnStatsLookup>
}): PerformanceBurnSummary {
  if (showFiveSeasonAverage) return EMPTY_BURN_SUMMARY
  if (rows.length === 0 || summaries.length === 0) {
    return { ...EMPTY_BURN_SUMMARY, hasData: rows.length > 0 }
  }

  const seen = new Set<string>()
  const scoped = summaries.flatMap((summary) => {
    const playerId =
      typeof summary.playerId === 'string' ? summary.playerId.trim() : ''
    const displayName =
      typeof summary.displayName === 'string' ? summary.displayName.trim() : ''
    const nameKey = normalizeDisplayName(displayName)
    const identity = playerId || nameKey
    if (!identity || seen.has(identity)) return []
    seen.add(identity)
    const matched =
      (playerId ? lookup.byPlayerId.get(playerId) : undefined) ??
      (nameKey ? lookup.byName.get(nameKey) : undefined)
    if (!matched) return []
    return [
      {
        playerId: playerId || matched.playerId,
        displayName: displayName || matched.displayName,
        burnedTokens: matched.burnedTokens,
        overcappedTokens: matched.overcappedTokens,
        timeOverCapSeconds: matched.timeOverCapSeconds
      }
    ]
  })

  return {
    hasData: true,
    totalBurnedTokens: scoped.reduce(
      (total, row) => total + row.burnedTokens,
      0
    ),
    totalOvercappedTokens: scoped.reduce(
      (total, row) => total + row.overcappedTokens,
      0
    ),
    playersWithBurnedTokens: scoped.filter((row) => row.burnedTokens > 0)
      .length,
    totalTimeOverCapSeconds: scoped.reduce(
      (total, row) => total + row.timeOverCapSeconds,
      0
    ),
    topBurnedPlayers: scoped
      .filter((row) => row.burnedTokens > 0 || row.timeOverCapSeconds > 0)
      .sort(
        (left, right) =>
          right.burnedTokens - left.burnedTokens ||
          right.timeOverCapSeconds - left.timeOverCapSeconds ||
          left.displayName.localeCompare(right.displayName)
      )
      .slice(0, 5)
  }
}
