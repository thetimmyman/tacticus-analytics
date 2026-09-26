import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.dashboard.guild-summary')
import type {
  Database,
  PlayerMapping,
  TypedSupabaseClient
} from '@tacticus/app-core/types'
import { getPlayerPerformanceSummaryRPC } from '@/app/lib/calculations/experimental/player-performance-summary'
import type {
  CredentialHealthSummary,
  LandingPagePersonalStats
} from './home-summary-types'
import { normalizeName, toNumber } from './_internal/coercion'

type SupabaseClient = TypedSupabaseClient

export type PlayerPerformanceRow = Pick<
  Database['public']['Tables']['EOT_GR_data']['Row'],
  | 'displayName'
  | 'damageType'
  | 'damageDealt'
  | 'Name'
  | 'rarity'
  | 'remainingHp'
  | 'maxHp'
>

export interface PlayerStats {
  displayName: string
  normalizedName: string | null
  totalBattles: number
  tokenBattles: number
  bombBattles: number
  totalDamage: number
  maxDamage: number
}

export interface PlayerStatsWithMetrics extends PlayerStats {
  avgDamagePerBattle: number
  vsGuildPct: number
}

export interface AggregatedGuildPerformance {
  normalizedPerformance: PlayerStats[]
  effectivePerformance: PlayerStats[]
  performanceWithMetrics: PlayerStatsWithMetrics[]
  totalDamageSeason: number
  totalTokenBattlesSeason: number
  maxHitSeason: number
  guildAvgDamagePerBattle: number
}

export const aggregateGuildPerformance = (
  rawData: PlayerPerformanceRow[],
  rosterNames: Set<string>
): AggregatedGuildPerformance => {
  const playerStatsMap = new Map<string, PlayerStats>()

  rawData.forEach((row) => {
    if (!row.displayName) return

    const key = row.displayName
    const existing = playerStatsMap.get(key) || {
      displayName: row.displayName,
      normalizedName: normalizeName(row.displayName),
      totalBattles: 0,
      tokenBattles: 0,
      bombBattles: 0,
      totalDamage: 0,
      maxDamage: 0
    }

    const damage = toNumber(row.damageDealt)
    existing.totalDamage += damage
    existing.maxDamage = Math.max(existing.maxDamage, damage)

    if (row.damageType === 'Battle') {
      existing.totalBattles += 1
      if (damage > 0) {
        existing.tokenBattles += 1
      }
    } else if (row.damageType === 'Bomb') {
      existing.bombBattles += 1
    }

    playerStatsMap.set(key, existing)
  })

  const normalizedPerformance = Array.from(playerStatsMap.values())

  const filteredPerformance =
    rosterNames.size > 0
      ? normalizedPerformance.filter(
          (row) => row.normalizedName && rosterNames.has(row.normalizedName)
        )
      : normalizedPerformance

  const effectivePerformance =
    filteredPerformance.length > 0 ? filteredPerformance : normalizedPerformance

  const totalDamageSeason = effectivePerformance.reduce(
    (sum, row) => sum + row.totalDamage,
    0
  )
  const totalTokenBattlesSeason = effectivePerformance.reduce(
    (sum, row) => sum + row.tokenBattles,
    0
  )
  const maxHitSeason = effectivePerformance.reduce(
    (max, row) => Math.max(max, row.maxDamage),
    0
  )
  const guildAvgDamagePerBattle =
    totalTokenBattlesSeason > 0
      ? totalDamageSeason / totalTokenBattlesSeason
      : 0

  const performanceWithMetrics: PlayerStatsWithMetrics[] =
    effectivePerformance.map((row) => {
      const avgDamagePerBattle =
        row.tokenBattles > 0 ? row.totalDamage / row.tokenBattles : 0
      const vsGuildPct =
        guildAvgDamagePerBattle > 0
          ? (avgDamagePerBattle / guildAvgDamagePerBattle - 1) * 100
          : 0
      return {
        ...row,
        avgDamagePerBattle,
        vsGuildPct
      }
    })

  return {
    normalizedPerformance,
    effectivePerformance,
    performanceWithMetrics,
    totalDamageSeason,
    totalTokenBattlesSeason,
    maxHitSeason,
    guildAvgDamagePerBattle
  }
}

export interface TopBottomPerformers {
  topPerformers: Array<{ name: string; vsGuildPct: number; rank: number }>
  bottomPerformers: Array<{ name: string; vsGuildPct: number; rank: number }>
}

