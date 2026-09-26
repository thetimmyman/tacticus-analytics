import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'
import {
  getSeasonConfigForSeasonNumber,
  prettyBossName,
  type SeasonBoss
} from '@/app/lib/loki/season-configs'
import {
  ensureRotationSnapshot,
  type SeasonRotationSnapshot
} from '@/app/lib/loki/rotation-cache'
import { getActiveProgressionConfig } from '@/app/lib/boss-assignments/progression-config'
import {
  nextStage,
  type ProgressionConfig
} from '@/app/lib/boss-assignments/progression-config-shared'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import { type DefeatTransition, type AvailabilityTransition } from './contracts'
import { isPrimeSkipped } from './season-state'

const logger = createComponentLogger('herald')

// A main defeat synthesizes next-stage availability; the (guild, season, boss_id, loop) dedup lets each loop fire.
const findBossInList = (
  bosses: readonly SeasonBoss[] | undefined,
  stageCode: string,
  encounterId: 0 | 1 | 2
): SeasonBoss | null => {
  for (const boss of bosses ?? []) {
    if (boss.encounter_id !== encounterId) continue
    if (deriveStageCodeFromSetAndRarity(boss.set, boss.rarity) !== stageCode)
      continue
    return boss
  }
  return null
}

// Live rotation snapshot first, then the static lineup (the snapshot lacks unfought encounters).
// Lineup prime rows carry the MAIN's boss_type, so prime lookups are existence checks only.
const findRotationBossAtStage = (
  rotationSnapshot: SeasonRotationSnapshot | null,
  stageCode: string,
  encounterId: 0 | 1 | 2,
  seasonNumber: number | null
): SeasonBoss | null => {
  const live = findBossInList(
    rotationSnapshot?.currentBosses,
    stageCode,
    encounterId
  )
  if (live) return live

  if (seasonNumber === null) return null
  const config = getSeasonConfigForSeasonNumber(seasonNumber)
  return findBossInList(config?.bosses, stageCode, encounterId)
}

export const predictAvailabilityFromDefeats = async (
  guildCode: string,
  defeats: DefeatTransition[],
  skippedPrimesBySeason: Map<string, Set<string>>
): Promise<AvailabilityTransition[]> => {
  const mainDefeats = defeats.filter(
    (d) => d.boss_id.endsWith('_E0') && d.set !== null && d.rarity
  )
  if (mainDefeats.length === 0) return []

  let rotationSnapshot: SeasonRotationSnapshot | null = null
  try {
    rotationSnapshot = await ensureRotationSnapshot()
  } catch (err) {
    logger.warn(
      {
        guild_code: guildCode,
        error: err instanceof Error ? err.message : String(err)
      },
      'herald.predict.rotation_load_failed'
    )
  }

  const progressionBySeason = new Map<number, ProgressionConfig | null>()
  const progressionFor = async (
    season: number | null
  ): Promise<ProgressionConfig | null> => {
    if (season === null || !Number.isFinite(season)) return null
    if (!progressionBySeason.has(season)) {
      try {
        progressionBySeason.set(
          season,
          await getActiveProgressionConfig(guildCode, season)
        )
      } catch (err) {
        logger.warn(
          {
            guild_code: guildCode,
            season,
            error: err instanceof Error ? err.message : String(err)
          },
          'herald.predict.progression_load_failed'
        )
        progressionBySeason.set(season, null)
      }
    }
    return progressionBySeason.get(season) ?? null
  }

  const out: AvailabilityTransition[] = []
  const seen = new Set<string>()
  for (const defeat of mainDefeats) {
    if (defeat.set === null) continue
    const stageOfDefeat = deriveStageCodeFromSetAndRarity(
      defeat.set,
      defeat.rarity
    )
    const progressionConfig = await progressionFor(defeat.season)
    if (!progressionConfig) continue
    let next: ReturnType<typeof nextStage>
    try {
      next = nextStage(progressionConfig, stageOfDefeat, defeat.loop_index)
    } catch (err) {
      logger.warn(
        {
          guild_code: guildCode,
          season: defeat.season,
          stage_code: stageOfDefeat,
          loop_index: defeat.loop_index,
          error: err instanceof Error ? err.message : String(err)
        },
        'herald.predict.progression_stage_invalid'
      )
      continue
    }
    const nextStageCode = next.stageCode
    const nextLoopIndex = next.loopIndex

    // Announce primes only; the main posts once primes are cleared (or now if both are skipped).
    const seasonStr = String(defeat.season ?? 0)
    const skipped = skippedPrimesBySeason.get(seasonStr)

    // Prime ids use the main's boss_type (`<MainBossType>_E<n>`); the prime's own name matches no table.
    const mainBoss = findRotationBossAtStage(
      rotationSnapshot,
      nextStageCode,
      0,
      defeat.season
    )
    if (!mainBoss) {
      logger.warn(
        {
          guild_code: guildCode,
          season: defeat.season,
          stage: nextStageCode,
          encounter_index: 0
        },
        'herald.predict.stage_boss_missing'
      )
      continue
    }
    const mainBossType = mainBoss.boss_type

    const sub1Skipped = isPrimeSkipped(skipped, mainBossType, nextStageCode, 1)
    const sub2Skipped = isPrimeSkipped(skipped, mainBossType, nextStageCode, 2)
    const allPrimesSkipped = sub1Skipped && sub2Skipped

    const encIdsToEmit: Array<0 | 1 | 2> = allPrimesSkipped
      ? [0]
      : ([1, 2] as const).filter((enc) =>
          enc === 1 ? !sub1Skipped : !sub2Skipped
        )

    for (const encId of encIdsToEmit) {
      const boss = findRotationBossAtStage(
        rotationSnapshot,
        nextStageCode,
        encId,
        defeat.season
      )
      if (!boss) {
        logger.warn(
          {
            guild_code: guildCode,
            season: defeat.season,
            stage: nextStageCode,
            encounter_index: encId
          },
          'herald.predict.stage_boss_missing'
        )
        continue
      }
      const transition: AvailabilityTransition = {
        boss_id: `${mainBossType}_E${encId}`,
        boss_type: mainBossType,
        boss_display_name: prettyBossName(mainBossType),
        rarity: mainBoss.rarity,
        tier: defeat.tier,
        set: mainBoss.set,
        encounter_index: encId,
        season: defeat.season ?? 0,
        loop_index: nextLoopIndex
      }
      const dedupKey = `${transition.season}|${transition.boss_id}|${transition.loop_index}`
      if (seen.has(dedupKey)) continue
      seen.add(dedupKey)
      out.push(transition)
    }
  }
  return out
}

