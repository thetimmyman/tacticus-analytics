import {
  applyTokenWeightingPercent,
  buildTokenRatioMapsFromStats,
  deriveParticipationShareRatiosFromParticipants,
  getTokenRatioForIdentifiers
} from '@tacticus/app-core/token-weighting'
import type { SeasonTokenStats } from '@tacticus/app-core/tokens.types'
import type { TokenRatioParticipant } from '@tacticus/app-core/token-weighting'
import type {
  ClusterLeaderboardRow,
  HistoricalRankingRow
} from '@/app/lib/calculations/experimental/cluster-overall-leaderboard'
import type {
  EnhancedPlayerStats,
  PlayerStats,
  ScoringPresentation,
  SortDirection,
  SortField
} from './types'

export type TokenRatioMaps = ReturnType<typeof buildTokenRatioMapsFromStats>

export function mapClusterLeaderboardRows(
  rows: ClusterLeaderboardRow[]
): PlayerStats[] {
  return rows.map((row) => ({
    displayName: row.display_name,
    Guild: row.guild,
    userId: row.user_id,
    stableKey: row.stable_key,
    totalDamage: Number(row.total_damage),
    battleCount: row.battle_count,
    avgDamage: Number(row.avg_damage),
    battleDamageTotal: Number(row.total_damage),
    bombsUsed: row.bombs_used,
    bossesKilled: row.bosses_killed,
    allBattleCount: row.all_battle_count,
    allBossesKilled: row.all_bosses_killed,
    percentVsCluster:
      row.percent_vs_cluster != null
        ? Number(row.percent_vs_cluster)
        : undefined,
    currentRank: row.current_rank
  }))
}

export function attachHistoricalRankings(
  players: PlayerStats[],
  historicalRows: HistoricalRankingRow[],
  currentSeason: number
): PlayerStats[] {
  const priorSeason = (currentSeason - 1).toString()
  const last5Seasons = Array.from({ length: 5 }, (_, index) =>
    (currentSeason - index - 1).toString()
  )
  const rankingsBySeason = new Map<string, Map<string, number>>()

  historicalRows.forEach((row) => {
    if (!rankingsBySeason.has(row.season)) {
      rankingsBySeason.set(row.season, new Map())
    }
    rankingsBySeason.get(row.season)!.set(row.stable_key, row.season_rank)
  })

  const priorRankings =
    rankingsBySeason.get(priorSeason) ?? new Map<string, number>()

  return players.map((player) => {
    // Only the player's ranked row carries rank history.
    if (player.currentRank == null) return player
    const currentRank = player.currentRank ?? 0
    const priorRank = priorRankings.get(player.stableKey)
    const rankChange = priorRank ? priorRank - currentRank : undefined
    const historicalRanks: number[] = []

    last5Seasons.forEach((season) => {
      const rank = rankingsBySeason.get(season)?.get(player.stableKey)
      if (rank) historicalRanks.push(rank)
    })

    const fiveSeasonAvgRank =
      historicalRanks.length > 0
        ? historicalRanks.reduce((sum, rank) => sum + rank, 0) /
          historicalRanks.length
        : undefined
    const nextPlayer: PlayerStats = { ...player }

    if (typeof priorRank === 'number') nextPlayer.priorSeasonRank = priorRank
    if (typeof rankChange === 'number') nextPlayer.rankChange = rankChange
    if (typeof fiveSeasonAvgRank === 'number') {
      nextPlayer.fiveSeasonAvgRank = fiveSeasonAvgRank
    }

    return nextPlayer
  })
}

