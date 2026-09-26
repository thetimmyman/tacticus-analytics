import { guildRosterQuery } from '@/app/lib/data/guild-roster'

import { db } from '@/app/lib/db'
import { buildBattleRowsQuery } from '@/app/lib/data/battle-rows'
import { getAllBossHp, lookupBossHpByName } from '@/app/lib/data/boss-hp'
import {
  getPrimeBossMaxHp,
  type BossHpData
} from '@/app/lib/boss-assignments/season-planner/boss-hp'
import {
  computePerformanceScoreAggregate,
  resolveExpectedTokens
} from '@/app/lib/boss-assignments/performance-score'
import { buildPerLoopEntries } from '@/app/lib/boss-assignments/token-performance-loop'
import {
  applyQualifyingSweepException,
  isSweepRow
} from '@/app/lib/calculations/utils/sweep-helpers'
import {
  selectSeasonScoped,
  LEGACY_SEASON
} from '@/app/lib/boss-assignments/target-token-season'
import { getSeasonPosition } from '@/app/lib/loki/season-configs'
import { normalizeDisplayName } from '@/app/lib/utils/normalize'
import type { TokenPerformanceData } from '@/app/lib/boss-assignments/token-performance-types'
import type { Database } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.data.guild-token-performance')

export type DamageRow = Pick<
  Database['public']['Tables']['EOT_GR_data']['Row'],
  | 'displayName'
  | 'userId'
  | 'Name'
  | 'set'
  | 'damageDealt'
  | 'remainingHp'
  | 'maxHp'
  | 'Season'
  | 'rarity'
  | 'loopIndex'
> & {
  encounterId?: number | null
}

type SeasonRow = Pick<
  Database['public']['Tables']['EOT_GR_data']['Row'],
  'Name' | 'Season'
>

interface BossHpDataShape {
  byBossName?: Record<string, number>
  /** Fallback only when a prime's own `maxHp` rows are unusable. */
  primes?: Record<string, number>
}

type TokenPerformanceCompareMode = 'guild' | 'cluster'
type TokenPerformanceRarity = 'Legendary' | 'Mythic'

export interface GuildTokenPerformanceOptions {
  seasonOverride?: string | null
  compareMode?: TokenPerformanceCompareMode
  clusterCode?: string | null
  rarities?: TokenPerformanceRarity[]
  includePerLoop?: boolean
  includeHistoricalPlayers?: boolean
  includePrimes?: boolean
  /**
   * `undefined` → self-fetch; `null`/`[]` → empty. Not checked against `guildCode`;
   * the API route never passes it, so that path stays RLS-bound.
   */
  prefetched?: {
    damageData?: DamageRow[] | null
    mostRecentSeasonPerBoss?: Record<string, string>
    bossHpData?: BossHpDataShape
    activeCurrentPlayers?: Set<string>
    officerTargetsByBossKey?: Record<string, number>
  }
}

