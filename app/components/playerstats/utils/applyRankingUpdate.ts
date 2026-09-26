import type {
  PlayerStats,
  RankingUpdatePayload,
  HistoricalPerformanceEntry
} from '@/app/components/playerstats/types'

const normalizeRankValue = (rank?: number | null) =>
  rank && rank > 0 ? rank : undefined

export function mergeRankingUpdate(
  previous: PlayerStats | null,
  payload: RankingUpdatePayload
): PlayerStats | null {
  const {
    season,
    historicalPerformance,
    historicalTokens,
    historicalTotalDamage,
    historicalReliability,
    clusterRanking: payloadClusterRank,
    totalPlayersInCluster: payloadClusterTotal,
    guildRanking: payloadGuildRank,
    totalPlayersInGuild: payloadGuildTotal,
    reliabilityData: payloadReliability,
    playerKey
  } = payload

  const baseStats = previous ?? null
  if (!baseStats) {
    return previous
  }

  if (playerKey && baseStats.playerKey && playerKey !== baseStats.playerKey) {
    return previous
  }

  const existingHistorical = baseStats.historicalPerformance || {}
  const baseSeason = historicalPerformance[season]
  const existingSeason = existingHistorical[season]

  const clusterRankValue = normalizeRankValue(
    payloadClusterRank ??
      baseSeason?.clusterRank ??
      existingSeason?.clusterRank ??
      baseStats.clusterRanking
  )

  const clusterTotalValue =
    payloadClusterTotal ??
    baseSeason?.totalPlayersInCluster ??
    existingSeason?.totalPlayersInCluster ??
    baseStats.totalPlayersInCluster

  const guildRankValue = normalizeRankValue(
    payloadGuildRank ??
      baseSeason?.guildRank ??
      existingSeason?.guildRank ??
      baseStats.guildRanking
  )

  const guildTotalValue =
    payloadGuildTotal ??
    baseSeason?.totalPlayersInGuild ??
    existingSeason?.totalPlayersInGuild ??
    baseStats.totalPlayersInGuild

  const nextSeasonEntry: HistoricalPerformanceEntry = {
    ...(baseSeason ?? {}),
    ...(existingSeason ?? {}),
    vsGuild:
      existingSeason?.vsGuild ??
      baseSeason?.vsGuild ??
      baseStats.vsGuildAvg ??
      0,
    vsCluster:
      existingSeason?.vsCluster ??
      baseSeason?.vsCluster ??
      baseStats.vsClusterAvg ??
      0,
    clusterRank: clusterRankValue,
    totalPlayersInCluster: clusterTotalValue,
    guildRank: guildRankValue,
    totalPlayersInGuild: guildTotalValue,
    bossDetails: existingSeason?.bossDetails ?? baseSeason?.bossDetails,
    guild: existingSeason?.guild ?? baseSeason?.guild
  }

  return {
    ...baseStats,
    playerKey: baseStats.playerKey ?? playerKey,
    historicalPerformance: {
      ...historicalPerformance,
      ...existingHistorical,
      [season]: nextSeasonEntry
    },
    historicalTokens: {
      ...(baseStats.historicalTokens || {}),
      ...historicalTokens
    },
    historicalTotalDamage: {
      ...(baseStats.historicalTotalDamage || {}),
      ...historicalTotalDamage
    },
    historicalReliability: {
      ...(baseStats.historicalReliability || {}),
      ...historicalReliability
    },
    clusterRanking: clusterRankValue,
    totalPlayersInCluster: clusterTotalValue,
    guildRanking: guildRankValue,
    totalPlayersInGuild: guildTotalValue,
    reliability: payloadReliability ?? baseStats.reliability ?? undefined,
    vsGuildAvg: nextSeasonEntry.vsGuild,
    vsClusterAvg: nextSeasonEntry.vsCluster
  }
}
