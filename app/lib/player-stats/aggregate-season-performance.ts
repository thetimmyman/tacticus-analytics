import type {
  HistoricalDataRow,
  HistoricalPerformanceEntry,
  GuildAvgRpcRow,
  GuildScoreRpcRow
} from './types'
import { isSweepBattle, type PartialBattleRow } from './utils'
import { applyQualifyingSweepException } from '@/app/lib/calculations/utils/sweep-helpers'

export interface AggregationInput {
  seasons: string[]
  playerData: HistoricalDataRow[]
  playerTokenData: HistoricalDataRow[]
  guildAvgRpcData: GuildAvgRpcRow[]
  additionalGuildAvgData: GuildAvgRpcRow[]
  guildPlayerScoresData: GuildScoreRpcRow[]
  additionalGuildScoresData: GuildScoreRpcRow[]
  clusterAvgData: Array<{
    Season: string
    boss_name: string
    rarity: string
    set: number
    cluster_avg: number
  }>
  guildCode: string
  resolvedPlayerId: string | null
}

export interface AggregationResult {
  performanceData: Record<string, HistoricalPerformanceEntry>
  historicalTokens: Record<string, number>
  historicalTotalDamage: Record<string, number>
  seasonsWithPlayerData: Set<string>
}

const bossKeyForAverages = (row: HistoricalDataRow) =>
  `${row.Name}_${row.rarity || ''}_${row.set ?? 0}`

