import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import type { Database } from '@tacticus/app-core/database.generated'
import {
  ACHIEVEMENT_CATALOG,
  getAchievementMetricValue,
  isAchievementUnlocked,
  type AchievementStats
} from './catalog'
import {
  findVerifiedDiscordForMapping,
  resolveVerifiedDiscordIdentities
} from '@/app/lib/auth/verified-player-authority'

interface UnlockedAchievement {
  achievement_key: string
  value?: Record<string, unknown>
}

export interface AchievementPlayerContext {
  mappingId?: number | null
  userId?: string | null
  playerId: string
  displayName?: string | null
  guildCode?: string | null
  clusterCode?: string | null
  playerPower?: number | null
  playerLevel?: number | null
  tacticusApiKeyEncrypted?: string | null
  tacticusShareUrl?: string | null
  discordUserId?: string | null
  timezone?: string | null
  primaryBoss?: string | null
  secondaryBoss?: string | null
  primaryTeam?: string | null
  secondaryTeam?: string | null
  tertiaryTeam?: string | null
  isAppAdmin?: boolean | null
}

export interface AchievementEvaluationOptions {
  includeVotlwAwards?: boolean
}

export interface AchievementEvaluation {
  unlocked: UnlockedAchievement[]
  stats: AchievementStats
  player: AchievementPlayerContext | null
}

type BattleRow = Pick<
  Database['public']['Tables']['EOT_GR_data']['Row'],
  | 'id'
  | 'encounterType'
  | 'encounterId'
  | 'encounterIndex'
  | 'damageDealt'
  | 'damageType'
  | 'displayName'
  | 'Guild'
  | 'maxHp'
  | 'remainingHp'
  | 'Season'
  | 'set'
  | 'rarity'
  | 'startedOn'
  | 'completedOn'
>

interface RosterRow {
  rank_name: string | null
  rarity: string | null
  xp_level: number | null
  active_ability_level: number | null
  passive_ability_level: number | null
}

interface VotlwAwardPayload {
  player?: string | null
  value?: number | null
}

interface VotlwSetWinnerRow {
  gold?: VotlwAwardPayload | null
  silver?: VotlwAwardPayload | null
  bronze?: VotlwAwardPayload | null
  mostDamage?: VotlwAwardPayload | null
  sideBoss1?: VotlwAwardPayload | null
  sideBoss2?: VotlwAwardPayload | null
  biggestHit?: VotlwAwardPayload | null
}

const DAYS_14_MS = 14 * 24 * 60 * 60 * 1000

