import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.data.historical-boss-performance')
import { getCurrentDisplayName } from '@/app/lib/utils/player-resolution'
import type { EOTGRData } from '@tacticus/app-core/types'

type BattleRow = Pick<
  EOTGRData,
  | 'Season'
  | 'userId'
  | 'displayName'
  | 'Name'
  | 'damageDealt'
  | 'rarity'
  | 'encounterId'
  | 'damageType'
  | 'remainingHp'
  | 'maxHp'
>

interface DamageStat {
  total: number
  count: number
}

export interface HistoricalBossPerformance {
  player_id: string
  player_name: string
  boss_name: string
  avg_vs_guild_pct: number // >0 = above guild avg
  battle_count: number
  season: string
}

export async function getComprehensiveHistoricalPerformance(
  guildCode: string
): Promise<Record<string, Record<string, number>>> {
  try {
    const supabase = await db()

    // Season is TEXT ('99' sorts before '100'), so the row cap would drop the newest rows.
    const { data: battleData, error } = (await supabase
      .from('EOT_GR_data')
      .select(
        'Season, userId, displayName, Name, damageDealt, rarity, encounterId, damageType, remainingHp, maxHp'
      )
      .eq('Guild', guildCode)
      .eq('damageType', 'Battle')
      .in('rarity', ['Legendary', 'Mythic'])
      .gt('damageDealt', 0)
      .order('startedOn', { ascending: false })) as {
      data: BattleRow[] | null
      error: Error | null
    }

    if (error) {
      logger.error({ err: error }, 'Error fetching historical battle data:')
      throw error
    }

    if (!battleData || battleData.length === 0) {
      return {}
    }

    const playerBossSeasonData: Record<
      string,
      Record<string, Record<string, DamageStat>>
    > = {}
    const guildBossSeasonData: Record<string, Record<string, DamageStat>> = {}
    const playerIdToName: Record<string, string> = {}
    const allPlayerIds = new Set<string>()

    battleData.forEach((row) => {
      if (row.userId) {
        allPlayerIds.add(row.userId)
      }
    })

    // Batch players with exactly one is_current mapping; the rest use the per-player fallback.
    const playerIdList = Array.from(allPlayerIds)
    const currentNameById = new Map<string, string>()
    const currentRowCount = new Map<string, number>()
    if (playerIdList.length > 0) {
      const { data: currentRows, error: currentErr } = await supabase
        .from('player_mapping')
        .select('player_id, display_name')
        .in('player_id', playerIdList)
        .eq('is_current', true)
      if (currentErr) {
        logger.warn(
          { err: currentErr },
          'Batch current-name resolution failed; falling back per player'
        )
      } else {
        currentRows?.forEach((row) => {
          if (!row.player_id) return
          currentRowCount.set(
            row.player_id,
            (currentRowCount.get(row.player_id) ?? 0) + 1
          )
          if (row.display_name) {
            currentNameById.set(row.player_id, row.display_name)
          }
        })
      }
    }

    for (const playerId of allPlayerIds) {
      if (currentRowCount.get(playerId) === 1) {
        const batched = currentNameById.get(playerId)
        if (batched) {
          playerIdToName[playerId] = batched
          continue
        }
      }
      try {
        const currentName = await getCurrentDisplayName(supabase, playerId)
        if (currentName) {
          playerIdToName[playerId] = currentName
        }
      } catch (error) {
        logger.warn(
          { err: error, playerId },
          'Could not resolve current player display name'
        )
      }
    }

    battleData.forEach((row) => {
      const isSweep =
        row.remainingHp === 0 &&
        (row.maxHp ?? 0) > 0 &&
        (row.damageDealt ?? 0) < (row.maxHp ?? 0)
      if (isSweep) return

      const playerId = row.userId
      const playerName = row.displayName
      const bossName = row.Name
      const season = row.Season
      const damage = row.damageDealt

      if (!playerId || !playerName) return

      if (!playerIdToName[playerId]) {
        playerIdToName[playerId] = playerName
      }

      if (!bossName || !season || damage == null) return

      if (!playerBossSeasonData[playerId]) {
        playerBossSeasonData[playerId] = {}
      }
      if (!playerBossSeasonData[playerId][bossName]) {
        playerBossSeasonData[playerId][bossName] = {}
      }
      if (!playerBossSeasonData[playerId][bossName][season]) {
        playerBossSeasonData[playerId][bossName][season] = {
          total: 0,
          count: 0
        }
      }

      playerBossSeasonData[playerId][bossName][season].total += damage
      playerBossSeasonData[playerId][bossName][season].count += 1

      if (!guildBossSeasonData[bossName]) {
        guildBossSeasonData[bossName] = {}
      }
      if (!guildBossSeasonData[bossName][season]) {
        guildBossSeasonData[bossName][season] = { total: 0, count: 0 }
      }
      guildBossSeasonData[bossName][season].total += damage
      guildBossSeasonData[bossName][season].count += 1
    })

    const result: Record<string, Record<string, number>> = {}

    Object.entries(playerBossSeasonData).forEach(([playerId, bosses]) => {
      result[playerId] = {}

      Object.entries(bosses).forEach(([bossName, seasons]) => {
        const sortedSeasons = Object.keys(seasons).sort(
          (a, b) => parseInt(b, 10) - parseInt(a, 10)
        )
        const mostRecentSeason = sortedSeasons[0]

        if (mostRecentSeason) {
          const playerData = seasons[mostRecentSeason]
          if (!playerData || playerData.count === 0) return
          const playerAvg = playerData.total / playerData.count

          const guildData = guildBossSeasonData[bossName]?.[mostRecentSeason]
          if (guildData && guildData.count > 0) {
            const guildAvg = guildData.total / guildData.count

            const avgVsGuildPct = (playerAvg / guildAvg - 1) * 100

            const playerResult = result[playerId]
            if (playerResult) {
              playerResult[bossName] = avgVsGuildPct
            }
          }
        }
      })
    })

    return result
  } catch (error) {
    logger.error(
      { err: error },
      'Error in getComprehensiveHistoricalPerformance:'
    )
    return {}
  }
}

export async function getHistoricalPerformanceForAssignments(
  guildCode: string,
  players: string[],
  bosses: string[]
): Promise<Record<string, Record<string, number>>> {
  try {
    const allPerformance =
      await getComprehensiveHistoricalPerformance(guildCode)

    const result: Record<string, Record<string, number>> = {}

    players.forEach((playerName) => {
      const playerPerformance = allPerformance[playerName]
      if (!playerPerformance) return
      result[playerName] = {}
      bosses.forEach((bossName) => {
        const value = playerPerformance[bossName]
        if (value !== undefined) {
          const playerResult = result[playerName]
          if (playerResult) {
            playerResult[bossName] = value
          }
        }
      })
    })

    return result
  } catch (error) {
    logger.error(
      { err: error },
      'Error fetching historical performance for assignments:'
    )
    return {}
  }
}