export function buildLeaderboardTokenRatioMaps(
  players: PlayerStats[],
  tokenStats: SeasonTokenStats[] | null
): TokenRatioMaps {
  if (tokenStats && tokenStats.length > 0) {
    const clusterRatios = buildTokenRatioMapsFromStats(tokenStats, ['cluster'])
    if (clusterRatios.max.size > 0 || clusterRatios.average.size > 0) {
      return clusterRatios
    }
  }

  // One participant per player: a player can appear in several rows (for
  // example after a mid-season guild or name change). Battle counts are
  // totals for a player within one guild, so rows repeating the same guild --
  // a rename inside that guild -- already carry the guild's whole count and
  // only an increase adds battles, while rows in different guilds are summed.
  // Identity comes from the player's ranked row when it exists.
  const participantIndexByStableKey = new Map<string, number>()
  const countedBattlesByPair = new Map<string, number>()
  const rankedIdentityApplied = new Set<string>()
  const participants: TokenRatioParticipant[] = []

  players.forEach((player) => {
    const pairKey = `${player.stableKey}::${player.Guild}`
    const battlesAlreadyCounted = countedBattlesByPair.get(pairKey) ?? 0
    const addedBattles = Math.max(0, player.battleCount - battlesAlreadyCounted)
    countedBattlesByPair.set(
      pairKey,
      Math.max(battlesAlreadyCounted, player.battleCount)
    )
    const existingIndex = participantIndexByStableKey.get(player.stableKey)

    if (existingIndex === undefined) {
      participantIndexByStableKey.set(player.stableKey, participants.length)
      participants.push({
        playerId: player.userId ?? undefined,
        displayName: player.displayName,
        value: addedBattles
      })
      if (player.currentRank != null) {
        rankedIdentityApplied.add(player.stableKey)
      }
      return
    }

    const participant = participants[existingIndex]!
    participant.value += addedBattles

    if (
      player.currentRank != null &&
      !rankedIdentityApplied.has(player.stableKey)
    ) {
      participant.playerId = player.userId ?? undefined
      participant.displayName = player.displayName
      rankedIdentityApplied.add(player.stableKey)
    }
  })

  return {
    max: deriveParticipationShareRatiosFromParticipants(participants, 'max'),
    average: deriveParticipationShareRatiosFromParticipants(
      participants,
      'average'
    )
  }
}

export function enhanceLeaderboardPlayers(options: {
  players: PlayerStats[]
  isTokenModeActive: boolean
  selectedTokenModeAvailable: boolean
  selectedTokenRatios: Map<string, number>
}): EnhancedPlayerStats[] {
  const effectiveMode = options.isTokenModeActive
    ? 'token-weighted'
    : 'battle-weighted'
  const computed = options.players.map((player) => {
    const basePercent =
      typeof player.percentVsCluster === 'number'
        ? player.percentVsCluster
        : null
    const safeBasePercent = basePercent ?? -999
    const ratio = options.selectedTokenModeAvailable
      ? getTokenRatioForIdentifiers(
          options.selectedTokenRatios,
          player.userId ?? undefined,
          player.displayName,
          1
        )
      : 1
    const tokenWeightedPercent = options.selectedTokenModeAvailable
      ? applyTokenWeightingPercent(safeBasePercent, ratio)
      : safeBasePercent
    const performanceValue =
      effectiveMode === 'token-weighted'
        ? tokenWeightedPercent
        : safeBasePercent

    return {
      ...player,
      battleWeightedPercent: basePercent,
      tokenWeightedPercent: options.selectedTokenModeAvailable
        ? tokenWeightedPercent
        : null,
      tokenRatioApplied: ratio,
      performanceValue: Number.isFinite(performanceValue)
        ? performanceValue
        : null,
      scoreRank: null
    }
  })
  const rankedEntries = computed
    .map((player, index) => ({ player, index }))
    .filter((entry) => entry.player.currentRank != null)
    .sort(
      (left, right) =>
        (right.player.performanceValue ?? Number.NEGATIVE_INFINITY) -
        (left.player.performanceValue ?? Number.NEGATIVE_INFINITY)
    )
  const ranks = new Map<number, number>()

  rankedEntries.forEach((entry, position) => {
    ranks.set(entry.index, position + 1)
  })

  return computed.map((player, index) => ({
    ...player,
    scoreRank: ranks.get(index) ?? null
  }))
}

