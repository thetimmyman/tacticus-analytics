import { guildRosterQuery } from '@/app/lib/data/guild-roster'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

import { db as createSupabaseClient, serviceDb } from '@/app/lib/db'
import {
  getCachedGuildSummary,
  getCachedPlayerSummary
} from '@/app/lib/dashboard/cached-widgets'
import { getTokenUsage } from '@/app/lib/data/token-usage'
import type { PlayerMapping } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.dashboard.home-summary')
import { buildTokenRankings } from './home-summary-utils'
import {
  calculateGuildAvgDamagePerHour,
  loadBossOverviews
} from './boss-metrics'
import { getTokenDataForUser } from './token-metrics'
import {
  aggregateGuildPerformance,
  buildCredentialHealth,
  calculatePlayerRankings,
  loadTopBottomPerformers,
  type PlayerPerformanceRow
} from './guild-summary'
import { normalizeName, toNullableNumber, toNumber } from './_internal/coercion'
import type { PostgrestError } from '@supabase/supabase-js'

/**
 * The fallback client lacks SELECT on public_guild_snapshots, so it reads the explore
 * view, where damage totals are obfuscated to null (both have computed fallbacks).
 */
type HomeGuildSnapshot = {
  guild_name: string | null
  rank: number | null
  war_rank: number | null
  total_damage: number | null
  total_battles: number | null
  active_players: number | null
  member_count: number | null
  avg_damage_per_battle: number | null
}

const SNAPSHOT_COLUMNS_SERVICE =
  'guild_name, rank, war_rank, total_damage, total_battles, active_players, member_count, avg_damage_per_battle'

const SNAPSHOT_COLUMNS_REDACTED =
  'guild_name, rank, war_rank, total_battles, active_players, member_count'

export async function fetchHomeGuildSnapshot(
  supabase: TypedSupabaseClient,
  usingServiceRole: boolean,
  guildCode: string,
  seasonFilter: number
): Promise<{ data: HomeGuildSnapshot | null; error: PostgrestError | null }> {
  if (usingServiceRole) {
    const { data, error } = await supabase
      .from('public_guild_snapshots')
      .select(SNAPSHOT_COLUMNS_SERVICE)
      .eq('guild_code', guildCode)
      .eq('season', seasonFilter)
      .maybeSingle()

    return { data: (data as HomeGuildSnapshot | null) ?? null, error }
  }

  const { data, error } = await supabase
    .from('public_guild_snapshots_explore')
    .select(SNAPSHOT_COLUMNS_REDACTED)
    .eq('guild_code', guildCode)
    .eq('season', seasonFilter)
    .maybeSingle()

  if (!data) return { data: null, error }

  const row = data as Omit<
    HomeGuildSnapshot,
    'total_damage' | 'avg_damage_per_battle'
  >

  return {
    data: {
      ...row,
      total_damage: null,
      avg_damage_per_battle: null
    },
    error
  }
}

import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import type {
  LandingPageData,
  LandingPageGuildStats,
  LandingPageManagementData,
  LandingPagePersonalStats
} from './home-summary-types'

export type { LandingPageData } from './home-summary-types'

