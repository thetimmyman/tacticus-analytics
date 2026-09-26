import type { Database } from '@tacticus/app-core/types'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

export type LeaderBattleRow = Pick<
  Database['public']['Tables']['EOT_GR_data']['Row'],
  | 'displayName'
  | 'userId'
  | 'damageDealt'
  | 'damageType'
  | 'tier'
  | 'set'
  | 'timestamp'
  | 'Name'
  | 'Season'
  | 'Guild'
  | 'rarity'
  | 'loopIndex'
  | 'remainingHp'
  | 'completedOn'
>

// Reads go through SECURITY INVOKER RPCs, so RLS still gates rows.
export type LeaderGuildConfigRow = NonNullable<
  Database['public']['Functions']['get_leader_analytics_guilds']['Returns']
>[number]

export type LeaderPlayerMappingRow = NonNullable<
  Database['public']['Functions']['get_leader_analytics_player_mappings']['Returns']
>[number]

// The api_key_coverage view is revoked from `authenticated`; read via the cluster RPC.
export type LeaderApiCoverageRow = NonNullable<
  Database['public']['Functions']['get_cluster_api_key_coverage']['Returns']
>[number]

export interface GuildMetrics {
  guild: string
  totalDamage: number
  avgDamagePerPlayer: number
  avgDamagePerBattle: number
  totalBattles: number
  totalPlayers: number
  overkillDamage: number
  overkillPercentage: number
  tokensPerBoss: Record<string, number>
  tokensPerLoop: Record<number, number>
  bombCount: number
  killEfficiency: number
  activePlayers: number
  claimedProfiles: number
  veteranPlayers: number
  avgTokensPerPlayer: number
  avgDamagePerBoss: Record<string, number>
  finalLoop: number
  tokenOffenderThreshold?: number
  tokenAbuserThreshold?: number
  totalRosterPlayers: number
  apiKeyStatus: 'connected' | 'partial' | 'disconnected'
  guildApiStatus?: 'configured' | 'not_configured'
  dataFreshness: 'current' | 'stale' | 'unknown'
  lastDataUpdate?: string
  playersWithApiKey?: number
}

export const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0

const toNumber = (value: number | null | undefined): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

function emptyGuildMetrics(guild: string): GuildMetrics {
  return {
    guild,
    totalDamage: 0,
    avgDamagePerPlayer: 0,
    avgDamagePerBattle: 0,
    totalBattles: 0,
    totalPlayers: 0,
    overkillDamage: 0,
    overkillPercentage: 0,
    tokensPerBoss: {},
    tokensPerLoop: {},
    bombCount: 0,
    killEfficiency: 0,
    activePlayers: 0,
    claimedProfiles: 0,
    veteranPlayers: 0,
    avgTokensPerPlayer: 0,
    avgDamagePerBoss: {},
    finalLoop: 0,
    totalRosterPlayers: 0,
    apiKeyStatus: 'disconnected',
    dataFreshness: 'unknown'
  }
}

export interface LeaderAnalyticsModel {
  metrics: GuildMetrics[]
  guildLabels: Record<string, string>
  availableBosses: string[]
}