export function filterAndSortLeaderboardPlayers(options: {
  players: EnhancedPlayerStats[]
  selectedGuild: string
  searchTerm: string
  sortField: SortField
  sortDirection: SortDirection
}): EnhancedPlayerStats[] {
  let filtered = [...options.players]

  if (options.selectedGuild !== 'all') {
    filtered = filtered.filter(
      (player) => player.Guild === options.selectedGuild
    )
  }

  if (options.searchTerm) {
    const lowered = options.searchTerm.toLowerCase()
    filtered = filtered.filter((player) =>
      player.displayName.toLowerCase().includes(lowered)
    )
  }

  filtered.sort((left, right) => {
    // Unranked rows always trail ranked rows, in either direction.
    if (options.sortField === 'rank') {
      const leftRanked = left.scoreRank != null
      const rightRanked = right.scoreRank != null
      if (leftRanked !== rightRanked) return leftRanked ? -1 : 1
    }

    const getValue = (player: EnhancedPlayerStats): number | string => {
      switch (options.sortField) {
        case 'rank':
          return player.scoreRank ?? 999
        case 'rankChange':
          return player.rankChange ?? -999
        case 'fiveSeasonAvg':
          return player.fiveSeasonAvgRank ?? 999
        case 'name':
          return player.displayName.toLowerCase()
        case 'guild':
          return player.Guild
        case 'totalDamage':
          return player.totalDamage
        case 'battles':
          return player.battleCount
        case 'avgDamage':
          return player.avgDamage
        case 'percentVsCluster':
          return player.performanceValue ?? -999
        case 'bombs':
          return player.bombsUsed
        case 'kills':
          return player.bossesKilled
      }
    }
    const leftValue = getValue(left)
    const rightValue = getValue(right)

    if (options.sortDirection === 'asc') {
      return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
    }
    return leftValue > rightValue ? -1 : leftValue < rightValue ? 1 : 0
  })

  return filtered
}

export function getScoringPresentation(options: {
  performanceMode: ScoringPresentation['performanceMode']
  tokenWeightingMode: ScoringPresentation['tokenWeightingMode']
  tokenMaxAvailable: boolean
  tokenAverageAvailable: boolean
}): ScoringPresentation {
  const selectedTokenModeAvailable =
    options.tokenWeightingMode === 'average'
      ? options.tokenAverageAvailable
      : options.tokenMaxAvailable
  const isTokenModeActive =
    options.performanceMode === 'token-weighted' && selectedTokenModeAvailable
  const hasAnyTokenMode =
    options.tokenMaxAvailable || options.tokenAverageAvailable
  const label = isTokenModeActive
    ? options.tokenWeightingMode === 'average'
      ? 'Token Weighted (Avg)'
      : 'Token Weighted (Max)'
    : 'Battle Weighted'
  const tableLabel = isTokenModeActive
    ? options.tokenWeightingMode === 'average'
      ? "Tkn Wgt'd (Avg)"
      : "Tkn Wgt'd (Max)"
    : label
  const description = isTokenModeActive
    ? options.tokenWeightingMode === 'average'
      ? 'Balances performance against average token spend.'
      : "Normalizes against the cluster's top token spender."
    : 'Battle efficiency vs overall cluster averages.'

  return {
    ...options,
    hasAnyTokenMode,
    isTokenModeActive,
    label,
    tableLabel,
    statusMessage: hasAnyTokenMode
      ? description
      : 'Token weighting unavailable - showing battle-weighted results.'
  }
}

export function getRankBadge(rank: number | null | undefined): string {
  return rank ? `#${rank}` : '#-'
}

export function getGuildColor(guild: string, userGuild: string): string {
  return guild === userGuild ? 'text-(--primary)' : 'text-primary-wh40k'
}

export function getLeaderboardRowKey(player: PlayerStats): string {
  return `${player.stableKey}::${player.Guild}::${player.displayName}`
}