function toNumber(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function dayKey(value: string | null | undefined): string | null {
  if (!value) return null
  const time = Date.parse(value)
  if (!Number.isFinite(time)) return null
  return new Date(time).toISOString().slice(0, 10)
}

function normalizeName(value: string | null | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

async function resolvePlayerContext(
  supabase: TypedSupabaseClient,
  playerId: string,
  context?: Partial<AchievementPlayerContext>
): Promise<AchievementPlayerContext | null> {
  if (context?.playerId) {
    return canonicalizeDiscordContext(supabase, {
      playerId: context.playerId,
      mappingId: context.mappingId ?? null,
      userId: context.userId ?? null,
      displayName: context.displayName ?? null,
      guildCode: context.guildCode ?? null,
      clusterCode: context.clusterCode ?? null,
      playerPower: context.playerPower ?? null,
      playerLevel: context.playerLevel ?? null,
      tacticusApiKeyEncrypted: context.tacticusApiKeyEncrypted ?? null,
      tacticusShareUrl: context.tacticusShareUrl ?? null,
      discordUserId: context.discordUserId ?? null,
      timezone: context.timezone ?? null,
      primaryBoss: context.primaryBoss ?? null,
      secondaryBoss: context.secondaryBoss ?? null,
      primaryTeam: context.primaryTeam ?? null,
      secondaryTeam: context.secondaryTeam ?? null,
      tertiaryTeam: context.tertiaryTeam ?? null,
      isAppAdmin: context.isAppAdmin ?? null
    })
  }

  const { data } = await supabase
    .from('player_mapping')
    .select(
      'id,user_id,player_id,display_name,guild_code,cluster_code,player_power,player_level,tacticus_api_key_encrypted,tacticus_share_url,discord_user_id,timezone,primary_boss,secondary_boss,primary_team,secondary_team,tertiary_team,is_app_admin'
    )
    .eq('player_id', playerId)
    .eq('is_current', true)
    .maybeSingle()

  if (!data?.player_id) return null

  return canonicalizeDiscordContext(supabase, {
    mappingId: data.id ?? null,
    userId: data.user_id ?? null,
    playerId: data.player_id,
    displayName: data.display_name ?? null,
    guildCode: data.guild_code ?? null,
    clusterCode: data.cluster_code ?? null,
    playerPower: data.player_power ?? null,
    playerLevel: data.player_level ?? null,
    tacticusApiKeyEncrypted: data.tacticus_api_key_encrypted ?? null,
    tacticusShareUrl: data.tacticus_share_url ?? null,
    discordUserId: data.discord_user_id ?? null,
    timezone: data.timezone ?? null,
    primaryBoss: data.primary_boss ?? null,
    secondaryBoss: data.secondary_boss ?? null,
    primaryTeam: data.primary_team ?? null,
    secondaryTeam: data.secondary_team ?? null,
    tertiaryTeam: data.tertiary_team ?? null,
    isAppAdmin: data.is_app_admin ?? null
  })
}

async function canonicalizeDiscordContext(
  supabase: TypedSupabaseClient,
  player: AchievementPlayerContext
): Promise<AchievementPlayerContext> {
  if (!player.discordUserId || !player.mappingId || !player.userId) {
    return { ...player, discordUserId: null }
  }
  const verified = await resolveVerifiedDiscordIdentities(supabase, [
    player.discordUserId
  ])
  const match = findVerifiedDiscordForMapping(verified, {
    mappingId: player.mappingId,
    playerId: player.playerId,
    userId: player.userId,
    guildCode: player.guildCode,
    discordUserId: player.discordUserId
  })
  return { ...player, discordUserId: match?.discordUserId ?? null }
}

async function fetchRosterRows(
  supabase: TypedSupabaseClient,
  player: AchievementPlayerContext
): Promise<RosterRow[]> {
  if (player.userId && player.mappingId) {
    const { data } = await supabase
      .from('player_roster')
      .select(
        'rank_name,rarity,xp_level,active_ability_level,passive_ability_level'
      )
      .or(
        `user_id.eq.${player.userId},player_mapping_id.eq.${player.mappingId}`
      )
    return (data ?? []) as RosterRow[]
  }

  if (player.userId) {
    const { data } = await supabase
      .from('player_roster')
      .select(
        'rank_name,rarity,xp_level,active_ability_level,passive_ability_level'
      )
      .eq('user_id', player.userId)
    return (data ?? []) as RosterRow[]
  }

  if (player.mappingId) {
    const { data } = await supabase
      .from('player_roster')
      .select(
        'rank_name,rarity,xp_level,active_ability_level,passive_ability_level'
      )
      .eq('player_mapping_id', player.mappingId)
    return (data ?? []) as RosterRow[]
  }

  return []
}

function calculateRaidStats(rows: BattleRow[]): AchievementStats {
  const seasons = new Set<string>()
  const activeDays = new Set<string>()
  const activeDaysBySeason = new Map<string, Set<string>>()
  const damageBySeason = new Map<string, number>()
  const submissionsBySeason = new Map<string, number>()
  const sweepsBySeason = new Map<string, number>()
  const now = Date.now()

  let submissionCount = 0
  let battleTokenCount = 0
  let bombCount = 0
  let killCount = 0
  let primeKills = 0
  let sideBossKills = 0
  let totalDamage = 0
  let bestHit = 0
  let bestBomb = 0
  let perfectHits = 0
  let nearMisses = 0
  let recentSubmissionCount = 0

  for (const row of rows) {
    submissionCount += 1
    const damage = toNumber(row.damageDealt)
    const season = row.Season ?? null
    const date = dayKey(row.startedOn ?? row.completedOn)

    if (season) {
      seasons.add(season)
      submissionsBySeason.set(
        season,
        (submissionsBySeason.get(season) ?? 0) + 1
      )
      damageBySeason.set(season, (damageBySeason.get(season) ?? 0) + damage)

      if (date) {
        const seasonDays = activeDaysBySeason.get(season) ?? new Set<string>()
        seasonDays.add(date)
        activeDaysBySeason.set(season, seasonDays)
      }
    }

    if (date) activeDays.add(date)

    const startedAt = row.startedOn ? Date.parse(row.startedOn) : NaN
    if (Number.isFinite(startedAt) && now - startedAt <= DAYS_14_MS) {
      recentSubmissionCount += 1
    }

    totalDamage += damage

    if (row.damageType === 'Battle') {
      battleTokenCount += 1
      bestHit = Math.max(bestHit, damage)
    }

    if (row.damageType === 'Bomb') {
      bombCount += 1
      bestBomb = Math.max(bestBomb, damage)
    }

    const isKill = row.remainingHp === 0
    if (isKill) {
      killCount += 1
      if (season) {
        sweepsBySeason.set(season, (sweepsBySeason.get(season) ?? 0) + 1)
      }
      if (row.encounterType === 'prime' || row.encounterType === 'Prime') {
        primeKills += 1
      }
      if ((row.encounterId ?? row.encounterIndex ?? 0) > 0) {
        sideBossKills += 1
      }
    }

    if (row.maxHp && row.maxHp > 0 && row.remainingHp !== null) {
      if (row.remainingHp === 0 && damage >= row.maxHp) perfectHits += 1
      if (row.remainingHp > 0 && row.remainingHp / row.maxHp <= 0.05) {
        nearMisses += 1
      }
    }
  }

  const maxSeasonDamage = Math.max(0, ...damageBySeason.values())
  const maxSeasonSubmissions = Math.max(0, ...submissionsBySeason.values())
  const maxSweepsInSeason = Math.max(0, ...sweepsBySeason.values())
  const maxActiveDaysInSeason = Math.max(
    0,
    ...Array.from(activeDaysBySeason.values()).map((days) => days.size)
  )

  return {
    seasonCount: seasons.size,
    submissionCount,
    battleTokenCount,
    bombCount,
    totalDamage,
    bestHit,
    bestBomb,
    maxSeasonDamage,
    maxSeasonSubmissions,
    killCount,
    primeKills,
    sideBossKills,
    maxSweepsInSeason,
    perfectHits,
    nearMisses,
    activeDaysAllTime: activeDays.size,
    maxActiveDaysInSeason,
    recentSubmissionCount
  }
}

function calculateRosterStats(
  player: AchievementPlayerContext,
  rosterRows: RosterRow[]
): AchievementStats {
  let diamondUnitCount = 0
  let legendaryUnitCount = 0
  let maxAbilityLevel = 0

  for (const row of rosterRows) {
    const rank = (row.rank_name ?? '').toLowerCase()
    const rarity = (row.rarity ?? '').toLowerCase()

    if (rank.includes('diamond')) diamondUnitCount += 1
    if (rarity === 'legendary' || rarity === 'mythic') {
      legendaryUnitCount += 1
    }

    maxAbilityLevel = Math.max(
      maxAbilityLevel,
      toNumber(row.active_ability_level),
      toNumber(row.passive_ability_level)
    )
  }

  const hasApiKey = Boolean(player.tacticusApiKeyEncrypted)
  const hasDiscord = Boolean(player.discordUserId)
  const hasShareUrl = Boolean(player.tacticusShareUrl)
  const hasTimezone = Boolean(player.timezone)
  const hasBossPrefs = Boolean(player.primaryBoss || player.secondaryBoss)
  const hasMetaTeams = Boolean(
    player.primaryTeam || player.secondaryTeam || player.tertiaryTeam
  )
  const isAppAdmin = Boolean(player.isAppAdmin)
  const linkedAccountCount = [
    hasApiKey,
    hasDiscord,
    hasShareUrl,
    hasTimezone,
    hasBossPrefs,
    hasMetaTeams
  ].filter(Boolean).length
  const appBasicsCompleted =
    linkedAccountCount + (rosterRows.length > 0 ? 1 : 0)

  return {
    rosterPower: toNumber(player.playerPower),
    playerLevel: toNumber(player.playerLevel),
    rosterUnitCount: rosterRows.length,
    diamondUnitCount,
    legendaryUnitCount,
    maxAbilityLevel,
    linkedAccountCount,
    appBasicsCompleted,
    hasApiKey,
    hasDiscord,
    hasShareUrl,
    hasTimezone,
    hasBossPrefs,
    hasMetaTeams,
    isAppAdmin
  }
}

function addAward(
  stats: AchievementStats,
  metric: keyof Pick<
    Required<AchievementStats>,
    | 'votlwGoldMedals'
    | 'votlwSilverMedals'
    | 'votlwBronzeMedals'
    | 'votlwMostDamageAwards'
    | 'votlwSideBossWins'
    | 'votlwBiggestHitAwards'
  >,
  amount = 1
) {
  const current = typeof stats[metric] === 'number' ? Number(stats[metric]) : 0
  stats[metric] = current + amount
}

function awardMatches(
  award: VotlwAwardPayload | null | undefined,
  playerName: string
): boolean {
  return normalizeName(award?.player) === playerName
}

async function calculateVotlwStats(
  supabase: TypedSupabaseClient,
  player: AchievementPlayerContext,
  seasons: string[]
): Promise<AchievementStats> {
  const playerName = normalizeName(player.displayName)
  if (!player.guildCode || !playerName || seasons.length === 0) {
    return {}
  }

  const stats: AchievementStats = {
    votlwGoldMedals: 0,
    votlwSilverMedals: 0,
    votlwBronzeMedals: 0,
    votlwMostDamageAwards: 0,
    votlwSideBossWins: 0,
    votlwBiggestHitAwards: 0,
    votlwTopKillerAwards: 0,
    votlwBestBomberAwards: 0,
    votlwPoints: 0
  }

  for (const season of seasons) {
    const { data } = await supabase.rpc('get_votlw_set_winners', {
      p_guild_code: player.guildCode,
      p_season: season,
      p_cluster_code: player.clusterCode ?? undefined
    })

    const rows = Array.isArray(data) ? (data as VotlwSetWinnerRow[]) : []
    for (const row of rows) {
      if (awardMatches(row.gold, playerName)) addAward(stats, 'votlwGoldMedals')
      if (awardMatches(row.silver, playerName)) {
        addAward(stats, 'votlwSilverMedals')
      }
      if (awardMatches(row.bronze, playerName)) {
        addAward(stats, 'votlwBronzeMedals')
      }
      if (awardMatches(row.mostDamage, playerName)) {
        addAward(stats, 'votlwMostDamageAwards')
      }
      if (awardMatches(row.sideBoss1, playerName)) {
        addAward(stats, 'votlwSideBossWins')
      }
      if (awardMatches(row.sideBoss2, playerName)) {
        addAward(stats, 'votlwSideBossWins')
      }
      if (awardMatches(row.biggestHit, playerName)) {
        addAward(stats, 'votlwBiggestHitAwards')
      }
    }
  }

  const { data: winnerRows } = await supabase
    .from('votlw_winners')
    .select('kill_bonus_points,bomb_bonus_points,winner_name')
    .eq('guild_code', player.guildCode)
    .in('season', seasons)

  for (const row of winnerRows ?? []) {
    if (normalizeName(row.winner_name) !== playerName) continue
    if (toNumber(row.kill_bonus_points) > 0) {
      stats.votlwTopKillerAwards =
        getAchievementMetricValue(stats, 'votlwTopKillerAwards') + 1
    }
    if (toNumber(row.bomb_bonus_points) > 0) {
      stats.votlwBestBomberAwards =
        getAchievementMetricValue(stats, 'votlwBestBomberAwards') + 1
    }
  }

  stats.votlwPoints =
    getAchievementMetricValue(stats, 'votlwGoldMedals') * 3 +
    getAchievementMetricValue(stats, 'votlwSilverMedals') * 2 +
    getAchievementMetricValue(stats, 'votlwBronzeMedals') +
    getAchievementMetricValue(stats, 'votlwMostDamageAwards') +
    getAchievementMetricValue(stats, 'votlwSideBossWins') * 2 +
    getAchievementMetricValue(stats, 'votlwBiggestHitAwards') +
    getAchievementMetricValue(stats, 'votlwTopKillerAwards') * 3 +
    getAchievementMetricValue(stats, 'votlwBestBomberAwards') * 0.5

  return stats
}

function unlockedValue(
  stats: AchievementStats,
  achievementKey: string
): Record<string, unknown> {
  const definition = ACHIEVEMENT_CATALOG.find(
    (item) => item.key === achievementKey
  )
  if (!definition) return {}

  const current = getAchievementMetricValue(stats, definition.metric)
  return {
    metric: definition.metric,
    metricLabel: definition.metricLabel,
    current,
    threshold: definition.threshold ?? 1,
    category: definition.category
  }
}

export async function getAchievementEvaluation(
  supabase: TypedSupabaseClient,
  playerId: string,
  context?: Partial<AchievementPlayerContext>,
  options: AchievementEvaluationOptions = {}
): Promise<AchievementEvaluation> {
  const player = await resolvePlayerContext(supabase, playerId, context)
  const resolvedPlayerId = player?.playerId ?? playerId
  const includeVotlwAwards = options.includeVotlwAwards ?? true

  const [raidRes, warsRes, rosterRows] = await Promise.all([
    supabase
      .from('EOT_GR_data')
      .select(
        'id,encounterType,encounterId,encounterIndex,damageDealt,damageType,displayName,Guild,maxHp,remainingHp,Season,set,rarity,startedOn,completedOn'
      )
      .eq('userId', resolvedPlayerId)
      .order('startedOn', { ascending: false }),

    supabase
      .from('guild_war_player_attempts')
      .select('war_id')
      .eq('player_id', resolvedPlayerId),

    player ? fetchRosterRows(supabase, player) : Promise.resolve([])
  ])

  const raidRows: BattleRow[] = raidRes.data ?? []
  const raidStats = calculateRaidStats(raidRows)
  const rosterStats = player ? calculateRosterStats(player, rosterRows) : {}
  const seasons = Array.from(
    new Set(
      raidRows
        .map((row) => row.Season)
        .filter((season): season is string => Boolean(season))
    )
  )

  const votlwStats =
    includeVotlwAwards && player
      ? await calculateVotlwStats(supabase, player, seasons)
      : {}

  const warSet = new Set((warsRes.data ?? []).map((row) => row.war_id))
  const stats: AchievementStats = {
    ...raidStats,
    ...rosterStats,
    ...votlwStats,
    guildWarCount: warSet.size
  }

  const unlocked = ACHIEVEMENT_CATALOG.filter((definition) =>
    isAchievementUnlocked(definition, stats)
  ).map((definition) => ({
    achievement_key: definition.key,
    value: unlockedValue(stats, definition.key)
  }))

  return { unlocked, stats, player }
}

export async function evaluateAchievements(
  supabase: TypedSupabaseClient,
  playerId: string,
  context?: Partial<AchievementPlayerContext>,
  options?: AchievementEvaluationOptions
): Promise<UnlockedAchievement[]> {
  const evaluation = await getAchievementEvaluation(
    supabase,
    playerId,
    context,
    options
  )
  return evaluation.unlocked
}