export function buildLeaderAnalyticsModel({
  battles,
  guildConfigs,
  playerMappings,
  apiCoverage,
  veteranCountByGuild,
  now = Date.now()
}: {
  battles: LeaderBattleRow[]
  guildConfigs: LeaderGuildConfigRow[]
  playerMappings: LeaderPlayerMappingRow[]
  apiCoverage: LeaderApiCoverageRow[]
  veteranCountByGuild: ReadonlyMap<string, number>
  now?: number
}): LeaderAnalyticsModel {
  const guildMap = new Map<string, GuildMetrics>()
  const playersByGuild = new Map<string, Set<string>>()
  const tokensByGuildPlayer = new Map<string, number>()
  const bossHits = new Map<string, number>()
  const latestBattleByGuild = new Map<string, string>()
  const bosses = new Set<string>()

  for (const row of battles) {
    const guild = row.Guild
    const metrics = guildMap.get(guild) ?? emptyGuildMetrics(guild)
    const damage = toNumber(row.damageDealt)
    metrics.totalDamage += damage
    if (row.Name) bosses.add(row.Name)

    const displayName = isNonEmptyString(row.displayName)
      ? row.displayName
      : 'Unknown'
    const players = playersByGuild.get(guild) ?? new Set<string>()
    players.add(displayName)
    playersByGuild.set(guild, players)
    const playerKey = isNonEmptyString(row.userId)
      ? row.userId
      : `${guild}_${displayName}`

    if (row.damageType === 'Battle') {
      metrics.totalBattles++
      tokensByGuildPlayer.set(
        `${guild}__${playerKey}`,
        (tokensByGuildPlayer.get(`${guild}__${playerKey}`) ?? 0) + 1
      )
      if (row.Name) {
        const bossKey = `${row.Name}_${toNumber(row.tier)}_${toNumber(row.set)}`
        metrics.tokensPerBoss[bossKey] =
          (metrics.tokensPerBoss[bossKey] ?? 0) + 1
        metrics.avgDamagePerBoss[row.Name] =
          (metrics.avgDamagePerBoss[row.Name] ?? 0) + damage
        // Count only rows with numeric damageDealt; nulls would deflate the average.
        if (typeof row.damageDealt === 'number') {
          const hitKey = `${guild}__${row.Name}`
          bossHits.set(hitKey, (bossHits.get(hitKey) ?? 0) + 1)
        }
      }
      const loop = toNumber(row.loopIndex) || 1
      metrics.tokensPerLoop[loop] = (metrics.tokensPerLoop[loop] ?? 0) + 1
    }
    if (row.damageType === 'Bomb') metrics.bombCount++
    if (row.remainingHp === 0) metrics.killEfficiency++
    if (row.completedOn) {
      const prior = latestBattleByGuild.get(guild)
      if (!prior || Date.parse(row.completedOn) > Date.parse(prior)) {
        latestBattleByGuild.set(guild, row.completedOn)
      }
    }
    guildMap.set(guild, metrics)
  }

  const configByGuild = new Map(
    guildConfigs.map((config) => [config.guild_code, config])
  )
  const coverageByGuild = new Map(
    apiCoverage.map((coverage) => [coverage.guild_code, coverage])
  )
  const claimedByGuild = new Map<string, number>()
  for (const mapping of playerMappings) {
    if (mapping.guild_code && mapping.user_id) {
      claimedByGuild.set(
        mapping.guild_code,
        (claimedByGuild.get(mapping.guild_code) ?? 0) + 1
      )
    }
  }

  const metrics = Array.from(guildMap.values()).map((guild) => {
    const players = playersByGuild.get(guild.guild)?.size || 1
    guild.totalPlayers = players
    guild.activePlayers = players
    guild.avgDamagePerPlayer = Math.round(guild.totalDamage / players)
    guild.avgDamagePerBattle = guild.totalBattles
      ? Math.round(guild.totalDamage / guild.totalBattles)
      : 0
    guild.overkillPercentage = guild.totalDamage
      ? (guild.overkillDamage / guild.totalDamage) * 100
      : 0

    const tokenCounts = Array.from(tokensByGuildPlayer.entries())
      .filter(([key]) => key.startsWith(`${guild.guild}__`))
      .map(([, count]) => count)
    guild.avgTokensPerPlayer = tokenCounts.length
      ? tokenCounts.reduce((sum, count) => sum + count, 0) / tokenCounts.length
      : 0
    const loops = Object.keys(guild.tokensPerLoop).map(Number)
    guild.finalLoop = loops.length ? Math.max(...loops) : 0
    for (const boss of Object.keys(guild.avgDamagePerBoss)) {
      const hits = bossHits.get(`${guild.guild}__${boss}`) ?? 0
      if (hits)
        guild.avgDamagePerBoss[boss] = Math.round(
          guild.avgDamagePerBoss[boss]! / hits
        )
    }
    guild.killEfficiency = guild.totalBattles
      ? (guild.killEfficiency / guild.totalBattles) * 100
      : 0

    const config = configByGuild.get(guild.guild)
    if (typeof config?.token_offender_threshold === 'number') {
      guild.tokenOffenderThreshold = config.token_offender_threshold
    }
    if (typeof config?.token_abuser_threshold === 'number') {
      guild.tokenAbuserThreshold = config.token_abuser_threshold
    }

    const coverage = coverageByGuild.get(guild.guild)
    if (coverage) {
      guild.totalRosterPlayers = toNumber(coverage.total_players)
      guild.activePlayers = toNumber(coverage.active_players)
      guild.playersWithApiKey = toNumber(coverage.players_with_api_key)
      const percent = toNumber(coverage.coverage_percentage)
      guild.apiKeyStatus =
        percent >= 80 ? 'connected' : percent > 0 ? 'partial' : 'disconnected'
      guild.guildApiStatus =
        coverage.guild_api_status === 'configured'
          ? 'configured'
          : 'not_configured'
      const latest = latestBattleByGuild.get(guild.guild)
      if (latest) {
        guild.dataFreshness =
          (now - Date.parse(latest)) / (1000 * 60 * 60) < 2
            ? 'current'
            : 'stale'
        guild.lastDataUpdate = latest
      }
    }
    guild.claimedProfiles = claimedByGuild.get(guild.guild) ?? 0
    // Real counts from get_veteran_counts_by_guild; 0 when history is too short.
    guild.veteranPlayers = veteranCountByGuild.get(guild.guild) ?? 0
    return guild
  })
  metrics.sort((a, b) => b.totalDamage - a.totalDamage)

  const guildLabels: Record<string, string> = {}
  for (const config of guildConfigs) {
    if (config.guild_code) {
      guildLabels[config.guild_code] = formatGuildDisplayLabel(
        config,
        config.guild_code
      )
    }
  }
  for (const guild of metrics) {
    if (!(guild.guild in guildLabels)) {
      guildLabels[guild.guild] = formatGuildDisplayLabel(null, guild.guild)
    }
  }

  return {
    metrics,
    guildLabels,
    availableBosses: Array.from(bosses).sort()
  }
}