export async function getLandingPageData(
  profile: PlayerMapping,
  season: string
): Promise<LandingPageData> {
  type SupabaseClient = TypedSupabaseClient
  let supabase: SupabaseClient
  let usingServiceRole = true

  try {
    supabase = serviceDb()
  } catch (serviceError) {
    usingServiceRole = false
    logger.warn(
      { serviceError: serviceError },
      '[landing-page] Service client unavailable, falling back to user scoped client'
    )
    supabase = await createSupabaseClient()
  }
  const guildCode = profile.guild_code
  if (!guildCode) {
    throw new Error('Guild code is required for landing page data')
  }
  const twentyFourHoursAgoIso = new Date(
    Date.now() - 24 * 60 * 60 * 1000
  ).toISOString()
  const seasonNumber = Number.parseInt(season, 10)
  const seasonFilter: number = Number.isNaN(seasonNumber) ? 0 : seasonNumber

  const candidatePlayerIds = [profile.user_id, profile.player_id].filter(
    (value): value is string => Boolean(value)
  )

  let resolvedPlayerId: string | null = candidatePlayerIds[0] ?? null
  const playerNameFromProfile = profile.username ?? undefined

  const displayNamesToTry = [
    profile.display_name,
    playerNameFromProfile
  ].filter((value): value is string => Boolean(value))

  if (!resolvedPlayerId && displayNamesToTry.length > 0) {
    for (const candidateName of displayNamesToTry) {
      const { data: playerMapping } = await guildRosterQuery(
        supabase,
        guildCode,
        'player_id'
      )
        .eq('display_name', candidateName)
        .maybeSingle()

      if (playerMapping?.player_id) {
        resolvedPlayerId = playerMapping.player_id
        break
      }
    }
  }

  const [
    guildSummary,
    playerSummary,
    guildConfigResponse,
    snapshotResponse,
    performanceResponse,
    membersResponse,
    maxLoopResponse,
    bossKillResponse,
    recentBattlesResponse,
    tokenUsage
  ] = await Promise.all([
    getCachedGuildSummary(guildCode, season).catch(() => null),
    resolvedPlayerId
      ? getCachedPlayerSummary(resolvedPlayerId, season, guildCode).catch(
          () => null
        )
      : Promise.resolve(null),
    supabase
      .from('guild_config')
      .select(
        'guild_code, display_name, guild_tag, api_key_is_valid, discord_webhook_enabled, "GR_Ranking", "GW_Ranking"'
      )
      .eq('guild_code', guildCode)
      .maybeSingle(),
    fetchHomeGuildSnapshot(supabase, usingServiceRole, guildCode, seasonFilter),
    supabase
      .from('EOT_GR_data')
      .select(
        'displayName, damageType, damageDealt, Name, rarity, remainingHp, maxHp'
      )
      .eq('Guild', guildCode)
      .eq('Season', season)
      .order('startedOn', { ascending: false }),
    supabase
      .from('player_with_cluster')
      .select('display_name')
      .eq('guild_code', guildCode)
      .eq('is_current', true),
    supabase
      .from('EOT_GR_data')
      .select('loopIndex')
      .eq('Guild', guildCode)
      .eq('Season', season)
      .eq('damageType', 'Battle')
      .order('loopIndex', { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from('EOT_GR_data')
      .select('*', { count: 'exact', head: true })
      .eq('Guild', guildCode)
      .eq('Season', season)
      .eq('damageType', 'Battle')
      .eq('encounterIndex', 0)
      .eq('remainingHp', 0),
    supabase
      .from('EOT_GR_data')
      .select('displayName')
      .eq('Guild', guildCode)
      .eq('Season', season)
      .eq('damageType', 'Battle')
      .gte('timestamp', twentyFourHoursAgoIso)
      .not('displayName', 'is', null)
      .order('startedOn', { ascending: false }),
    getTokenUsage(guildCode, season).catch(() => [])
  ])

  const supabaseErrors = {
    guildConfig: guildConfigResponse.error,
    snapshot: snapshotResponse.error,
    performance: performanceResponse.error,
    members: membersResponse.error,
    maxLoop: maxLoopResponse.error,
    bossKills: bossKillResponse.error,
    recentBattles: recentBattlesResponse.error
  }

  Object.entries(supabaseErrors).forEach(([key, error]) => {
    if (error) {
      logger.warn(
        {
          query: key,
          code: error.code,
          message: error.message,
          hint: error.hint,
          details: error.details,
          guildCode,
          season,
          seasonFilter
        },
        '[landing-page] Supabase query error'
      )
    }
  })

  if (process.env.NODE_ENV !== 'production') {
    logger.info(
      {
        usingServiceRole,
        hasGuildSummary: Boolean(guildSummary),
        hasPlayerSummary: Boolean(playerSummary),
        hasSnapshot: Boolean(snapshotResponse.data),
        performanceRows: Array.isArray(performanceResponse.data)
          ? performanceResponse.data.length
          : null,
        tokenUsageCount: Array.isArray(tokenUsage) ? tokenUsage.length : null,
        guildCode,
        season,
        seasonFilter,
        resolvedPlayerId,
        guildSummaryData: guildSummary
          ? {
              currentRank: guildSummary.currentRank,
              totalDamage: guildSummary.totalDamage,
              activeMembers: guildSummary.activeMembers
            }
          : null,
        snapshotData: snapshotResponse.data
          ? {
              guild_name: snapshotResponse.data.guild_name,
              rank: snapshotResponse.data.rank,
              total_damage: snapshotResponse.data.total_damage,
              active_players: snapshotResponse.data.active_players
            }
          : null
      },
      '[landing-page] data fetch summary'
    )
  }

  const guildConfig = guildConfigResponse.data ?? null
  const playerSummaryData = playerSummary ?? null
  const guildSnapshot = snapshotResponse.data ?? null
  const rosterNames = new Set(
    (
      (membersResponse.data as unknown as Array<{
        display_name: string | null
      }> | null) ?? []
    )
      .map((member) => normalizeName(member?.display_name))
      .filter((name): name is string => Boolean(name))
  )

  const rawData =
    (performanceResponse.data as unknown as PlayerPerformanceRow[] | null) ?? []
  const {
    normalizedPerformance,
    performanceWithMetrics,
    totalDamageSeason,
    totalTokenBattlesSeason,
    maxHitSeason
  } = aggregateGuildPerformance(rawData, rosterNames)

  const { topPerformers, bottomPerformers } = await loadTopBottomPerformers(
    supabase,
    guildCode,
    season,
    performanceWithMetrics
  )

  const recentBattles =
    (recentBattlesResponse.data as unknown as Array<{
      displayName: string | null
    }> | null) ?? []
  const recentBattlePlayers = new Set<string>(
    recentBattles
      .map((record) => normalizeName(record.displayName))
      .filter((name): name is string => Boolean(name))
  )
  const recentBattlesCount = recentBattles.length

  const tokenRankings = buildTokenRankings(tokenUsage)

  if (process.env.NODE_ENV === 'development') {
    logger.info(
      {
        guildCode,
        season,
        guildSummary: guildSummary
          ? {
              totalDamage: guildSummary.totalDamage,
              totalBattles: guildSummary.totalBattles,
              activeMembers: guildSummary.activeMembers,
              currentRank: guildSummary.currentRank
            }
          : null,
        snapshot: guildSnapshot
          ? {
              rank: guildSnapshot.rank,
              warRank: guildSnapshot.war_rank,
              totalDamage: guildSnapshot.total_damage,
              totalBattles: guildSnapshot.total_battles,
              activePlayers: guildSnapshot.active_players
            }
          : null,
        performanceCount: normalizedPerformance.length,
        rosterCount: rosterNames.size,
        tokenUsageCount: tokenUsage.length,
        maxLoop: maxLoopResponse.data?.loopIndex ?? null,
        bossKillCount:
          typeof bossKillResponse.count === 'number'
            ? bossKillResponse.count
            : null,
        recentBattlesCount,
        recentBattleNames: Array.from(recentBattlePlayers).slice(0, 5)
      },
      'Home summary assembled'
    )
  }

  const {
    current: bossOverview,
    prime1: prime1Overview,
    prime2: prime2Overview
  } = await loadBossOverviews(supabase, guildCode, season)

  const latestLoopIndex = toNumber(maxLoopResponse.data?.loopIndex)
  const completedLoops =
    latestLoopIndex > 0 ? Math.max(0, latestLoopIndex - 1) : 0

  const fallbackPlayerName = profile.username ?? undefined

  const playerNormalizedName = normalizeName(
    profile.display_name ?? fallbackPlayerName
  )
  const playerPerformanceEntry = performanceWithMetrics.find(
    (row) => row.normalizedName && row.normalizedName === playerNormalizedName
  )
  const tokenUsageEntry = tokenUsage.find(
    (entry) => normalizeName(entry.display_name) === playerNormalizedName
  )

  const { guildRankPosition, clusterRankPosition } =
    await calculatePlayerRankings(
      supabase,
      performanceWithMetrics,
      playerPerformanceEntry,
      profile.cluster_code,
      season,
      profile.player_id
    )

  const avgDamagePerHitSource =
    playerPerformanceEntry?.avgDamagePerBattle ?? null
  const personalStats: LandingPagePersonalStats = {
    guildRank: guildRankPosition ?? playerSummaryData?.guildRank ?? null,
    clusterRank: clusterRankPosition ?? playerSummaryData?.clusterRank ?? null,
    avgDamagePerHit:
      avgDamagePerHitSource !== null
        ? Math.round(avgDamagePerHitSource)
        : playerSummaryData?.avgDamage
          ? Math.round(playerSummaryData.avgDamage)
          : null,
    maxHit: playerPerformanceEntry?.maxDamage
      ? Math.round(playerPerformanceEntry.maxDamage)
      : playerSummaryData?.bestDamage
        ? Math.round(playerSummaryData.bestDamage)
        : null,
    tokensUsed:
      playerPerformanceEntry?.tokenBattles ??
      tokenUsageEntry?.tokens_used ??
      playerSummaryData?.totalBattles ??
      null,
    totalTokens: tokenUsageEntry?.max_possible ?? 30,
    vsGuildPct: playerSummaryData?.avg_vs_guild ?? null,
    vsClusterPct: playerSummaryData?.avg_vs_cluster ?? null
  }

  const snapshotRank = toNullableNumber(guildSnapshot?.rank)
  const snapshotWarRank = toNullableNumber(guildSnapshot?.war_rank)
  const snapshotTotalDamage = toNullableNumber(guildSnapshot?.total_damage)
  const snapshotActivePlayers = toNullableNumber(guildSnapshot?.active_players)
  const snapshotMemberCount = toNullableNumber(guildSnapshot?.member_count)
  const snapshotAvgDamage = toNullableNumber(
    guildSnapshot?.avg_damage_per_battle
  )

  const guildConfigRank = toNullableNumber(guildConfig?.GR_Ranking)
  const guildConfigWarRank = toNullableNumber(guildConfig?.GW_Ranking)

  const resolvedTotalDamage =
    guildSummary?.totalDamage ?? snapshotTotalDamage ?? totalDamageSeason

  const resolvedActivePlayers =
    guildSummary?.activeMembers ??
    snapshotActivePlayers ??
    snapshotMemberCount ??
    (recentBattlePlayers.size > 0 ? recentBattlePlayers.size : null) ??
    rosterNames.size

  const resolvedAvgDamage =
    snapshotAvgDamage ??
    guildSummary?.avgDamage ??
    (totalTokenBattlesSeason > 0
      ? totalDamageSeason / totalTokenBattlesSeason
      : 0)

  const resolvedMaxHit = maxHitSeason

  const resolvedBossKills =
    typeof bossKillResponse.count === 'number' ? bossKillResponse.count : 0

  const avgDamagePerHour = await calculateGuildAvgDamagePerHour(
    supabase,
    guildCode,
    season
  )

  const guildStats: LandingPageGuildStats = {
    currentRank:
      guildSummary?.currentRank ?? snapshotRank ?? guildConfigRank ?? null,
    currentWarRank: snapshotWarRank ?? guildConfigWarRank ?? null,
    recentActivity: recentBattlesCount,
    totalDamage: resolvedTotalDamage,
    activePlayers: resolvedActivePlayers,
    completedLoops,
    avgDamagePerHit: Math.round(resolvedAvgDamage || 0),
    maxHit: Math.round(resolvedMaxHit || 0),
    bossKills: resolvedBossKills,
    avgDamagePerHour
  }

  const managementData: LandingPageManagementData = {
    topPerformers,
    bottomPerformers,
    topTokenUsers: tokenRankings.topTokenUsers,
    bottomTokenUsers: tokenRankings.bottomTokenUsers
  }

  const credentialHealth = buildCredentialHealth(
    profile,
    guildConfig,
    personalStats
  )

  const tokenData = profile.user_id
    ? await getTokenDataForUser(supabase, profile.user_id)
    : undefined

  return {
    guildName: formatGuildDisplayLabel(
      {
        display_name: guildConfig?.display_name ?? guildSnapshot?.guild_name,
        guild_tag: guildConfig?.guild_tag,
        guild_code: guildCode
      },
      guildCode
    ),
    guildStats,
    personalStats,
    currentBoss: bossOverview,
    primeBosses: {
      prime1: prime1Overview,
      prime2: prime2Overview
    },
    managementData,
    credentialHealth,
    tokenData
  }
}