export async function getGuildTokenPerformance(
  guildCode: string,
  options: GuildTokenPerformanceOptions = {}
): Promise<TokenPerformanceData> {
  const {
    seasonOverride = null,
    compareMode = 'guild',
    clusterCode = null,
    rarities,
    prefetched,
    includePerLoop = false,
    includeHistoricalPlayers = false,
    includePrimes = false
  } = options
  if (!guildCode) return {}
  const useCluster = compareMode === 'cluster' && !!clusterCode
  const effectiveRarities: TokenPerformanceRarity[] =
    !rarities || rarities.length === 0 ? ['Legendary', 'Mythic'] : rarities

  try {
    const needsSupabase =
      prefetched?.damageData === undefined ||
      (!includeHistoricalPlayers &&
        prefetched?.activeCurrentPlayers === undefined) ||
      prefetched?.mostRecentSeasonPerBoss === undefined
    const supabase = needsSupabase ? await db() : null

    const bossHpData: BossHpDataShape =
      prefetched?.bossHpData ?? (await getAllBossHp(guildCode))

    // is_active is deliberately ignored: it can drop current members with in-progress attacks.
    let activeCurrentPlayers = prefetched?.activeCurrentPlayers
    if (
      !includeHistoricalPlayers &&
      activeCurrentPlayers === undefined &&
      supabase
    ) {
      const { data: roster } = await guildRosterQuery(
        supabase,
        guildCode,
        'display_name'
      )
      const names = new Set<string>()
      ;(roster as { display_name?: string | null }[] | null)?.forEach((row) => {
        const normalized = normalizeDisplayName(row?.display_name)
        if (normalized) names.add(normalized)
      })
      activeCurrentPlayers = names
    }
    activeCurrentPlayers ??= new Set<string>()

    // `skip=false` drops "none available" sentinel rows.
    const targetSeason =
      seasonOverride ?? String(getSeasonPosition().seasonNumber)
    const officerTargetsByBossKey: Record<string, number> =
      prefetched?.officerTargetsByBossKey ?? {}
    if (prefetched?.officerTargetsByBossKey === undefined && supabase) {
      /* eslint-disable @typescript-eslint/no-explicit-any, no-restricted-syntax */
      let targetsQuery = (supabase.from('boss_target_tokens' as never) as any)
        /* eslint-enable @typescript-eslint/no-explicit-any, no-restricted-syntax */
        .select(
          'boss_name, rarity, set, target_tokens, season_number, encounter_id'
        )
        .eq('guild_code', guildCode)
        .eq('skip', false)
        .in('season_number', [targetSeason, LEGACY_SEASON])
      targetsQuery = includePrimes
        ? targetsQuery.in('encounter_id', [0, 1, 2])
        : targetsQuery.eq('encounter_id', 0)
      const { data: targets } = await targetsQuery
      const scopedTargets = selectSeasonScoped(
        (targets as Array<{
          boss_name: string
          rarity: string
          set: number
          target_tokens: number
          season_number: string | null
          encounter_id?: number
        }> | null) ?? [],
        targetSeason,
        (row) =>
          `${row.boss_name}_${row.rarity === 'Mythic' ? 'M' : 'L'}${row.set}_${row.encounter_id ?? 0}`
      )
      scopedTargets.forEach((row, key) => {
        if (!row.boss_name || !row.rarity || row.target_tokens <= 0) return
        officerTargetsByBossKey[key] = row.target_tokens
      })
    }

    let mostRecentSeasonPerBoss = prefetched?.mostRecentSeasonPerBoss
    if (!mostRecentSeasonPerBoss && supabase) {
      // Season is TEXT, so '99' would sort before '100'.
      let bossSeasonsQuery = supabase
        // .order('startedOn') is applied below; marker must sit above .from.
        // eot-gr-data-requires-order — verified false positive.
        .from('EOT_GR_data')
        .select('Name, Season')
        .eq('Guild', guildCode)
        .in('rarity', effectiveRarities)
        .not('Name', 'is', null)
      // Must mirror the damage queries or prime rows fail the season match.
      bossSeasonsQuery = includePrimes
        ? bossSeasonsQuery.in('encounterId', [0, 1, 2])
        : bossSeasonsQuery.eq('encounterId', 0)
      const { data: bossSeasons } = await bossSeasonsQuery.order('startedOn', {
        ascending: false
      })

      const computed: Record<string, string> = {}
      ;(bossSeasons as SeasonRow[] | null)?.forEach((row) => {
        if (row?.Name && row?.Season && !computed[row.Name]) {
          computed[row.Name] = row.Season
        }
      })
      mostRecentSeasonPerBoss = computed
    }
    mostRecentSeasonPerBoss ??= {}

    let damageData = prefetched?.damageData
    if (damageData === undefined && supabase) {
      const { data } = await buildBattleRowsQuery<DamageRow>(supabase, {
        select:
          'displayName, userId, Name, set, damageDealt, remainingHp, maxHp, Season, rarity, loopIndex, encounterId',
        scope: { guild: guildCode },
        rarities: effectiveRarities,
        encounters: includePrimes ? 'main-and-primes' : 'main',
        ...(seasonOverride ? { season: seasonOverride } : {})
      })
      damageData = data as DamageRow[] | null
    }

    let clusterDamageData: DamageRow[] | null = null
    if (useCluster && supabase) {
      const { data } = await buildBattleRowsQuery<DamageRow>(supabase, {
        select:
          'displayName, userId, Name, set, damageDealt, remainingHp, maxHp, Season, rarity, loopIndex, encounterId',
        scope: { cluster: clusterCode! },
        rarities: effectiveRarities,
        encounters: includePrimes ? 'main-and-primes' : 'main',
        ...(seasonOverride ? { season: seasonOverride } : {})
      })
      clusterDamageData = data as DamageRow[] | null
    }

    interface BossAgg {
      bossName: string
      bossKey: string
      rarity: 'Legendary' | 'Mythic'
      set: number
      encounterId: number
      bossHp: number
      totalDamage: number
      totalAttacks: number
    }

    const baselineDamageData: DamageRow[] | null | undefined = useCluster
      ? clusterDamageData
      : damageData

    const lookupBossHp = (name: string, bossKey: string): number =>
      lookupBossHpByName(name, bossKey, bossHpData?.byBossName ?? {})

    // Primes use the max observed `maxHp`, else the constants keyed by the paired main.
    const rowMaxHpByBossKey = new Map<string, number>()
    const mainBossNameByRaritySet = new Map<string, string>()
    if (includePrimes) {
      baselineDamageData?.forEach((row) => {
        if (!row.Name || !row.Season) return
        const seasonMatch = seasonOverride
          ? row.Season === seasonOverride
          : row.Season === mostRecentSeasonPerBoss[row.Name]
        if (!seasonMatch) return
        const rarity = row.rarity === 'Mythic' ? 'Mythic' : 'Legendary'
        const setNum = (row.set ?? 0) + 1
        const rarityPrefix = rarity === 'Mythic' ? 'M' : 'L'
        const bossKey = `${row.Name}_${rarityPrefix}${setNum}`
        const rowMaxHp = row.maxHp ?? 0
        if (rowMaxHp > (rowMaxHpByBossKey.get(bossKey) ?? 0)) {
          rowMaxHpByBossKey.set(bossKey, rowMaxHp)
        }
        if ((row.encounterId ?? 0) === 0) {
          mainBossNameByRaritySet.set(`${rarity}_${setNum}`, row.Name)
        }
      })
    }
    const primeHpFallbackData: BossHpData = {
      legendary: {},
      mythic: {},
      byBossName: {},
      primes: bossHpData?.primes ?? {}
    }

    const bossAggByKey = new Map<string, BossAgg>()

    baselineDamageData?.forEach((row) => {
      if (!row.Name || !row.Season) return
      if (!includePrimes && (row.encounterId ?? 0) !== 0) return
      const seasonMatch = seasonOverride
        ? row.Season === seasonOverride
        : row.Season === mostRecentSeasonPerBoss[row.Name]
      if (!seasonMatch) return

      if (isSweepRow(row)) return

      const rarity = row.rarity === 'Mythic' ? 'Mythic' : 'Legendary'
      const setNum = (row.set ?? 0) + 1
      const rarityPrefix = rarity === 'Mythic' ? 'M' : 'L'
      const bossKey = `${row.Name}_${rarityPrefix}${setNum}`
      const encounterId = row.encounterId ?? 0

      let bossHpLookup: number
      if (encounterId === 0) {
        bossHpLookup = lookupBossHp(row.Name, bossKey)
      } else {
        bossHpLookup = rowMaxHpByBossKey.get(bossKey) ?? 0
        if (bossHpLookup <= 0) {
          const mainName = mainBossNameByRaritySet.get(`${rarity}_${setNum}`)
          bossHpLookup = mainName
            ? (getPrimeBossMaxHp(
                primeHpFallbackData,
                mainName,
                `${rarityPrefix}${setNum}`,
                encounterId as 1 | 2
              ) ?? 0)
            : 0
        }
      }
      if (bossHpLookup <= 0) return

      let agg = bossAggByKey.get(bossKey)
      if (!agg) {
        agg = {
          bossName: row.Name,
          bossKey,
          rarity,
          set: setNum,
          encounterId,
          bossHp: bossHpLookup,
          totalDamage: 0,
          totalAttacks: 0
        }
        bossAggByKey.set(bossKey, agg)
      }
      agg.totalDamage += row.damageDealt ?? 0
      agg.totalAttacks += 1
    })

    const baselineAvgByBossKey = new Map<string, number>()
    bossAggByKey.forEach((agg, bossKey) => {
      if (agg.totalAttacks > 0 && agg.totalDamage > 0) {
        baselineAvgByBossKey.set(bossKey, agg.totalDamage / agg.totalAttacks)
      }
    })

    interface PlayerBossDamageAccumulator {
      total: number
      count: number
      sweeps: Array<{ damage: number; loopIndex: number | null }>
      perLoop: Map<number, { total: number; count: number }>
    }
    const avgDamageMap = new Map<
      string,
      Map<string, PlayerBossDamageAccumulator>
    >()
    const playerMetaByKey = new Map<
      string,
      { playerId?: string; displayName: string }
    >()
    damageData?.forEach((row) => {
      if (!row.Name || !row.displayName || !row.Season) return
      // Prefetched data bypasses the query's encounterId filter.
      if (!includePrimes && (row.encounterId ?? 0) !== 0) return
      const seasonMatch = seasonOverride
        ? row.Season === seasonOverride
        : row.Season === mostRecentSeasonPerBoss[row.Name]
      if (!seasonMatch) return

      const damage = row.damageDealt ?? 0
      const sweep = isSweepRow(row)

      const playerName = row.displayName
      const playerId =
        typeof row.userId === 'string' && row.userId.trim().length > 0
          ? row.userId.trim()
          : undefined
      const playerKey =
        includeHistoricalPlayers && playerId ? playerId : playerName
      const rarityPrefix = row.rarity === 'Mythic' ? 'M' : 'L'
      const bossKey = `${row.Name}_${rarityPrefix}${(row.set ?? 0) + 1}`

      if (!playerMetaByKey.has(playerKey)) {
        playerMetaByKey.set(playerKey, { playerId, displayName: playerName })
      }

      let bosses = avgDamageMap.get(playerKey)
      if (!bosses) {
        bosses = new Map()
        avgDamageMap.set(playerKey, bosses)
      }
      const bucket = bosses.get(bossKey) ?? {
        total: 0,
        count: 0,
        sweeps: [],
        perLoop: new Map<number, { total: number; count: number }>()
      }
      const loopIndex = typeof row.loopIndex === 'number' ? row.loopIndex : null

      if (sweep) {
        bucket.sweeps.push({ damage, loopIndex })
      } else {
        bucket.total += damage
        bucket.count += 1

        if (includePerLoop && loopIndex !== null) {
          const existing = bucket.perLoop.get(loopIndex) ?? {
            total: 0,
            count: 0
          }
          existing.total += damage
          existing.count += 1
          bucket.perLoop.set(loopIndex, existing)
        }
      }
      bosses.set(bossKey, bucket)
    })

    avgDamageMap.forEach((bosses) => {
      bosses.forEach((bucket, bossKey) => {
        const referenceAvg = baselineAvgByBossKey.get(bossKey) ?? 0
        const playerNonSweepAvg =
          bucket.count > 0 ? bucket.total / bucket.count : 0
        const { adjustedDamage, adjustedCount } = applyQualifyingSweepException(
          bucket.total,
          bucket.count,
          bucket.sweeps.map((sweep) => sweep.damage),
          referenceAvg,
          playerNonSweepAvg
        )

        if (includePerLoop && referenceAvg > 0) {
          const gate = Math.max(referenceAvg, playerNonSweepAvg)
          bucket.sweeps.forEach(({ damage, loopIndex }) => {
            if (damage < gate || loopIndex === null) return
            const existing = bucket.perLoop.get(loopIndex) ?? {
              total: 0,
              count: 0
            }
            existing.total += damage
            existing.count += 1
            bucket.perLoop.set(loopIndex, existing)
          })
        }

        bucket.total = adjustedDamage
        bucket.count = adjustedCount
      })
    })

    const guildExpectedTokensByBoss = new Map<
      string,
      { tokens: number; sampleCount: number }
    >()
    const cohortAccum = new Map<
      string,
      { tokenSum: number; bossCount: number; attackCount: number }
    >()

    bossAggByKey.forEach((agg) => {
      if (agg.totalAttacks <= 0 || agg.totalDamage <= 0) return
      const guildAvgDamage = agg.totalDamage / agg.totalAttacks
      const expectedTokens = agg.bossHp / guildAvgDamage
      if (!Number.isFinite(expectedTokens) || expectedTokens <= 0) return

      guildExpectedTokensByBoss.set(agg.bossKey, {
        tokens: expectedTokens,
        sampleCount: agg.totalAttacks
      })
      // Encounter-scoped: primes have far lower HP than their main.
      const cohortKey = `${agg.rarity}_${agg.set}_${agg.encounterId}`
      const existing = cohortAccum.get(cohortKey) ?? {
        tokenSum: 0,
        bossCount: 0,
        attackCount: 0
      }
      existing.tokenSum += expectedTokens
      existing.bossCount += 1
      existing.attackCount += agg.totalAttacks
      cohortAccum.set(cohortKey, existing)
    })

    const cohortMeans = new Map<
      string,
      { meanTokensToKill: number; sampleCount: number }
    >()
    cohortAccum.forEach((value, key) => {
      if (value.bossCount > 0) {
        cohortMeans.set(key, {
          meanTokensToKill: value.tokenSum / value.bossCount,
          sampleCount: value.attackCount
        })
      }
    })

    const resultEntries: Array<[string, TokenPerformanceData[string]]> = []
    avgDamageMap.forEach((bosses, playerKey) => {
      const playerMeta = playerMetaByKey.get(playerKey)
      const playerName = playerMeta?.displayName ?? playerKey
      if (
        !includeHistoricalPlayers &&
        !activeCurrentPlayers.has(normalizeDisplayName(playerName))
      ) {
        return
      }
      const playerEntries: Array<
        [string, TokenPerformanceData[string][string]]
      > = []

      bosses.forEach((data, bossKey) => {
        if (data.count <= 0) return
        const agg = bossAggByKey.get(bossKey)
        if (!agg) return
        const perBoss = guildExpectedTokensByBoss.get(bossKey)
        const rarityMatch = bossKey.match(/_([ML])(\d+)$/)
        const rarityPrefix = rarityMatch?.[1]
        const setNumber = rarityMatch?.[2]
        const cohortKey =
          rarityPrefix && setNumber
            ? `${rarityPrefix === 'M' ? 'Mythic' : 'Legendary'}_${parseInt(setNumber, 10)}_${agg.encounterId}`
            : null
        const cohort = cohortKey ? cohortMeans.get(cohortKey) : null

        const resolved = resolveExpectedTokens({
          officerTargetTokens:
            officerTargetsByBossKey[`${bossKey}_${agg.encounterId}`] ?? null,
          perBossTokens: perBoss?.tokens ?? null,
          perBossSampleCount: perBoss?.sampleCount ?? 0,
          guildCohort: cohort ?? null
        })

        const scored = computePerformanceScoreAggregate({
          actualDamage: data.total,
          tokensSpent: data.count,
          bossHp: agg.bossHp,
          expectedTokens: resolved.expectedTokens
        })

        const expectedDamage =
          resolved.expectedTokens !== null &&
          resolved.expectedTokens > 0 &&
          agg.bossHp > 0
            ? data.count * (agg.bossHp / resolved.expectedTokens)
            : null

        const entry: TokenPerformanceData[string][string] = {
          playerId: playerMeta?.playerId,
          displayName: playerName,
          encounterId: agg.encounterId,
          score: scored.score,
          tier: resolved.tier,
          tokensSpent: data.count,
          expectedTokens: resolved.expectedTokens,
          actualDamage: data.total,
          expectedDamage
        }

        if (includePerLoop) {
          if (data.perLoop.size > 0) {
            const perLoop = buildPerLoopEntries(
              data.perLoop.entries(),
              agg.bossHp,
              resolved.expectedTokens
            )
            if (perLoop) entry.perLoop = perLoop
          }
        }

        playerEntries.push([bossKey, entry])
      })

      if (playerEntries.length > 0) {
        resultEntries.push([playerKey, Object.fromEntries(playerEntries)])
      }
    })

    // fromEntries defines names like "__proto__" as own data properties.
    return Object.fromEntries(resultEntries)
  } catch (err) {
    logger.error({ guildCode, error: err }, 'getGuildTokenPerformance failed')
    return {}
  }
}
