import type { TypedSupabaseClient } from '@tacticus/app-core/types'

import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.dashboard.boss-metrics')
import { getAllBossHp } from '@/app/lib/data/boss-hp'
import { ensureRotationSnapshot } from '@/app/lib/loki/rotation-cache'
import {
  inferMainBossDeath,
  advanceBossToNextStage,
  resolveCurrentStagePrimeOverview
} from './home-summary-utils'
import { getSkippedPrimeEncounters } from './skipped-primes'
import { getLatestSeason } from '@/app/lib/data/get-latest-season'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import type {
  BossCombatMetrics,
  LandingPageBossOverview
} from './home-summary-types'

type SupabaseClient = TypedSupabaseClient

export { buildBossOverview, DEFAULT_BOSS } from './boss-metrics-model'
import {
  buildBossOverview,
  calculateAverageDamagePerHour,
  calculateBossCombatMetrics,
  type BossBattleRecord,
  type BossTimeRecord
} from './boss-metrics-model'

export const getBossCombatMetricsForEncounter = async (
  supabase: SupabaseClient,
  guildCode: string,
  season: string,
  encounterId: number,
  // Scoped to the stage, not loopIndex: tokens-to-kill and prior-loop need cross-loop rows.
  scopeSet?: number | null,
  scopeRarity?: string | null
): Promise<BossCombatMetrics | null> => {
  try {
    let query = supabase
      // audit-ok eot-gr-data-requires-order: .order() is applied below on the reassigned `query` (conditional scope filters force the chain split)
      .from('EOT_GR_data')
      .select(
        'damageDealt, damageType, loopIndex, set, startedOn, completedOn, timestamp, remainingHp, maxHp'
      )
      .eq('Guild', guildCode)
      .eq('Season', season)
      .eq('encounterId', encounterId)
      .eq('damageType', 'Battle')
    if (typeof scopeSet === 'number' && Number.isFinite(scopeSet)) {
      query = query.eq('set', scopeSet)
    }
    if (typeof scopeRarity === 'string' && scopeRarity.length > 0) {
      query = query.eq('rarity', scopeRarity)
    }
    const { data, error } = await query
      .order('set', { ascending: true })
      .order('loopIndex', { ascending: true })
      .order('timestamp', { ascending: true })
      .order('completedOn', { ascending: true })

    if (error) {
      logger.warn(
        {
          guildCode,
          season,
          encounterId,
          code: error.code,
          message: error.message,
          details: error.details,
          hint: error.hint
        },
        '[landing-page] Failed to load boss combat metrics'
      )
      return null
    }

    if (!data || data.length === 0) {
      return null
    }

    return calculateBossCombatMetrics(data as unknown as BossBattleRecord[])
  } catch (error) {
    logger.warn(
      {
        guildCode,
        season,
        encounterId,
        error
      },
      '[landing-page] Unexpected error calculating boss combat metrics'
    )
    return null
  }
}

export interface BossOverviews {
  current: LandingPageBossOverview
  prime1: LandingPageBossOverview | null
  prime2: LandingPageBossOverview | null
}

