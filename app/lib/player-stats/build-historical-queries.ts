import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'lib.player-stats.build-historical-queries'
)
import type {
  HistoricalDataRow,
  GuildAvgRpcRow,
  GuildScoreRpcRow
} from './types'

export interface BulkQueryResult {
  playerData: HistoricalDataRow[]
  guildAvgRpcData: GuildAvgRpcRow[]
  guildPlayerScoresData: GuildScoreRpcRow[]
  clusterAvgData: Array<{
    Season: string
    boss_name: string
    encounterId: number
    rarity: string
    set: number
    cluster_avg: number
    battle_count: number
  }>
  playerTokenData: HistoricalDataRow[]
  additionalGuildAvgData: GuildAvgRpcRow[]
  additionalGuildScoresData: GuildScoreRpcRow[]
}

export async function executeBulkQueries(
  supabase: SupabaseClient,
  resolvedPlayerId: string | null,
  guildCode: string,
  guildCodes: string[],
  seasons: string[],
  playerClusterCode: string | null
): Promise<BulkQueryResult> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const buildPlayerQuery = (baseQuery: any): any => {
    if (resolvedPlayerId) {
      if (process.env.NODE_ENV === 'development') {
        logger.debug(
          { seasonsRequested: seasons.length },
          'Using stable identity query for historical data'
        )
      }
      return baseQuery.eq('userId', resolvedPlayerId)
    }

    if (process.env.NODE_ENV === 'development') {
      logger.debug(
        { seasonsRequested: seasons.length },
        'Stable identity unavailable; skipping historical player query'
      )
    }

    return baseQuery.eq('userId', '__unresolvable__')
  }

  const [
    playerDataResult,
    guildAvgRpcResult,
    clusterAvgResult,
    playerTokenResult,
    guildPlayerScoresResult
  ] = await Promise.all([
    buildPlayerQuery(
      supabase
        .from('EOT_GR_data')
        .select(
          'Season, displayName, Name, damageDealt, remainingHp, maxHp, Guild, set, tier, rarity, encounterId, userId'
        )
    )
      .in('Guild', guildCodes)
      .in('Season', seasons)
      .eq('damageType', 'Battle')
      .in('rarity', ['Legendary', 'Mythic'])
      .gt('damageDealt', 0)
      .order('startedOn', { ascending: false }),
    supabase.rpc('get_guild_boss_averages_batch', {
      p_guild_code: guildCode,
      p_seasons: seasons
    }),
    playerClusterCode
      ? supabase
          .from('mv_cluster_boss_averages')
          .select(
            'Season, boss_name, encounterId, rarity, set, cluster_avg, battle_count'
          )
          .eq('cluster_code', playerClusterCode)
          .in('Season', seasons)
      : Promise.resolve({ data: [] }),
    buildPlayerQuery(
      supabase
        .from('EOT_GR_data')
        .select('Season, damageDealt, remainingHp, maxHp, damageType, userId')
    )
      .in('Guild', guildCodes)
      .in('Season', seasons)
      .eq('damageType', 'Battle')
      .gt('damageDealt', 0)
      .order('startedOn', { ascending: false }),
    supabase.rpc('get_guild_player_scores_batch', {
      p_guild_code: guildCode,
      p_seasons: seasons
    })
  ])

  const playerData: HistoricalDataRow[] = playerDataResult.data || []

  const guildAvgRpcData: GuildAvgRpcRow[] = guildAvgRpcResult.data || []
  if (guildAvgRpcResult.error) {
    logger.warn(
      { data: guildAvgRpcResult.error },
      'Guild boss averages batch RPC error (continuing with empty data):'
    )
  }

  const guildPlayerScoresData: GuildScoreRpcRow[] =
    guildPlayerScoresResult.data || []
  if (guildPlayerScoresResult.error) {
    logger.warn(
      { data: guildPlayerScoresResult.error },
      'Guild player scores batch RPC error:'
    )
  }

  const playerHistoricalGuilds = new Set<string>()
  playerData.forEach((row) => {
    if (row.Guild) playerHistoricalGuilds.add(String(row.Guild).trim())
  })
  const additionalGuilds = [...playerHistoricalGuilds].filter(
    (g) => g && g !== guildCode
  )

  let additionalGuildAvgData: GuildAvgRpcRow[] = []
  let additionalGuildScoresData: GuildScoreRpcRow[] = []
  if (additionalGuilds.length > 0) {
    const additionalResults = await Promise.all(
      additionalGuilds.map(async (additionalGuild) => {
        const [avgResult, scoresResult] = await Promise.all([
          supabase.rpc('get_guild_boss_averages_batch', {
            p_guild_code: additionalGuild,
            p_seasons: seasons
          }),
          supabase.rpc('get_guild_player_scores_batch', {
            p_guild_code: additionalGuild,
            p_seasons: seasons
          })
        ])
        return {
          guild: additionalGuild,
          avgData: (avgResult.data || []) as GuildAvgRpcRow[],
          scoresData: (scoresResult.data || []) as GuildScoreRpcRow[]
        }
      })
    )
    additionalResults.forEach((r) => {
      additionalGuildAvgData = [...additionalGuildAvgData, ...r.avgData]
      additionalGuildScoresData = [
        ...additionalGuildScoresData,
        ...r.scoresData
      ]
    })
  }

  const clusterAvgData =
    playerClusterCode && clusterAvgResult && 'data' in clusterAvgResult
      ? clusterAvgResult.data || []
      : []

  const playerTokenData: HistoricalDataRow[] = playerTokenResult.data || []

  return {
    playerData,
    guildAvgRpcData,
    guildPlayerScoresData,
    clusterAvgData,
    playerTokenData,
    additionalGuildAvgData,
    additionalGuildScoresData
  }
}