export function aggregateSeasonPerformance(
  input: AggregationInput
): AggregationResult {
  const {
    seasons,
    playerData,
    playerTokenData,
    guildAvgRpcData,
    additionalGuildAvgData,
    guildPlayerScoresData,
    additionalGuildScoresData,
    clusterAvgData,
    guildCode,
    resolvedPlayerId
  } = input

  const performanceData: Record<string, HistoricalPerformanceEntry> = {}
  const historicalTokens: Record<string, number> = {}
  const historicalTotalDamage: Record<string, number> = {}

  const seasonsWithPlayerData = new Set<string>()
  playerData.forEach((row) => {
    if (row.Season) seasonsWithPlayerData.add(row.Season)
  })
  playerTokenData.forEach((row) => {
    if (row.Season) seasonsWithPlayerData.add(row.Season)
  })

  seasons.forEach((seasonKey) => {
    const seasonPlayerTokensRaw = playerTokenData.filter(
      (row) => row.Season === seasonKey
    )
    const seasonPlayerTokens = seasonPlayerTokensRaw.filter(
      (row) => typeof row.damageDealt === 'number' && row.damageDealt > 0
    )

    const totalTokensAll = seasonPlayerTokens.length
    historicalTokens[seasonKey] = totalTokensAll
    const totalSeasonDamageAll = seasonPlayerTokens.reduce(
      (sum: number, row) => sum + (row.damageDealt || 0),
      0
    )
    historicalTotalDamage[seasonKey] =
      totalTokensAll > 0 ? totalSeasonDamageAll / totalTokensAll : 0

    const seasonPlayerAll = playerData.filter((row) => row.Season === seasonKey)
    const seasonPlayerData = seasonPlayerAll.filter(
      (row) => !isSweepBattle(row as PartialBattleRow)
    )
    const seasonPlayerSweeps = seasonPlayerAll.filter((row) =>
      isSweepBattle(row as PartialBattleRow)
    )

    if (seasonPlayerData.length === 0 && seasonPlayerSweeps.length === 0) {
      if (!performanceData[seasonKey]) {
        performanceData[seasonKey] = {
          vsGuild: 0,
          vsCluster: 0,
          hasGuildComparison: false,
          bossDetails: [],
          guild: guildCode
        }
      }
      return
    }

    // A player may have transferred: use the season's majority guild.
    const seasonGuildCounts = new Map<string, number>()
    seasonPlayerAll.forEach((row) => {
      const guildValue = row.Guild ? String(row.Guild).trim() : ''
      if (!guildValue) return
      seasonGuildCounts.set(
        guildValue,
        (seasonGuildCounts.get(guildValue) ?? 0) + 1
      )
    })
    const seasonGuild =
      [...seasonGuildCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ||
      guildCode

    const allGuildAvgData =
      seasonGuild === guildCode
        ? guildAvgRpcData
        : [...guildAvgRpcData, ...additionalGuildAvgData]
    const guildBossAverages = new Map<
      string,
      { totalDamage: number; battleCount: number; avgDamage: number }
    >()
    allGuildAvgData
      .filter((row) => row.season === seasonKey)
      .forEach((row) => {
        guildBossAverages.set(row.boss_key, {
          totalDamage: row.total_damage,
          battleCount: row.battle_count,
          avgDamage: row.avg_damage
        })
      })

    const clusterBossAverages = new Map<string, { avgDamage: number }>()
    const seasonClusterAvgs = clusterAvgData.filter(
      (row) => row.Season === seasonKey
    )
    seasonClusterAvgs.forEach((row) => {
      const clusterKey = `${row.boss_name}_${row.rarity}_${row.set ?? 0}`
      clusterBossAverages.set(clusterKey, { avgDamage: row.cluster_avg || 0 })
    })

    const playerBossTotals = new Map<
      string,
      { totalDamage: number; battleCount: number }
    >()
    seasonPlayerData.forEach((row) => {
      const key = bossKeyForAverages(row)
      if (!playerBossTotals.has(key)) {
        playerBossTotals.set(key, { totalDamage: 0, battleCount: 0 })
      }
      const totals = playerBossTotals.get(key)!
      totals.totalDamage += row.damageDealt || 0
      totals.battleCount += 1
    })

    const playerSweepDamages = new Map<string, number[]>()
    seasonPlayerSweeps.forEach((row) => {
      const key = bossKeyForAverages(row)
      if (!playerSweepDamages.has(key)) {
        playerSweepDamages.set(key, [])
      }
      playerSweepDamages.get(key)!.push(row.damageDealt || 0)
    })

    let totalGuildWeight = 0
    let totalClusterWeight = 0
    let weightedGuildSum = 0
    let weightedClusterSum = 0
    const bossDetails: HistoricalPerformanceEntry['bossDetails'] = []

    const allPlayerBossKeys = new Set([
      ...playerBossTotals.keys(),
      ...playerSweepDamages.keys()
    ])

    allPlayerBossKeys.forEach((bossKey) => {
      const playerTotals = playerBossTotals.get(bossKey) ?? {
        totalDamage: 0,
        battleCount: 0
      }
      const sweepDamages = playerSweepDamages.get(bossKey) ?? []
      const guildAvg = guildBossAverages.get(bossKey)
      const clusterAvg = clusterBossAverages.get(bossKey)

      // A sweep counts only above GREATEST(own non-sweep avg, reference avg); the sweep-adjusted avg is circular.
      const playerNonSweepAvg =
        playerTotals.battleCount > 0
          ? playerTotals.totalDamage / playerTotals.battleCount
          : 0
      const guildAdj = applyQualifyingSweepException(
        playerTotals.totalDamage,
        playerTotals.battleCount,
        sweepDamages,
        guildAvg?.avgDamage ?? 0,
        playerNonSweepAvg
      )
      const clusterAdj = applyQualifyingSweepException(
        playerTotals.totalDamage,
        playerTotals.battleCount,
        sweepDamages,
        clusterAvg?.avgDamage ?? 0,
        playerNonSweepAvg
      )

      const guildEffectiveCount = guildAdj.adjustedCount
      const clusterEffectiveCount = clusterAdj.adjustedCount

      const playerAvgForGuild =
        guildEffectiveCount > 0
          ? guildAdj.adjustedDamage / guildEffectiveCount
          : 0
      const playerAvgForCluster =
        clusterEffectiveCount > 0
          ? clusterAdj.adjustedDamage / clusterEffectiveCount
          : 0

      let vsGuild = 0
      let vsCluster = 0

      if (guildAvg && guildAvg.avgDamage > 0 && guildEffectiveCount > 0) {
        vsGuild = (playerAvgForGuild / guildAvg.avgDamage - 1) * 100
        weightedGuildSum += vsGuild * guildEffectiveCount
        totalGuildWeight += guildEffectiveCount
      }
      if (clusterAvg && clusterAvg.avgDamage > 0 && clusterEffectiveCount > 0) {
        vsCluster = (playerAvgForCluster / clusterAvg.avgDamage - 1) * 100
        weightedClusterSum += vsCluster * clusterEffectiveCount
        totalClusterWeight += clusterEffectiveCount
      }

      bossDetails.push({
        bossName: bossKey.replace(/_{2,}/g, '_'),
        vsGuild,
        vsCluster,
        battles: guildEffectiveCount || playerTotals.battleCount,
        playerAvgDamage: playerAvgForGuild,
        nonSweepDamage: playerTotals.totalDamage,
        nonSweepBattleCount: playerTotals.battleCount,
        sweepDamages: sweepDamages.length > 0 ? [...sweepDamages] : undefined
      })
    })

    const seasonVsGuildAvg =
      totalGuildWeight > 0 ? weightedGuildSum / totalGuildWeight : 0
    const seasonVsClusterAvg =
      totalClusterWeight > 0 ? weightedClusterSum / totalClusterWeight : 0

    performanceData[seasonKey] = {
      vsGuild: seasonVsGuildAvg,
      vsCluster: seasonVsClusterAvg,
      hasGuildComparison: totalGuildWeight > 0,
      bossDetails,
      guild: seasonGuild
    }

    if (resolvedPlayerId) {
      const allSeasonScores =
        seasonGuild === guildCode
          ? guildPlayerScoresData
          : [...guildPlayerScoresData, ...additionalGuildScoresData]
      const seasonScores = allSeasonScores
        .filter((row) => row.season === seasonKey)
        .sort((a, b) => b.weighted_vs_guild - a.weighted_vs_guild)

      if (seasonScores.length > 0) {
        const guildRankIndex = seasonScores.findIndex(
          (entry) => entry.user_id === resolvedPlayerId
        )
        const existingEntry = performanceData[seasonKey] ?? {
          vsGuild: 0,
          vsCluster: 0
        }
        performanceData[seasonKey] = {
          ...existingEntry,
          guildRank: guildRankIndex >= 0 ? guildRankIndex + 1 : undefined,
          totalPlayersInGuild: seasonScores.length
        }
      }
    }
  })

  return {
    performanceData,
    historicalTokens,
    historicalTotalDamage,
    seasonsWithPlayerData
  }
}
