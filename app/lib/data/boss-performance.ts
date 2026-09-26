import { db } from '@/app/lib/db'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.data.boss-performance')

interface PlayerBossPerformanceRPCResult {
  display_name: string
  boss_name: string
  player_vs_guild_avg: number
  player_vs_cluster_avg: number
  boss_preference: 'strong' | 'weak' | 'neutral' | null
}

interface PlayerBossPerformanceHistoricalRPCResult {
  display_name: string
  boss_name: string
  player_vs_guild_avg: number
  battle_count?: number
  has_sufficient_data?: boolean
}

export interface BossPerformanceData {
  boss_name: string
  player_vs_guild_avg: number
  player_vs_cluster_avg: number
  preference: 'strong' | 'weak' | 'neutral'
  battle_count?: number
  has_sufficient_data?: boolean
}

export interface PlayerBossPerformance {
  [playerName: string]: BossPerformanceData[]
}

export async function getBossPerformance(
  guildCode: string,
  season: string
): Promise<PlayerBossPerformance> {
  if (!guildCode || !season) {
    throw new Error('Guild code and season are required')
  }

  const supabase = await db()
  const { data, error } = (await supabase.rpc('get_player_boss_performance', {
    guild_code_param: guildCode,
    season_param: season
  })) as { data: PlayerBossPerformanceRPCResult[] | null; error: Error | null }

  if (error) {
    logger.error(
      { guildCode, season, error },
      'Error fetching boss performance:'
    )
    throw new Error('Failed to fetch boss performance')
  }

  const playerPerformanceMap = new Map<string, BossPerformanceData[]>()

  const rows = data ?? []

  rows.forEach((row) => {
    const displayName = row.display_name ?? null
    if (!displayName) return

    const performances = playerPerformanceMap.get(displayName) ?? []
    performances.push({
      boss_name: row.boss_name,
      player_vs_guild_avg: row.player_vs_guild_avg ?? 0,
      player_vs_cluster_avg: row.player_vs_cluster_avg ?? 0,
      preference: row.boss_preference ?? 'neutral'
    })
    playerPerformanceMap.set(displayName, performances)
  })

  return Object.fromEntries(playerPerformanceMap)
}

export async function getPlayerBossPerformance(
  guildCode: string,
  season: string,
  playerName: string
): Promise<BossPerformanceData[]> {
  if (!guildCode || !season || !playerName) {
    throw new Error('Guild code, season, and player name are required')
  }

  const supabase = await db()
  const { data, error } = (await supabase.rpc('get_player_boss_performance', {
    guild_code_param: guildCode,
    season_param: season
  })) as { data: PlayerBossPerformanceRPCResult[] | null; error: Error | null }

  if (error) {
    logger.error(
      { guildCode, season, playerName, error },
      'Error fetching player boss performance:'
    )
    throw new Error('Failed to fetch player boss performance')
  }

  const playerRows = (data ?? []).filter(
    (row) => row.display_name === playerName
  )

  return playerRows.map((row) => ({
    boss_name: row.boss_name,
    player_vs_guild_avg: row.player_vs_guild_avg ?? 0,
    player_vs_cluster_avg: row.player_vs_cluster_avg ?? 0,
    preference: row.boss_preference ?? 'neutral'
  }))
}

export async function getHistoricalBossPerformance(
  guildCode: string
): Promise<PlayerBossPerformance> {
  if (!guildCode) {
    throw new Error('Guild code is required')
  }

  const supabase = await db()

  const flexibleResult = (await supabase.rpc(
    'get_player_boss_performance_flexible',
    {
      guild_code_param: guildCode,
      min_battles_param: 1
    }
  )) as {
    data: PlayerBossPerformanceHistoricalRPCResult[] | null
    error: { message?: string; details?: string } | null
  }

  let rows: PlayerBossPerformanceHistoricalRPCResult[] = []

  if (flexibleResult.error) {
    const message =
      flexibleResult.error.message ?? flexibleResult.error.details ?? ''
    if (message.includes('does not exist')) {
      const fallbackResult = (await supabase.rpc(
        'get_player_boss_performance_historical',
        {
          guild_code_param: guildCode
        }
      )) as {
        data: PlayerBossPerformanceHistoricalRPCResult[] | null
        error: Error | null
      }

      if (fallbackResult.error) {
        logger.error(
          { err: fallbackResult.error },
          'Error fetching historical boss performance fallback:'
        )
        return {}
      }

      rows = fallbackResult.data ?? []
    } else {
      logger.error(
        { err: flexibleResult.error },
        'Error fetching flexible historical boss performance:'
      )
      return {}
    }
  } else {
    rows = flexibleResult.data ?? []
  }

  const playerPerformanceMap = new Map<string, BossPerformanceData[]>()

  rows.forEach((row) => {
    const displayName = row.display_name ?? null
    if (!displayName) return

    const performance_value =
      row.has_sufficient_data === false
        ? 0 // Guild average baseline instead of 0.01
        : (row.player_vs_guild_avg ?? 0)

    const performances = playerPerformanceMap.get(displayName) ?? []
    performances.push({
      boss_name: row.boss_name,
      player_vs_guild_avg: performance_value,
      player_vs_cluster_avg: 0, // Not available in historical, default to 0
      preference: 'neutral',
      battle_count: row.battle_count,
      has_sufficient_data: row.has_sufficient_data
    })
    playerPerformanceMap.set(displayName, performances)
  })

  return Object.fromEntries(playerPerformanceMap)
}

export async function getBossPerformanceSummary(
  guildCode: string,
  season: string
): Promise<{
  totalPlayers: number
  averageGuildPerformance: number
  averageClusterPerformance: number
  strongPerformers: string[]
  weakPerformers: string[]
}> {
  const data = await getBossPerformance(guildCode, season)

  let totalGuildScore = 0
  let totalClusterScore = 0
  const strongPerformers = new Set<string>()
  const weakPerformers = new Set<string>()

  Object.entries(data).forEach(([playerName, performances]) => {
    let playerGuildAvg = 0
    let playerClusterAvg = 0

    performances.forEach((perf) => {
      playerGuildAvg += perf.player_vs_guild_avg
      playerClusterAvg += perf.player_vs_cluster_avg
    })

    if (performances.length > 0) {
      playerGuildAvg /= performances.length
      playerClusterAvg /= performances.length

      totalGuildScore += playerGuildAvg
      totalClusterScore += playerClusterAvg

      if (playerGuildAvg > 20) {
        strongPerformers.add(playerName)
      } else if (playerGuildAvg < -20) {
        weakPerformers.add(playerName)
      }
    }
  })

  const totalPlayers = Object.keys(data).length

  return {
    totalPlayers,
    averageGuildPerformance:
      totalPlayers > 0 ? totalGuildScore / totalPlayers : 0,
    averageClusterPerformance:
      totalPlayers > 0 ? totalClusterScore / totalPlayers : 0,
    strongPerformers: Array.from(strongPerformers),
    weakPerformers: Array.from(weakPerformers)
  }
}