export const loadBossOverviews = async (
  supabase: SupabaseClient,
  guildCode: string,
  season: string
): Promise<BossOverviews> => {
  const parseLegacySet = (data: unknown): number => {
    const raw = (data as { set?: unknown } | null)?.set
    const num =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number.parseInt(raw, 10)
          : 0
    return Number.isFinite(num) && num >= 0 ? Math.trunc(num) : 0
  }
  const parseLegacyRarity = (data: unknown, fallback: string): string => {
    const raw = (data as { rarity?: unknown } | null)?.rarity
    return typeof raw === 'string' ? raw : fallback
  }
  const parseLegacyLoopIndex = (
    metrics: BossCombatMetrics | null | undefined
  ): number =>
    typeof metrics?.currentLoopIndex === 'number' &&
    Number.isFinite(metrics.currentLoopIndex)
      ? Math.max(0, Math.trunc(metrics.currentLoopIndex))
      : 0
  const parseLegacyLoopIndexRaw = (data: unknown): number => {
    const raw = (data as { loopIndex?: unknown } | null)?.loopIndex
    const num =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string'
          ? Number.parseInt(raw, 10)
          : 0
    return Number.isFinite(num) && num >= 0 ? Math.trunc(num) : 0
  }

  // Main first: its stage scopes the prime lookups so a stale prime can't leak in.
  const { data: bossFallback } = await supabase
    .from('EOT_GR_data')
    .select(
      'Name, rarity, set, maxHp, remainingHp, encounterId, completedOn, loopIndex'
    )
    .eq('Guild', guildCode)
    .eq('Season', season)
    .in('damageType', ['Battle', 'Bomb'])
    .eq('encounterId', 0)
    .order('completedOn', { ascending: false })
    .limit(1)
    .maybeSingle()

  const mainRarity = parseLegacyRarity(bossFallback, 'Legendary')
  const mainSet = parseLegacySet(bossFallback)
  const mainLoopRaw = parseLegacyLoopIndexRaw(bossFallback)

  const buildScopedPrimeQuery = (encounterId: 1 | 2) => {
    const base = supabase
      // audit-ok eot-gr-data-requires-order: .order() is applied below on `scoped` (conditional loop filter forces the chain split)
      .from('EOT_GR_data')
      .select(
        'Name, rarity, set, maxHp, remainingHp, encounterId, completedOn, loopIndex'
      )
      .eq('Guild', guildCode)
      .eq('Season', season)
      .in('damageType', ['Battle', 'Bomb'])
      .eq('encounterId', encounterId)
      .eq('rarity', mainRarity)
      .eq('set', mainSet)
    // Matches the RPC's COALESCE(loopIndex, 0).
    const scoped =
      mainLoopRaw === 0
        ? base.or('loopIndex.is.null,loopIndex.eq.0')
        : base.eq('loopIndex', mainLoopRaw)
    return scoped
      .order('completedOn', { ascending: false })
      .limit(1)
      .maybeSingle()
  }

  const [{ data: prime1Data }, { data: prime2Data }] = bossFallback
    ? await Promise.all([buildScopedPrimeQuery(1), buildScopedPrimeQuery(2)])
    : [{ data: null }, { data: null }]

  let bossOverview = buildBossOverview(
    undefined,
    bossFallback as unknown as Record<string, unknown> | null
  )
  let prime1Overview = prime1Data
    ? buildBossOverview(
        undefined,
        prime1Data as unknown as Record<string, unknown> | null
      )
    : null
  let prime2Overview = prime2Data
    ? buildBossOverview(
        undefined,
        prime2Data as unknown as Record<string, unknown> | null
      )
    : null

  const [currentBossMetrics, prime1Metrics, prime2Metrics] = await Promise.all([
    getBossCombatMetricsForEncounter(
      supabase,
      guildCode,
      season,
      bossOverview.encounterId ?? 0,
      mainSet,
      mainRarity
    ),
    prime1Overview
      ? getBossCombatMetricsForEncounter(
          supabase,
          guildCode,
          season,
          prime1Overview.encounterId ?? 1,
          mainSet,
          mainRarity
        )
      : Promise.resolve<BossCombatMetrics | null>(null),
    prime2Overview
      ? getBossCombatMetricsForEncounter(
          supabase,
          guildCode,
          season,
          prime2Overview.encounterId ?? 2,
          mainSet,
          mainRarity
        )
      : Promise.resolve<BossCombatMetrics | null>(null)
  ])

  if (currentBossMetrics) {
    bossOverview = {
      ...bossOverview,
      combatMetrics: currentBossMetrics,
      loop:
        currentBossMetrics.currentLoopIndex !== null
          ? currentBossMetrics.currentLoopIndex + 1
          : bossOverview.loop
    }
  }

  if (prime1Overview && prime1Metrics) {
    prime1Overview = {
      ...prime1Overview,
      combatMetrics: prime1Metrics,
      loop:
        prime1Metrics.currentLoopIndex !== null
          ? prime1Metrics.currentLoopIndex + 1
          : prime1Overview.loop
    }
  }

  if (prime2Overview && prime2Metrics) {
    prime2Overview = {
      ...prime2Overview,
      combatMetrics: prime2Metrics,
      loop:
        prime2Metrics.currentLoopIndex !== null
          ? prime2Metrics.currentLoopIndex + 1
          : prime2Overview.loop
    }
  }

  const tsFromCompletedOn = (data: unknown): number => {
    const val = (data as { completedOn?: string } | null)?.completedOn
    return val ? new Date(val).getTime() : 0
  }
  bossOverview = inferMainBossDeath(bossOverview, {
    mainTs: tsFromCompletedOn(bossFallback),
    prime1Ts: tsFromCompletedOn(prime1Data),
    prime2Ts: tsFromCompletedOn(prime2Data)
  })

  const mainAliveAtCurrentStage =
    bossOverview.maxHp > 0 && bossOverview.remainingHp > 0
  const aPrimeSlotEmpty = prime1Overview === null || prime2Overview === null
  // The rotation snapshot is current-season only.
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

  const anyBossDefeated =
    (bossOverview.maxHp > 0 && bossOverview.remainingHp <= 0) ||
    (prime1Overview !== null &&
      prime1Overview.maxHp > 0 &&
      prime1Overview.remainingHp <= 0) ||
    (prime2Overview !== null &&
      prime2Overview.maxHp > 0 &&
      prime2Overview.remainingHp <= 0)
  const needsProgressionConfig =
    (Boolean(bossFallback) &&
      bossOverview.maxHp > 0 &&
      bossOverview.remainingHp <= 0) ||
    (Boolean(prime1Data) &&
      prime1Overview !== null &&
      prime1Overview.maxHp > 0 &&
      prime1Overview.remainingHp <= 0 &&
      bossOverview.remainingHp <= 0) ||
    (Boolean(prime2Data) &&
      prime2Overview !== null &&
      prime2Overview.maxHp > 0 &&
      prime2Overview.remainingHp <= 0 &&
      bossOverview.remainingHp <= 0)
  // Loaded only when an advancement branch can run, so a missing source row does not fail the page.
  const [sharedRotationSnapshot, sharedBossHpData, progressionConfig] =
    anyBossDefeated || wantsPrimeFill
      ? await Promise.all([
          ensureRotationSnapshot().catch(() => null),
          getAllBossHp(guildCode),
          needsProgressionConfig
            ? getActiveProgressionConfig(
                guildCode,
                Number.parseInt(season, 10)
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

  if (
    progressionConfig &&
    bossFallback &&
    bossOverview.maxHp > 0 &&
    bossOverview.remainingHp <= 0
  ) {
    const advanced = advanceBossToNextStage({
      currentBoss: bossOverview,
      rarity: parseLegacyRarity(bossFallback, bossOverview.rarity),
      set: parseLegacySet(bossFallback),
      loopIndex: parseLegacyLoopIndex(currentBossMetrics),
      encounterId: 0,
      mainBossName: bossOverview.name,
      rotationSnapshot: sharedRotationSnapshot,
      bossHpData: sharedBossHpData,
      progressionConfig
    })
    if (advanced) bossOverview = advanced
  }

  if (
    progressionConfig &&
    prime1Data &&
    prime1Overview &&
    prime1Overview.maxHp > 0 &&
    prime1Overview.remainingHp <= 0 &&
    bossOverview.remainingHp <= 0
  ) {
    const advanced = advanceBossToNextStage({
      currentBoss: prime1Overview,
      rarity: parseLegacyRarity(prime1Data, prime1Overview.rarity),
      set: parseLegacySet(prime1Data),
      loopIndex: parseLegacyLoopIndex(prime1Metrics),
      encounterId: 1,
      mainBossName: bossOverview.name,
      rotationSnapshot: sharedRotationSnapshot,
      bossHpData: sharedBossHpData,
      progressionConfig
    })
    if (advanced) prime1Overview = advanced
  }

  if (
    progressionConfig &&
    prime2Data &&
    prime2Overview &&
    prime2Overview.maxHp > 0 &&
    prime2Overview.remainingHp <= 0 &&
    bossOverview.remainingHp <= 0
  ) {
    const advanced = advanceBossToNextStage({
      currentBoss: prime2Overview,
      rarity: parseLegacyRarity(prime2Data, prime2Overview.rarity),
      set: parseLegacySet(prime2Data),
      loopIndex: parseLegacyLoopIndex(prime2Metrics),
      encounterId: 2,
      mainBossName: bossOverview.name,
      rotationSnapshot: sharedRotationSnapshot,
      bossHpData: sharedBossHpData,
      progressionConfig
    })
    if (advanced) prime2Overview = advanced
  }

  // Only while the main is still alive at this stage.
  if (wantsPrimeFill && sharedRotationSnapshot) {
    const skipped = await getSkippedPrimeEncounters(
      supabase,
      guildCode,
      season,
      bossOverview.levelCode
    )
    if (prime1Overview === null && !skipped.has(1)) {
      prime1Overview = resolveCurrentStagePrimeOverview({
        stageCode: bossOverview.levelCode,
        loop: bossOverview.loop ?? 1,
        encounterId: 1,
        mainBossName: bossOverview.name,
        rotationSnapshot: sharedRotationSnapshot,
        bossHpData: sharedBossHpData
      })
    }
    if (prime2Overview === null && !skipped.has(2)) {
      prime2Overview = resolveCurrentStagePrimeOverview({
        stageCode: bossOverview.levelCode,
        loop: bossOverview.loop ?? 1,
        encounterId: 2,
        mainBossName: bossOverview.name,
        rotationSnapshot: sharedRotationSnapshot,
        bossHpData: sharedBossHpData
      })
    }
  }

  return {
    current: bossOverview,
    prime1: prime1Overview,
    prime2: prime2Overview
  }
}

/** Null when no defeated loop has a measurable duration. */
export const calculateGuildAvgDamagePerHour = async (
  supabase: SupabaseClient,
  guildCode: string,
  season: string
): Promise<number | null> => {
  try {
    const { data } = await supabase
      .from('EOT_GR_data')
      .select(
        'Name, rarity, set, encounterId, damageDealt, startedOn, completedOn, timestamp, loopIndex, remainingHp, maxHp'
      )
      .eq('Guild', guildCode)
      .eq('Season', season)
      .eq('damageType', 'Battle')
      .gt('damageDealt', 0)
      .order('startedOn', { ascending: false })

    return Array.isArray(data)
      ? calculateAverageDamagePerHour(data as unknown as BossTimeRecord[])
      : null
  } catch (error) {
    logger.error(
      { error, guildCode, season },
      'Failed to calculate average damage per hour'
    )
    return null
  }
}