export const predictMainAvailableAfterPrimesCleared = async (
  guildCode: string,
  defeats: DefeatTransition[],
  skippedPrimesBySeason: Map<string, Set<string>>,
  supabase: SupabaseClient
): Promise<AvailabilityTransition[]> => {
  const primeDefeats = defeats.filter(
    (d) => !d.boss_id.endsWith('_E0') && d.set !== null && d.rarity
  )
  if (primeDefeats.length === 0) return []

  const out: AvailabilityTransition[] = []
  const seen = new Set<string>()
  for (const defeat of primeDefeats) {
    if (defeat.set === null) continue
    const stageCode = deriveStageCodeFromSetAndRarity(defeat.set, defeat.rarity)
    const seasonStr = String(defeat.season ?? 0)
    const skipped = skippedPrimesBySeason.get(seasonStr)
    // Prime defeats carry the MAIN boss_type, which keys token-skip.
    const sub1Skipped = isPrimeSkipped(skipped, defeat.boss_type, stageCode, 1)
    const sub2Skipped = isPrimeSkipped(skipped, defeat.boss_type, stageCode, 2)

    const primesToCheck: Array<1 | 2> = []
    if (!sub1Skipped) primesToCheck.push(1)
    if (!sub2Skipped) primesToCheck.push(2)
    if (primesToCheck.length === 0) continue // both skipped — main was already emitted by stage-unlock predictor

    const dedupKey = `${seasonStr}|${defeat.boss_type}_E0|${defeat.loop_index}`
    if (seen.has(dedupKey)) continue

    // `.order()` stays despite <= 2 rows: the lint guard requires it.
    const { data: rows, error } = await supabase
      .from('EOT_GR_data')
      .select('encounterIndex')
      .eq('Guild', guildCode)
      .eq('type', defeat.boss_type)
      .eq('Season', seasonStr)
      .eq('set', defeat.set)
      .eq('loopIndex', defeat.loop_index)
      .eq('remainingHp', 0)
      .in('encounterIndex', primesToCheck)
      .order('encounterIndex', { ascending: true })

    if (error) {
      logger.warn(
        {
          guild_code: guildCode,
          boss_type: defeat.boss_type,
          stage: stageCode,
          loop_index: defeat.loop_index,
          error: error.message
        },
        'herald.predict.main.primes_query_error'
      )
      continue
    }

    const deadPrimes = new Set(
      (rows ?? []).map(
        (r) => (r as { encounterIndex: number | null }).encounterIndex
      )
    )
    const allPrimesDead = primesToCheck.every((p) => deadPrimes.has(p))
    if (!allPrimesDead) continue

    seen.add(dedupKey)
    out.push({
      boss_id: `${defeat.boss_type}_E0`,
      boss_type: defeat.boss_type,
      boss_display_name: prettyBossName(defeat.boss_type),
      rarity: defeat.rarity,
      tier: defeat.tier,
      set: defeat.set,
      encounter_index: 0,
      season: defeat.season ?? 0,
      loop_index: defeat.loop_index
    })
  }

  return out
}