/** Canonical RPC (battle-weighted, Legendary+Mythic, no sweeps); basic vsGuildPct if it fails. */
export const loadTopBottomPerformers = async (
  supabase: SupabaseClient,
  guildCode: string,
  season: string,
  performanceWithMetrics: PlayerStatsWithMetrics[]
): Promise<TopBottomPerformers> => {
  let playerPerformanceResults: Array<{
    displayName: string
    avg_vs_guild: number
    playerId?: string
  }> = []

  try {
    const performanceSummaries = await getPlayerPerformanceSummaryRPC(
      supabase as unknown as TypedSupabaseClient,
      { Guild: guildCode, Season: season }
    )

    playerPerformanceResults = performanceSummaries.map((summary) => ({
      displayName: summary.displayName,
      avg_vs_guild: summary.avg_vs_guild ?? 0,
      playerId: summary.playerId
    }))

    logger.info(
      {
        playersLoaded: playerPerformanceResults.length
      },
      '[landing-page] Loaded player performance from RPC'
    )
  } catch (error) {
    logger.warn(
      { error: error },
      '[landing-page] Failed to load player performance from RPC, falling back to basic calculation'
    )

    const qualifyingPerformance = performanceWithMetrics.filter(
      (row) => row.tokenBattles > 0
    )
    const rankingSource =
      qualifyingPerformance.length > 0
        ? qualifyingPerformance
        : performanceWithMetrics

    playerPerformanceResults = rankingSource.map((row) => ({
      displayName: row.displayName,
      avg_vs_guild: row.vsGuildPct
    }))
  }

  const sortedByPerformance = [...playerPerformanceResults].sort(
    (a, b) => b.avg_vs_guild - a.avg_vs_guild
  )

  const topPerformers =
    sortedByPerformance.length > 0
      ? sortedByPerformance.slice(0, 5).map((row, index) => ({
          name: row.displayName,
          vsGuildPct: Number(row.avg_vs_guild.toFixed(1)),
          rank: index + 1
        }))
      : []

  const bottomPerformers =
    sortedByPerformance.length > 5
      ? sortedByPerformance.slice(-5).map((row, index) => ({
          name: row.displayName,
          vsGuildPct: Number(row.avg_vs_guild.toFixed(1)),
          rank: sortedByPerformance.length - 4 + index
        }))
      : []

  return { topPerformers, bottomPerformers }
}

export interface PlayerRankPositions {
  guildRankPosition: number | null
  clusterRankPosition: number | null
}

export const calculatePlayerRankings = async (
  supabase: SupabaseClient,
  performanceWithMetrics: PlayerStatsWithMetrics[],
  playerEntry: PlayerStatsWithMetrics | undefined,
  clusterCode: string | null | undefined,
  season: string,
  playerId: string | null | undefined
): Promise<PlayerRankPositions> => {
  let guildRankPosition: number | null = null
  let clusterRankPosition: number | null = null

  if (playerEntry && playerEntry.totalDamage > 0) {
    const betterGuildPlayers = performanceWithMetrics.filter(
      (p) => p.totalDamage > playerEntry.totalDamage
    ).length
    guildRankPosition = betterGuildPlayers + 1
  }

  if (clusterCode && playerId) {
    try {
      // Aggregate in PostgreSQL: PostgREST silently caps raw rows at PGRST_DB_MAX_ROWS.
      const { data: rank, error: clusterError } = await supabase.rpc(
        'get_cluster_damage_rank',
        {
          p_cluster_code: clusterCode,
          p_player_id: playerId,
          p_season: season
        }
      )

      if (!clusterError && typeof rank === 'number') {
        clusterRankPosition = rank
      }
    } catch (error) {
      logger.warn({ error }, 'Failed to calculate cluster ranking')
      clusterRankPosition = null
    }
  }

  return { guildRankPosition, clusterRankPosition }
}

export const buildCredentialHealth = (
  profile: PlayerMapping,
  guildConfig: {
    api_key_is_valid?: boolean | null
    discord_webhook_enabled?: boolean | null
  } | null,
  personalStats: LandingPagePersonalStats
): CredentialHealthSummary => {
  // Not tacticus_api_key_encrypted: it is ungranted and must not reach the browser.
  const hasPlayerApiKey = profile.api_key_last_verified != null
  const playerApiKeyStatus: CredentialHealthSummary['playerApiKey'] =
    hasPlayerApiKey ? 'healthy' : 'warning'
  let guildApiKeyStatus: CredentialHealthSummary['guildApiKeys'] = 'warning'
  if (guildConfig?.api_key_is_valid === true) guildApiKeyStatus = 'healthy'
  if (guildConfig?.api_key_is_valid === false) guildApiKeyStatus = 'error'
  const discordStatus: CredentialHealthSummary['discordWebhooks'] =
    guildConfig?.discord_webhook_enabled ? 'healthy' : 'warning'

  let profileCompletion = 20
  if (profile.display_name) profileCompletion += 20
  if (hasPlayerApiKey) profileCompletion += 20
  if (personalStats.avgDamagePerHit !== null) profileCompletion += 20
  if (personalStats.guildRank !== null) profileCompletion += 20

  return {
    playerApiKey: playerApiKeyStatus,
    guildApiKeys: guildApiKeyStatus,
    discordWebhooks: discordStatus,
    profileCompletion
  }
}
