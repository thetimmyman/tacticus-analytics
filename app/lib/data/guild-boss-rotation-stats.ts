import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { getAllBossHp, lookupBossHpByName } from '@/app/lib/data/boss-hp'
import { lookupPrimeBossHp } from '@/app/lib/data/prime-boss-hp'
import { getBossCombatMetricsForEncounter } from '@/app/lib/dashboard/boss-metrics'
import {
  getSeasonConfigById,
  getSeasonConfigIdForOffset
} from '@/app/lib/loki/season-configs'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('lib.data.guild-boss-rotation-stats')

export interface BossRotationStatEntry {
  bossHp: number | null
  avgDamagePerHit: number | null
  avgTokensPerLoop: number | null
  tokensLastLoop: number | null
}

export type BossRotationStatsByKey = Record<string, BossRotationStatEntry>

/** Unattacked slots get null fields, never a historical fallback. */
export async function getCurrentRotationBossStats(
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string
): Promise<BossRotationStatsByKey> {
  if (!guildCode || !season) return {}

  try {
    const currentConfig = getSeasonConfigById(getSeasonConfigIdForOffset(0).id)
    const slots = currentConfig.bosses.filter(
      (b) => b.rarity === 'Legendary' || b.rarity === 'Mythic'
    )
    if (slots.length === 0) return {}

    const bossHpData = await getAllBossHp(guildCode)
    const byBossName = bossHpData.byBossName ?? {}
    const primes = bossHpData.primes ?? {}

    const entries = await Promise.all(
      slots.map(async (slot) => {
        const rarity = slot.rarity as 'Legendary' | 'Mythic'
        const setOneIndexed = slot.set + 1
        const level = `${rarity === 'Mythic' ? 'M' : 'L'}${setOneIndexed}`
        const bossHp =
          slot.encounter_id === 0
            ? lookupBossHpByName(
                slot.boss_type,
                `${slot.boss_type}_${level}`,
                byBossName
              )
            : lookupPrimeBossHp(
                slot.boss_type,
                level,
                primes,
                slot.encounter_id as 1 | 2
              )

        const metrics = await getBossCombatMetricsForEncounter(
          supabase,
          guildCode,
          season,
          slot.encounter_id,
          slot.set,
          rarity
        )

        const key = `${slot.boss_type}__${rarity}__${setOneIndexed}__${slot.encounter_id}`
        const entry: BossRotationStatEntry = {
          bossHp: bossHp > 0 ? bossHp : null,
          avgDamagePerHit: metrics?.averageDamagePerHit ?? null,
          avgTokensPerLoop: metrics?.averageTokensToKill ?? null,
          tokensLastLoop: metrics?.previousLoopTokens ?? null
        }
        return [key, entry] as const
      })
    )

    const result: BossRotationStatsByKey = {}
    entries.forEach(([key, entry]) => {
      result[key] = entry
    })
    return result
  } catch (err) {
    logger.error(
      { guildCode, season, error: err },
      'getCurrentRotationBossStats failed'
    )
    return {}
  }
}
