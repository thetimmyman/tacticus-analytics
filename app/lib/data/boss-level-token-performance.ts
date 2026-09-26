import { guildRosterQuery } from '@/app/lib/data/guild-roster'
/** Keys are "Main_{level}", "Prime1_{level}", "Prime2_{level}" so the heatmap can parse them. */

import { db } from '@/app/lib/db'
import { getAllBossHp, lookupBossHpByName } from '@/app/lib/data/boss-hp'
import { lookupPrimeBossHp } from '@/app/lib/data/prime-boss-hp'
import {
  computePerformanceScoreAggregate,
  resolveExpectedTokens
} from '@/app/lib/boss-assignments/performance-score'
import { buildPerLoopEntries } from '@/app/lib/boss-assignments/token-performance-loop'
import {
  selectSeasonScoped,
  isOfficerSkip,
  LEGACY_SEASON
} from '@/app/lib/boss-assignments/target-token-season'
import { getSkippedPrimeEncounters } from '@/app/lib/dashboard/skipped-primes'
import { normalizeDisplayName } from '@/app/lib/utils/normalize'
import {
  applyQualifyingSweepException,
  isSweepRow
} from '@/app/lib/calculations/utils/sweep-helpers'
import {
  getSeasonConfigById,
  getSeasonConfigIdForOffset
} from '@/app/lib/loki/season-configs'
import type { TokenPerformanceData } from '@/app/lib/boss-assignments/token-performance-types'
import type { Database } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.data.boss-level-token-performance')

type DamageRow = Pick<
  Database['public']['Tables']['EOT_GR_data']['Row'],
  | 'displayName'
  | 'Name'
  | 'set'
  | 'damageDealt'
  | 'remainingHp'
  | 'maxHp'
  | 'Season'
  | 'rarity'
  | 'encounterId'
  | 'loopIndex'
>

type TokenPerformanceEntry = TokenPerformanceData[string][string]

interface QualifiedSweepResult {
  adjustedDamage: number
  adjustedCount: number
  qualifyingSweepIndices: number[]
}

export function qualifyBossLevelSweeps(args: {
  nonSweepDamage: number
  nonSweepCount: number
  sweepDamages: number[]
  referenceAvg: number
}): QualifiedSweepResult {
  const playerNonSweepAvg =
    args.nonSweepCount > 0
      ? args.nonSweepDamage / args.nonSweepCount
      : undefined
  const adjusted = applyQualifyingSweepException(
    args.nonSweepDamage,
    args.nonSweepCount,
    args.sweepDamages,
    args.referenceAvg,
    playerNonSweepAvg
  )
  const qualifyingSweepIndices = args.sweepDamages.flatMap((damage, index) => {
    const candidate = applyQualifyingSweepException(
      0,
      0,
      [damage],
      args.referenceAvg,
      playerNonSweepAvg
    )
    return candidate.adjustedCount > 0 ? [index] : []
  })

  return { ...adjusted, qualifyingSweepIndices }
}

export function materializeBossLevelTokenPerformance(
  players: ReadonlyMap<string, ReadonlyMap<string, TokenPerformanceEntry>>
): TokenPerformanceData {
  return Object.fromEntries(
    Array.from(players, ([playerName, encounters]) => [
      playerName,
      Object.fromEntries(encounters)
    ])
  )
}

export interface BossLevelTokenPerformanceArgs {
  guildCode: string
  season: string
  bossName: string
  level: string
  includePerLoop?: boolean
}

function parseLevel(
  level: string
): { rarity: 'Legendary' | 'Mythic'; set: number } | null {
  const match = level.match(/^([LM])(\d+)$/)
  if (!match) return null
  const rarityPrefix = match[1]
  const setNumber = match[2]
  if (!rarityPrefix || !setNumber) return null
  return {
    rarity: rarityPrefix === 'M' ? 'Mythic' : 'Legendary',
    set: parseInt(setNumber, 10)
  }
}

const lookupBossHp = lookupBossHpByName

