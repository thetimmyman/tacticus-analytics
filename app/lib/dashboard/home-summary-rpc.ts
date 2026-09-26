import { getTokenUsage } from '@/app/lib/data/token-usage'
import { getTokenUsageOverlay } from '@/app/lib/data/token-usage-overlay'
import { getPlayerPerformanceSummaryRPC } from '@/app/lib/calculations/experimental/player-performance-summary'
import { db, serviceDb } from '@/app/lib/db'
import { recordCalculationMetric } from '@/app/lib/calculations/metrics'
import { getCurrentBossStatus } from '@/app/lib/data/boss-status'
import { getGuildSeasonSummary } from '@/app/lib/data/guild-season-summary'
import { getCachedPlayerSummary } from '@/app/lib/dashboard/cached-widgets'
import { buildTopBottomPerformers } from '@/app/lib/dashboard/performer-lists'
import { ensureRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import { getAllBossHp } from '@/app/lib/data/boss-hp'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import type {
  PlayerMapping,
  TypedSupabaseClient
} from '@tacticus/app-core/types'
import {
  formatHp,
  buildTokenRankings,
  inferMainBossDeath,
  advanceBossToNextStage,
  resolveCurrentStagePrimeOverview,
  isOrphanPrime
} from './home-summary-utils'
import { getSkippedPrimeEncounters } from './skipped-primes'
import { getLatestSeason } from '@/app/lib/data/get-latest-season'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import type {
  LandingPageData,
  LandingPageBossOverview,
  CredentialHealthSummary
} from './home-summary-types'

export type { LandingPageData } from './home-summary-types'

const recordStepDuration = (
  id: string,
  startedAt: number,
  success: boolean,
  errorName?: string
) => {
  recordCalculationMetric({
    id,
    durationMs: Date.now() - startedAt,
    success,
    source: 'rpc',
    errorName
  })
}

const measure = async <T>(id: string, fn: () => Promise<T>): Promise<T> => {
  const startedAt = Date.now()
  try {
    const result = await fn()
    recordStepDuration(id, startedAt, true)
    return result
  } catch (error) {
    recordStepDuration(
      id,
      startedAt,
      false,
      error instanceof Error ? error.name : 'unknown'
    )
    throw error
  }
}

export async function getLandingPageRpcData(
  profile: PlayerMapping,
  season: string
): Promise<LandingPageData> {
  if (!profile.guild_code) {
    throw new Error('Guild code required for landing page data')
  }

  const requestStart = Date.now()
  const supabase = (await db()) as TypedSupabaseClient

  // Caller-bound RPC: an empty result is an authorization boundary; never rehydrate via serviceDb.
  const tokenUsage = await measure('home-rpc.getTokenUsage', () =>
    getTokenUsage(profile.guild_code!, season, supabase)
  )
  if (tokenUsage.length === 0) {
    const denial = new Error('Home token usage authorization denied')
    denial.name = 'HomeRpcAuthorizationDenied'
    throw denial
  }
  const tokenRankings = buildTokenRankings(tokenUsage)

  const playerPerformanceSummaries = await measure(
    'home-rpc.getPlayerPerformanceSummary',
    () =>
      getPlayerPerformanceSummaryRPC(supabase, {
        Guild: profile.guild_code!,
        Season: season
      })
  )
  const playerVsGuild: Array<{
    name: string
    vsGuildPct: number
    playerId?: string
  }> = playerPerformanceSummaries.map((summary) => ({
    name: summary.displayName,
    vsGuildPct: Math.round((summary.avg_vs_guild ?? 0) * 100) / 100,
    playerId: summary.playerId
  }))
  const sortedByVsGuild = playerVsGuild.sort(
    (a, b) => (b.vsGuildPct || 0) - (a.vsGuildPct || 0)
  )
  const { topPerformers, bottomPerformers } =
    buildTopBottomPerformers(sortedByVsGuild)

  const guildSummary = await measure('home-rpc.getGuildSeasonSummary', () =>
    getGuildSeasonSummary(profile.guild_code!, season)
  )

  const serviceSupabase = serviceDb() as TypedSupabaseClient
  const { data: guildConfig } = await measure(
    'home-rpc.getGuildConfig',
    async () =>
      serviceSupabase
        .from('guild_config')
        .select('GR_Ranking, GW_Ranking, display_name, guild_tag')
        .eq('guild_code', profile.guild_code!)
        .maybeSingle()
  )

  const guildStats: LandingPageData['guildStats'] = {
    currentRank: guildConfig?.GR_Ranking ?? null,
    currentWarRank: guildConfig?.GW_Ranking ?? null,
    recentActivity: guildSummary.recent_activity,
    totalDamage: guildSummary.total_damage,
    activePlayers: tokenUsage.length,
    completedLoops: 0,
    avgDamagePerHit:
      guildSummary.total_battles > 0
        ? Math.round(guildSummary.total_damage / guildSummary.total_battles)
        : 0,
    maxHit: Math.round(guildSummary.max_hit || 0),
    bossKills: guildSummary.boss_kills,
    avgDamagePerHour: guildSummary.avg_damage_per_hour ?? null
  }

  // Mapping id differs from the auth user_id for claimed players; the name fallback keeps their data.
  const personalEntry = tokenUsage.find(
    (t) =>
      t.player_id === profile.user_id ||
      (!!profile.display_name && t.display_name === profile.display_name)
  )
  const playerDisplayName = profile.display_name || personalEntry?.display_name
  const maxTokensInGuild =
    tokenUsage.length > 0
      ? Math.max(...tokenUsage.map((t) => t.max_possible || 0))
      : 30

  let playerSummary: Awaited<ReturnType<typeof getCachedPlayerSummary>> | null =
    null
  try {
    if (profile.user_id) {
      playerSummary = await measure('home-rpc.getCachedPlayerSummary', () =>
        getCachedPlayerSummary(profile.user_id!, season, profile.guild_code!)
      )
    }
  } catch {
    recordCalculationMetric({
      id: 'home-rpc.getCachedPlayerSummary',
      durationMs: 0,
      success: false,
      source: 'rpc',
      errorName: 'failed'
    })
  }

  const playerPerformanceSummary = playerPerformanceSummaries.find(
    (s) => s.playerId === profile.user_id || s.displayName === playerDisplayName
  )
  const playerAvgVsGuild = playerPerformanceSummary?.avg_vs_guild ?? null
  const playerVsClusterFromPerf =
    playerPerformanceSummary?.avg_vs_cluster ?? null

  const guildRankFromPerformance =
    profile.user_id || playerDisplayName
      ? sortedByVsGuild.findIndex(
          (p) => p.playerId === profile.user_id || p.name === playerDisplayName
        ) + 1 || null
      : null

  let clusterRank: number | null = null
  let vsClusterPct: number | null = null
  if (profile.cluster_code && (profile.user_id || playerDisplayName)) {
    try {
      const { data: clusterGuilds } = await serviceSupabase
        .from('guild_config')
        .select('guild_code')
        .eq('cluster_code', profile.cluster_code)

      if (clusterGuilds && clusterGuilds.length > 1) {
        const clusterPerformancePromises = clusterGuilds
          .filter((g) => g.guild_code !== profile.guild_code)
          .map((g) =>
            getPlayerPerformanceSummaryRPC(supabase, {
              Guild: g.guild_code,
              Season: season
            }).catch(() => [])
          )

        const clusterPerformances = await Promise.all(
          clusterPerformancePromises
        )

        const allClusterPlayers: Array<{
          name: string
          vsGuildPct: number
          playerId?: string
        }> = [...sortedByVsGuild]
        for (const summaries of clusterPerformances) {
          for (const summary of summaries) {
            allClusterPlayers.push({
              name: summary.displayName,
              vsGuildPct: Math.round((summary.avg_vs_guild ?? 0) * 100) / 100,
              playerId: summary.playerId
            })
          }
        }

        const sortedCluster = allClusterPlayers.sort(
          (a, b) => (b.vsGuildPct || 0) - (a.vsGuildPct || 0)
        )
        clusterRank =
          sortedCluster.findIndex(
            (p) =>
              p.playerId === profile.user_id || p.name === playerDisplayName
          ) + 1 || null

        if (playerAvgVsGuild !== null && sortedCluster.length > 0) {
          const clusterAvg =
            sortedCluster.reduce((sum, p) => sum + p.vsGuildPct, 0) /
            sortedCluster.length
          vsClusterPct =
            clusterAvg !== 0
              ? Math.round((playerAvgVsGuild / clusterAvg - 1) * 100 * 100) /
                100
              : null
        }
      }
    } catch {
      recordCalculationMetric({
        id: 'home-rpc.clusterRanking',
        durationMs: 0,
        success: false,
        source: 'rpc',
        errorName: 'failed'
      })
    }
  }

  const personalStats: LandingPageData['personalStats'] = {
    guildRank: guildRankFromPerformance ?? playerSummary?.guildRank ?? null,
    clusterRank: clusterRank ?? playerSummary?.clusterRank ?? null,
    avgDamagePerHit: playerSummary?.avgDamage
      ? Math.round(playerSummary.avgDamage)
      : null,
    maxHit: playerSummary?.bestDamage
      ? Math.round(playerSummary.bestDamage)
      : null,
    tokensUsed:
      personalEntry?.tokens_used ?? playerSummary?.totalBattles ?? null,
    totalTokens: maxTokensInGuild,
    vsGuildPct:
      playerAvgVsGuild !== null
        ? Math.round(playerAvgVsGuild * 100) / 100
        : (playerSummary?.avg_vs_guild ?? null),
    vsClusterPct:
      playerVsClusterFromPerf !== null
        ? Math.round(playerVsClusterFromPerf * 100) / 100
        : (vsClusterPct ?? playerSummary?.avg_vs_cluster ?? null)
  }

  // Never read tacticus_api_key_encrypted (ungranted). api_key_last_verified is the only
  // faithful proxy: api_key_added_at is sparse and api_key_is_valid is TRUE for keyless rows.
  const hasPlayerApiKey = profile.api_key_last_verified != null
  const credentialHealth: CredentialHealthSummary = {
    playerApiKey: hasPlayerApiKey ? 'healthy' : 'warning',
    guildApiKeys: 'warning',
    discordWebhooks: 'warning',
    profileCompletion:
      20 + (profile.display_name ? 20 : 0) + (hasPlayerApiKey ? 20 : 0)
  }

  const overlay = await measure('home-rpc.getTokenUsageOverlay', () =>
    getTokenUsageOverlay(profile.guild_code!, season)
  )
  const personalOverlay = overlay.find(
    (row) => row.display_name === personalEntry?.display_name
  )
  const tokenData: LandingPageData['tokenData'] =
    personalEntry && personalOverlay
      ? {
          guildRaid: {
            current: personalOverlay.tokens_available ?? 0,
            max: 3,
            nextInSeconds: personalOverlay.token_next_in_seconds ?? null
          },
          bombs: {
            current: personalOverlay.bombs_available_live ?? 0,
            max: 1,
            nextInSeconds: personalOverlay.bomb_next_in_seconds ?? null
          }
        }
      : undefined

  const bossStatusRows = await measure('home-rpc.getCurrentBossStatus', () =>
    getCurrentBossStatus(profile.guild_code!, season)
  )
  const mapBoss = (
    row: (typeof bossStatusRows)[number] | undefined,
    fallbackEncounter: number
  ): LandingPageBossOverview => {
    const maxHp = Number(row?.max_hp ?? 0)
    const remainingRaw = row?.remaining_hp
    const remaining =
      remainingRaw === null || remainingRaw === undefined
        ? maxHp > 0
          ? 0
          : 0
        : Number(remainingRaw ?? 0)
    const rarity = (row?.rarity === 'Mythic' ? 'Mythic' : 'Legendary') as
      'Legendary' | 'Mythic'
    const setVal = Number.isFinite(row?.set as number)
      ? (row?.set as number)
      : 0
    const levelCode = deriveStageCodeFromSetAndRarity(setVal, rarity)
    const hpPct =
      maxHp > 0
        ? Math.max(0, Math.min(100, Math.round((remaining / maxHp) * 100)))
        : 0
    const loopIndex =
      typeof row?.loop_index === 'number' && Number.isFinite(row.loop_index)
        ? Math.max(0, Math.trunc(row.loop_index))
        : 0

    return {
      name: row?.boss_name ?? 'Boss',
      displayName: `${levelCode} ${row?.boss_name ?? 'Boss'}`.trim(),
      rarity,
      levelCode,
      loop: loopIndex + 1,
      maxHp,
      remainingHp: remaining,
      hpPercentage: hpPct,
      formattedMaxHp: formatHp(maxHp),
      formattedRemainingHp: formatHp(remaining),
      encounterId: Number.isFinite(row?.encounter_id as number)
        ? (row?.encounter_id as number)
        : fallbackEncounter
    }
  }

  const mainRow = bossStatusRows.find((r) => (r.encounter_id ?? 0) === 0)
  const prime1Row = bossStatusRows.find((r) => (r.encounter_id ?? 0) === 1)
  const prime2Row = bossStatusRows.find((r) => (r.encounter_id ?? 0) === 2)
  let currentBoss = mapBoss(mainRow, 0)
  let prime1: LandingPageBossOverview | null = prime1Row
    ? mapBoss(prime1Row, 1)
    : null
  let prime2: LandingPageBossOverview | null = prime2Row
    ? mapBoss(prime2Row, 2)
    : null

  // The API sometimes omits the kill hit: newer prime attacks imply the main died.
  currentBoss = inferMainBossDeath(currentBoss, {
    mainTs: mainRow?.completed_on
      ? new Date(mainRow.completed_on).getTime()
      : 0,
    prime1Ts: prime1Row?.completed_on
      ? new Date(prime1Row.completed_on).getTime()
      : 0,
    prime2Ts: prime2Row?.completed_on
      ? new Date(prime2Row.completed_on).getTime()
      : 0
  })

  const mainAliveAtCurrentStage =
    currentBoss.maxHp > 0 && currentBoss.remainingHp > 0
  const aPrimeSlotEmpty = prime1 === null || prime2 === null
  // Current-season only; on a past season it would show a confidently-wrong prime.
  let isCurrentSeason = false
  if (aPrimeSlotEmpty && mainAliveAtCurrentStage) {
    try {
      isCurrentSeason = season === (await getLatestSeason())
    } catch {
      isCurrentSeason = false
    }
  }
  const wantsPrimeFill =
    aPrimeSlotEmpty && mainAliveAtCurrentStage && isCurrentSeason

  // Captured before main advancement: primes gate on the stage's main dying, not its replacement.
  const mainWasDefeated = currentBoss.maxHp > 0 && currentBoss.remainingHp <= 0

  const anyBossDefeated =
    (currentBoss.maxHp > 0 && currentBoss.remainingHp <= 0) ||
    (prime1 !== null && prime1.maxHp > 0 && prime1.remainingHp <= 0) ||
    (prime2 !== null && prime2.maxHp > 0 && prime2.remainingHp <= 0)
  const needsProgressionConfig =
    (Boolean(mainRow) && mainWasDefeated) ||
    (Boolean(prime1Row) &&
      prime1 !== null &&
      prime1.maxHp > 0 &&
      prime1.remainingHp <= 0 &&
      mainWasDefeated) ||
    (Boolean(prime2Row) &&
      prime2 !== null &&
      prime2.maxHp > 0 &&
      prime2.remainingHp <= 0 &&
      mainWasDefeated)
  const [sharedRotationSnapshot, sharedBossHpData, progressionConfig] =
    anyBossDefeated || wantsPrimeFill
      ? await Promise.all([
          measure('home-rpc.ensureRotationSnapshot', () =>
            ensureRotationSnapshot().catch(() => null)
          ),
          measure('home-rpc.getAllBossHp', () =>
            getAllBossHp(profile.guild_code ?? undefined)
          ),
          needsProgressionConfig
            ? measure('home-rpc.getActiveProgressionConfig', () =>
                getActiveProgressionConfig(
                  profile.guild_code ?? undefined,
                  Number.parseInt(season, 10)
                )
              ).catch(() => null)
            : Promise.resolve(null)
        ])
      : [
          null,
          { legendary: {}, mythic: {}, primes: {}, byBossName: {} } as Awaited<
            ReturnType<typeof getAllBossHp>
          >,
          null
        ]

  const parseSetLoop = (row: { set?: unknown; loop_index?: unknown }) => ({
    set:
      typeof row.set === 'number' && Number.isFinite(row.set)
        ? Math.max(0, Math.trunc(row.set))
        : 0,
    loopIndex:
      typeof row.loop_index === 'number' && Number.isFinite(row.loop_index)
        ? Math.max(0, Math.trunc(row.loop_index))
        : 0
  })

  if (progressionConfig && mainRow && mainWasDefeated) {
    const { set, loopIndex } = parseSetLoop(mainRow)
    const advanced = advanceBossToNextStage({
      currentBoss,
      rarity: mainRow.rarity ?? currentBoss.rarity,
      set,
      loopIndex,
      encounterId: 0,
      mainBossName: currentBoss.name,
      rotationSnapshot: sharedRotationSnapshot,
      bossHpData: sharedBossHpData,
      progressionConfig
    })
    if (advanced) currentBoss = advanced
  }

  if (
    progressionConfig &&
    prime1Row &&
    prime1 &&
    prime1.maxHp > 0 &&
    prime1.remainingHp <= 0 &&
    mainWasDefeated
  ) {
    const { set, loopIndex } = parseSetLoop(prime1Row)
    const advanced = advanceBossToNextStage({
      currentBoss: prime1,
      rarity: prime1Row.rarity ?? prime1.rarity,
      set,
      loopIndex,
      encounterId: 1,
      mainBossName: currentBoss.name,
      rotationSnapshot: sharedRotationSnapshot,
      bossHpData: sharedBossHpData,
      progressionConfig
    })
    if (advanced) prime1 = advanced
  }

  if (
    progressionConfig &&
    prime2Row &&
    prime2 &&
    prime2.maxHp > 0 &&
    prime2.remainingHp <= 0 &&
    mainWasDefeated
  ) {
    const { set, loopIndex } = parseSetLoop(prime2Row)
    const advanced = advanceBossToNextStage({
      currentBoss: prime2,
      rarity: prime2Row.rarity ?? prime2.rarity,
      set,
      loopIndex,
      encounterId: 2,
      mainBossName: currentBoss.name,
      rotationSnapshot: sharedRotationSnapshot,
      bossHpData: sharedBossHpData,
      progressionConfig
    })
    if (advanced) prime2 = advanced
  }

  // The RPC scopes primes to the main's stage+loop, so fill an empty slot unless skipped or advanced.
  if (wantsPrimeFill && sharedRotationSnapshot) {
    const skipped = await getSkippedPrimeEncounters(
      serviceSupabase,
      profile.guild_code!,
      season,
      currentBoss.levelCode
    )
    if (prime1 === null && !skipped.has(1)) {
      prime1 = resolveCurrentStagePrimeOverview({
        stageCode: currentBoss.levelCode,
        loop: currentBoss.loop ?? 1,
        encounterId: 1,
        mainBossName: currentBoss.name,
        rotationSnapshot: sharedRotationSnapshot,
        bossHpData: sharedBossHpData
      })
    }
    if (prime2 === null && !skipped.has(2)) {
      prime2 = resolveCurrentStagePrimeOverview({
        stageCode: currentBoss.levelCode,
        loop: currentBoss.loop ?? 1,
        encounterId: 2,
        mainBossName: currentBoss.name,
        rotationSnapshot: sharedRotationSnapshot,
        bossHpData: sharedBossHpData
      })
    }
  }

  // A wrong-stage prime would be graded against the wrong skip flags; an empty slot is honest.
  if (isOrphanPrime(prime1, currentBoss.levelCode)) prime1 = null
  if (isOrphanPrime(prime2, currentBoss.levelCode)) prime2 = null

  const result: LandingPageData = {
    guildName: formatGuildDisplayLabel(
      {
        display_name: guildConfig?.display_name,
        guild_tag: guildConfig?.guild_tag,
        guild_code: profile.guild_code
      },
      profile.guild_code
    ),
    guildStats,
    personalStats,
    currentBoss,
    primeBosses: { prime1, prime2 },
    managementData: {
      topPerformers,
      bottomPerformers,
      topTokenUsers: tokenRankings.topTokenUsers,
      bottomTokenUsers: tokenRankings.bottomTokenUsers
    },
    credentialHealth,
    tokenData
  }

  recordCalculationMetric({
    id: 'home-rpc.total',
    strategy: 'rpc-only',
    durationMs: Date.now() - requestStart,
    success: true,
    source: 'rpc',
    filterCount: 2
  })

  return result
}
