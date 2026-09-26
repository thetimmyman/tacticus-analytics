import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'components.playerstats.hooks.data-fetchers.fetchBossRankings'
)
import type { SupabaseClient } from '@supabase/supabase-js'
import type {
  BossStatDetail,
  BossRanking,
  PlayerStats
} from '@/app/components/playerstats/types'
import {
  normalizeText,
  resolveBossKey,
  isSweepBattle,
  isMissingRpc,
  describeSupabaseError
} from '@/app/components/playerstats/utils'
import { applyQualifyingSweepException } from '@/app/lib/calculations/utils/sweep-helpers'

let bossRankingsRpcAvailable = true

export function resetBossRankingsRpcFlag() {
  bossRankingsRpcAvailable = true
}

export interface FetchBossRankingsParams {
  supabase: SupabaseClient
  playerName: string
  guildCode: string
  clusterCode: string | null
  season: string
  currentStats: PlayerStats
  mappingPlayerId?: string | null
  mappingUserId?: string | null
}

export interface BossRankingsResult {
  bossStats: Record<string, BossStatDetail>
  primeStats: Record<string, BossStatDetail>
}

export async function fetchBossRankings(
  params: FetchBossRankingsParams
): Promise<BossRankingsResult | null> {
  const {
    supabase,
    playerName,
    guildCode,
    clusterCode,
    season,
    currentStats,
    mappingPlayerId,
    mappingUserId
  } = params

  try {
    let playerClusterCode = clusterCode
    if (!playerClusterCode) {
      try {
        // Live and narrow: the cached config service adds bundle weight and a 10-minute TTL.
        const { data: guildRow } = await supabase
          .from('guild_config')
          .select('cluster_code')
          .eq('guild_code', guildCode)
          .maybeSingle()
        if (guildRow?.cluster_code) {
          playerClusterCode = guildRow.cluster_code
        }
      } catch (clusterError) {
        logger.error(
          { err: describeSupabaseError(clusterError) },
          'Failed to resolve cluster code for boss rankings'
        )
      }
    }

    let rankingsData: BossRanking[] | null = null
    if (playerClusterCode && bossRankingsRpcAvailable) {
      try {
        const { data, error } = await supabase.rpc('get_player_boss_rankings', {
          p_player_name: playerName,
          p_guild_code: guildCode,
          p_cluster_code: playerClusterCode,
          p_season: season
        })
        if (error) {
          const msg = describeSupabaseError(error)
          if (!isMissingRpc(msg)) {
            logger.error({ err: msg }, 'Error fetching cluster boss rankings:')
          } else {
            bossRankingsRpcAvailable = false
          }
        } else if (Array.isArray(data)) {
          rankingsData = data as BossRanking[]
        }
      } catch (rpcError) {
        const msg = describeSupabaseError(rpcError)
        if (!isMissingRpc(msg)) {
          logger.error({ err: msg }, 'Exception during boss ranking RPC call:')
        } else {
          bossRankingsRpcAvailable = false
        }
      }
    }

    const guildRankingsByBoss: Record<string, { rank: number; total: number }> =
      {}
    try {
      const { data: guildBattleRows, error: guildBattleError } = await supabase
        .from('EOT_GR_data')
        .select(
          'Name, rarity, set, encounterId, displayName, damageDealt, damageType, remainingHp, maxHp, userId'
        )
        .eq('Guild', guildCode)
        .eq('Season', season)
        .eq('damageType', 'Battle')
        .in('rarity', ['Legendary', 'Mythic'])
        .gt('damageDealt', 0)
        .order('startedOn', { ascending: false })

      if (guildBattleError) {
        logger.error(
          { err: describeSupabaseError(guildBattleError) },
          'Error fetching guild battle data for rankings:'
        )
      } else if (Array.isArray(guildBattleRows) && guildBattleRows.length > 0) {
        const targetName = normalizeText(playerName)
        const targetIdentifiers = new Set<string>()
        targetIdentifiers.add(playerName)
        targetIdentifiers.add(targetName)

        if (mappingPlayerId) {
          const trimmed = String(mappingPlayerId).trim()
          if (trimmed) {
            targetIdentifiers.add(trimmed)
            targetIdentifiers.add(normalizeText(trimmed))
          }
        }
        if (mappingUserId) {
          const trimmed = String(mappingUserId).trim()
          if (trimmed) {
            targetIdentifiers.add(trimmed)
            targetIdentifiers.add(normalizeText(trimmed))
          }
        }

        const bossPlayerMap = new Map<
          string,
          Map<string, { total: number; count: number }>
        >()
        const bossSweepMap = new Map<string, Map<string, number[]>>()

        guildBattleRows.forEach((row) => {
          const normalizedRowName = normalizeText(row.displayName)
          if (normalizedRowName === targetName) {
            const candidateId = row.userId?.trim()
            if (candidateId) {
              targetIdentifiers.add(candidateId)
              targetIdentifiers.add(normalizeText(candidateId))
            }
          }

          const playerId = row.userId?.trim()
          const playerKey = playerId || normalizedRowName
          if (!playerKey) return

          const bossKey = `${row.Name}_${row.rarity}_${row.set ?? 0}`

          if (isSweepBattle(row)) {
            // Sweeps tracked separately for the qualifying exception.
            if (!bossSweepMap.has(bossKey)) {
              bossSweepMap.set(bossKey, new Map())
            }
            const sweepsForBoss = bossSweepMap.get(bossKey)!
            const existing = sweepsForBoss.get(playerKey) || []
            existing.push(row.damageDealt || 0)
            sweepsForBoss.set(playerKey, existing)
            return
          }

          if (!bossPlayerMap.has(bossKey)) {
            bossPlayerMap.set(bossKey, new Map())
          }
          const playersForBoss = bossPlayerMap.get(bossKey)!
          const currentEntry = playersForBoss.get(playerKey) || {
            total: 0,
            count: 0
          }
          currentEntry.total += row.damageDealt || 0
          currentEntry.count += 1
          playersForBoss.set(playerKey, currentEntry)
        })

        bossPlayerMap.forEach((playerMap, bossKey) => {
          // Sweep-free guild average: the qualifying-exception baseline.
          let bossGuildTotal = 0
          let bossGuildCount = 0
          playerMap.forEach((values) => {
            bossGuildTotal += values.total
            bossGuildCount += values.count
          })
          const bossGuildAvg =
            bossGuildCount > 0 ? bossGuildTotal / bossGuildCount : 0

          const sweepsForBoss = bossSweepMap.get(bossKey)

          const sortedPlayers = Array.from(playerMap.entries())
            .map(([playerKey, values]) => {
              const sweepDamages = sweepsForBoss?.get(playerKey) ?? []
              // Gate = GREATEST(player's non-sweep avg, guild avg).
              const playerNonSweepAvg =
                values.count > 0 ? values.total / values.count : 0
              const { adjustedDamage, adjustedCount } =
                applyQualifyingSweepException(
                  values.total,
                  values.count,
                  sweepDamages,
                  bossGuildAvg,
                  playerNonSweepAvg
                )
              return {
                playerKey,
                avg: adjustedCount > 0 ? adjustedDamage / adjustedCount : 0
              }
            })
            .filter((entry) => entry.avg > 0)
            .sort((a, b) => b.avg - a.avg)

          const totalPlayers = sortedPlayers.length
          if (totalPlayers === 0) return

          const rankIndex = sortedPlayers.findIndex((entry) => {
            if (targetIdentifiers.has(entry.playerKey)) {
              return true
            }
            const normalizedKey = normalizeText(entry.playerKey)
            return targetIdentifiers.has(normalizedKey)
          })
          if (rankIndex >= 0) {
            guildRankingsByBoss[bossKey] = {
              rank: rankIndex + 1,
              total: totalPlayers
            }
          }
        })
      }
    } catch (guildRankingError) {
      logger.error(
        { err: describeSupabaseError(guildRankingError) },
        'Failed to compute guild rankings for bosses:'
      )
    }

    const hasClusterRanks =
      Array.isArray(rankingsData) && rankingsData.length > 0
    const hasGuildRanks = Object.keys(guildRankingsByBoss).length > 0

    if (!hasClusterRanks && !hasGuildRanks) {
      return null
    }

    const nextBossStats: Record<string, BossStatDetail> = {}
    Object.entries(currentStats.bossStats ?? {}).forEach(([key, value]) => {
      nextBossStats[key] = {
        ...value,
        guildRank: undefined,
        totalPlayersOnBossGuild: undefined
      }
    })

    const nextPrimeStats: Record<string, BossStatDetail> = {}
    Object.entries(currentStats.primeStats ?? {}).forEach(([key, value]) => {
      nextPrimeStats[key] = {
        ...value,
        guildRank: undefined,
        totalPlayersOnBossGuild: undefined
      }
    })

    if (hasClusterRanks && rankingsData) {
      rankingsData.forEach((ranking) => {
        const bossName = ranking.boss_name
        const encounterId = ranking.encounter_id
        const isPrime = encounterId === 1 || encounterId === 2
        const targetCollection = isPrime ? nextPrimeStats : nextBossStats
        const targetKey = resolveBossKey(targetCollection, bossName)
        if (!targetKey) return
        const targetStats = targetCollection[targetKey]
        if (!targetStats) return
        targetStats.clusterRank = ranking.player_rank || 0
        targetStats.totalPlayersOnBoss = ranking.total_players || 0
      })
    }

    if (hasGuildRanks) {
      Object.entries(guildRankingsByBoss).forEach(
        ([bossKey, { rank, total }]) => {
          const bossTargetKey = resolveBossKey(nextBossStats, bossKey)
          if (bossTargetKey && nextBossStats[bossTargetKey]) {
            nextBossStats[bossTargetKey].guildRank = rank
            nextBossStats[bossTargetKey].totalPlayersOnBossGuild = total
          }
          const primeTargetKey = resolveBossKey(nextPrimeStats, bossKey)
          if (primeTargetKey && nextPrimeStats[primeTargetKey]) {
            nextPrimeStats[primeTargetKey].guildRank = rank
            nextPrimeStats[primeTargetKey].totalPlayersOnBossGuild = total
          }
        }
      )
    }

    return {
      bossStats: nextBossStats,
      primeStats: nextPrimeStats
    }
  } catch (error) {
    logger.error({ err: error }, 'Failed to fetch boss rankings')
    return null
  }
}