export async function getBossLevelTokenPerformance(
  args: BossLevelTokenPerformanceArgs
): Promise<TokenPerformanceData> {
  const { guildCode, season, bossName, level, includePerLoop = false } = args
  try {
    const supabase = await db()
    const levelParts = parseLevel(level)
    if (!supabase) {
      logger.warn(
        { guildCode, season, bossName, level },
        'getBossLevelTokenPerformance: no Supabase client'
      )
      return {}
    }
    if (!levelParts) {
      logger.warn(
        { guildCode, season, bossName, level },
        'getBossLevelTokenPerformance: invalid level format'
      )
      return {}
    }

    const setZeroIndexed = levelParts.set - 1

    // Filter targets to the current rotation's boss_type per encounter, or stale rows
    // from rotated-out bosses overwrite prime targets.
    const currentConfig = getSeasonConfigById(getSeasonConfigIdForOffset(0).id)
    const allowedTypeByEncounter = new Map<number, string>()
    currentConfig.bosses.forEach((b) => {
      if (b.rarity !== levelParts.rarity) return
      if (b.set + 1 !== levelParts.set) return
      allowedTypeByEncounter.set(b.encounter_id, b.boss_type)
    })

    // Primes have their own Name, so filter by (rarity, set) to get all 3 encounters.
    const [
      bossHpData,
      playerMapping,
      damageResult,
      officerTargetRow,
      plannerSkippedPrimes
    ] = await Promise.all([
      getAllBossHp(guildCode),
      guildRosterQuery(
        supabase,
        guildCode,
        'display_name, is_current, is_active'
      ),
      // Keep killing-blow rows: sweep classification needs them.
      supabase
        .from('EOT_GR_data')
        .select(
          'displayName, Name, set, damageDealt, remainingHp, maxHp, Season, rarity, encounterId, loopIndex'
        )
        .eq('Guild', guildCode)
        .eq('Season', season)
        .eq('rarity', levelParts.rarity)
        .eq('set', setZeroIndexed)
        .eq('damageType', 'Battle')
        .gt('damageDealt', 0)
        .in('encounterId', [0, 1, 2])
        .order('startedOn', { ascending: false }),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, no-restricted-syntax
      (supabase.from('boss_target_tokens' as never) as any)
        .select(
          'boss_name, encounter_id, target_tokens, skip, source, seeded_from_seasons, season_number'
        )
        .eq('guild_code', guildCode)
        .eq('rarity', levelParts.rarity)
        .eq('set', levelParts.set)
        .in('season_number', [season, LEGACY_SEASON]),
      getSkippedPrimeEncounters(supabase, guildCode, season, level)
    ])
    if (damageResult.error) {
      logger.error(
        {
          guildCode,
          season,
          bossName,
          level,
          error: damageResult.error
        },
        'getBossLevelTokenPerformance: damage query failed'
      )
      return {}
    }

    const damageRows = (damageResult.data ?? []) as DamageRow[]
    if (damageRows.length === 0) return {}

    // The RPC passes the display name, but every store uses the bossType slug.
    const resolvedSlug =
      damageRows.find((r) => r.encounterId === 0 && r.Name)?.Name ?? bossName
    const viewingCurrentSlot = allowedTypeByEncounter.get(0) === resolvedSlug

    // Off-rotation rows are stale; season rows beat the '' legacy row; the sentinel is neither skip nor target.
    type OfficerTargetRow = {
      boss_name: string
      encounter_id: number
      target_tokens: number
      skip: boolean | null
      source: string | null
      seeded_from_seasons: string | null
      season_number: string | null
    }
    const scopedOfficerRows = selectSeasonScoped(
      (officerTargetRow?.data as OfficerTargetRow[] | null) ?? [],
      season,
      (row) => `${row.boss_name}__${row.encounter_id}`
    )
    const officerTargetByEncounter = new Map<number, number>()
    const officerSkipByEncounter = new Map<number, boolean>()
    scopedOfficerRows.forEach((row) => {
      const expectedType = viewingCurrentSlot
        ? allowedTypeByEncounter.get(row.encounter_id)
        : row.encounter_id === 0
          ? resolvedSlug
          : undefined
      if (!expectedType || row.boss_name !== expectedType) return
      if (isOfficerSkip(row)) {
        officerSkipByEncounter.set(row.encounter_id, true)
        return
      }
      if (row.skip !== true && row.target_tokens > 0) {
        officerTargetByEncounter.set(row.encounter_id, row.target_tokens)
      }
    })

    const activeCurrentPlayers = new Set<string>()
    ;(playerMapping.data ?? []).forEach(
      (row: { display_name: string | null }) => {
        if (row.display_name)
          activeCurrentPlayers.add(normalizeDisplayName(row.display_name))
      }
    )

    const bossKey = `${resolvedSlug}_${level}`
    const mainHp = lookupBossHp(
      resolvedSlug,
      bossKey,
      bossHpData.byBossName ?? {}
    )
    const prime1Hp = lookupPrimeBossHp(
      resolvedSlug,
      level,
      bossHpData.primes ?? {},
      1
    )
    const prime2Hp = lookupPrimeBossHp(
      resolvedSlug,
      level,
      bossHpData.primes ?? {},
      2
    )
    // A 0 HP lookup drops the encounter; log so name drift shows up.
    if (mainHp <= 0) {
      logger.warn(
        { guildCode, season, bossName, level },
        'getBossLevelTokenPerformance: main boss HP lookup failed'
      )
    }
    if (prime1Hp <= 0) {
      logger.warn(
        { guildCode, season, bossName, level },
        'getBossLevelTokenPerformance: prime1 HP lookup failed'
      )
    }
    if (prime2Hp <= 0) {
      logger.warn(
        { guildCode, season, bossName, level },
        'getBossLevelTokenPerformance: prime2 HP lookup failed'
      )
    }

    // Baseline = sweep-free avg; player = non-sweeps + sweeps clearing GREATEST(player avg, baseline).
    const encounterAgg = new Map<
      number,
      { totalDamage: number; totalAttacks: number; hp: number }
    >()
    encounterAgg.set(0, { totalDamage: 0, totalAttacks: 0, hp: mainHp })
    encounterAgg.set(1, { totalDamage: 0, totalAttacks: 0, hp: prime1Hp })
    encounterAgg.set(2, { totalDamage: 0, totalAttacks: 0, hp: prime2Hp })

    interface PerEncounterBucket {
      total: number
      count: number
      sweepDamages: number[]
      sweepLoopIndices: number[]
      perLoop: Map<number, { total: number; count: number }>
    }
    const perPlayer = new Map<string, Map<number, PerEncounterBucket>>()

    damageRows.forEach((row) => {
      if (!row.displayName || typeof row.encounterId !== 'number') return
      const eid = row.encounterId
      if (eid < 0 || eid > 2) return
      const damage = row.damageDealt ?? 0
      let playerMap = perPlayer.get(row.displayName)
      if (!playerMap) {
        playerMap = new Map()
        perPlayer.set(row.displayName, playerMap)
      }
      const bucket = playerMap.get(eid) ?? {
        total: 0,
        count: 0,
        sweepDamages: [],
        sweepLoopIndices: [],
        perLoop: new Map<number, { total: number; count: number }>()
      }

      const loopIdx = typeof row.loopIndex === 'number' ? row.loopIndex : null

      if (isSweepRow(row)) {
        bucket.sweepDamages.push(damage)
        bucket.sweepLoopIndices.push(loopIdx ?? -1)
      } else {
        const agg = encounterAgg.get(eid)
        if (agg) {
          agg.totalDamage += damage
          agg.totalAttacks += 1
        }
        bucket.total += damage
        bucket.count += 1
        if (includePerLoop && loopIdx !== null) {
          const loopBucket = bucket.perLoop.get(loopIdx) ?? {
            total: 0,
            count: 0
          }
          loopBucket.total += damage
          loopBucket.count += 1
          bucket.perLoop.set(loopIdx, loopBucket)
        }
      }
      playerMap.set(eid, bucket)
    })

    const guildAvgPerEncounter = new Map<number, number | null>()
    const expectedTokensPerEncounter = new Map<number, number | null>()
    encounterAgg.forEach((agg, eid) => {
      if (agg.hp <= 0 || agg.totalDamage <= 0 || agg.totalAttacks <= 0) {
        guildAvgPerEncounter.set(eid, null)
        expectedTokensPerEncounter.set(eid, null)
        return
      }
      const guildAvgDamage = agg.totalDamage / agg.totalAttacks
      guildAvgPerEncounter.set(eid, guildAvgDamage)
      const expected = agg.hp / guildAvgDamage
      expectedTokensPerEncounter.set(
        eid,
        Number.isFinite(expected) && expected > 0 ? expected : null
      )
    })

    perPlayer.forEach((encounterMap) => {
      encounterMap.forEach((bucket, eid) => {
        const baseline = guildAvgPerEncounter.get(eid)
        if (
          baseline === null ||
          baseline === undefined ||
          bucket.sweepDamages.length === 0
        )
          return
        const qualified = qualifyBossLevelSweeps({
          nonSweepDamage: bucket.total,
          nonSweepCount: bucket.count,
          sweepDamages: bucket.sweepDamages,
          referenceAvg: baseline
        })
        bucket.total = qualified.adjustedDamage
        bucket.count = qualified.adjustedCount
        if (includePerLoop) {
          qualified.qualifyingSweepIndices.forEach((index) => {
            const loopIdx = bucket.sweepLoopIndices[index]
            const damage = bucket.sweepDamages[index]
            if (loopIdx !== undefined && loopIdx >= 0 && damage !== undefined) {
              const loopBucket = bucket.perLoop.get(loopIdx) ?? {
                total: 0,
                count: 0
              }
              loopBucket.total += damage
              loopBucket.count += 1
              bucket.perLoop.set(loopIdx, loopBucket)
            }
          })
        }
      })
    })

    const encounterKey = (eid: number): string => {
      const name = eid === 0 ? 'Main' : eid === 1 ? 'Prime1' : 'Prime2'
      return `${name}_${level}`
    }

    const result = new Map<string, Map<string, TokenPerformanceEntry>>()
    perPlayer.forEach((encounterMap, playerName) => {
      if (!activeCurrentPlayers.has(normalizeDisplayName(playerName))) return
      const entry = new Map<string, TokenPerformanceEntry>()

      encounterMap.forEach((data, eid) => {
        if (data.count <= 0) return
        const agg = encounterAgg.get(eid)
        if (!agg || agg.hp <= 0) return

        const expectedTokens = expectedTokensPerEncounter.get(eid) ?? null
        const encounterSkipped =
          eid !== 0 &&
          (officerSkipByEncounter.get(eid) === true ||
            plannerSkippedPrimes.has(eid as 1 | 2))
        const resolved = resolveExpectedTokens({
          officerTargetTokens: officerTargetByEncounter.get(eid) ?? null,
          perBossTokens: expectedTokens,
          perBossSampleCount: agg.totalAttacks,
          guildCohort: null,
          skip: encounterSkipped
        })

        const scored = computePerformanceScoreAggregate({
          actualDamage: data.total,
          tokensSpent: data.count,
          bossHp: agg.hp,
          expectedTokens: resolved.expectedTokens
        })

        const expectedDamage =
          resolved.expectedTokens !== null &&
          resolved.expectedTokens > 0 &&
          agg.hp > 0
            ? data.count * (agg.hp / resolved.expectedTokens)
            : null

        const encounterEntry: TokenPerformanceData[string][string] = {
          score: scored.score,
          tier: resolved.tier,
          tokensSpent: data.count,
          expectedTokens: resolved.expectedTokens,
          actualDamage: data.total,
          expectedDamage
        }

        if (includePerLoop && data.perLoop.size > 0) {
          const perLoop = buildPerLoopEntries(
            data.perLoop.entries(),
            agg.hp,
            resolved.expectedTokens
          )
          if (perLoop) encounterEntry.perLoop = perLoop
        }

        entry.set(encounterKey(eid), encounterEntry)
      })

      if (entry.size > 0) {
        result.set(playerName, entry)
      }
    })

    return materializeBossLevelTokenPerformance(result)
  } catch (err) {
    logger.error(
      { guildCode, season, bossName, level, error: err },
      'getBossLevelTokenPerformance failed'
    )
    return {}
  }
}
