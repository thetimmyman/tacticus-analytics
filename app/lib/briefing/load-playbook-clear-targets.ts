/** Same HP resolvers as the officer target-tokens table so the numbers agree. */

import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { getAllBossHp, lookupBossHpByName } from '@/app/lib/data/boss-hp'
import { lookupPrimeBossHp } from '@/app/lib/data/prime-boss-hp'
import {
  getSeasonConfigById,
  getSeasonConfigIdForOffset
} from '@/app/lib/loki/season-configs'
import { columnsToRaritySet } from '@/app/lib/catalogs/rarity-set'
import {
  selectSeasonScoped,
  isTargetNoDataSentinel,
  LEGACY_SEASON
} from '@/app/lib/boss-assignments/target-token-season'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('briefing.playbook-clear-targets')

const HELPER_TIMEOUT_MS = 1500

export interface PlaybookClearTarget {
  requiredDpt: number
  targetTokens: number
  bossHp: number
}

/** rarity_set is needed: one season can have the same boss as both an L4 and an M2 main. */
export type PlaybookClearTargetsByKey = Map<string, PlaybookClearTarget>

interface TargetTokenRow {
  boss_name: string
  rarity: string
  set: number
  target_tokens: number
  season_number: string | null
  encounter_id: number
  skip: boolean | null
  source: string | null
  seeded_from_seasons: string | null
}

async function resolvePlaybookClearTargets(
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string
): Promise<PlaybookClearTargetsByKey> {
  try {
    // A non-current `season` resolves nothing rather than wrong numbers.
    const currentConfig = getSeasonConfigById(getSeasonConfigIdForOffset(0).id)
    const slots = currentConfig.bosses.filter(
      (b) =>
        (b.rarity === 'Legendary' || b.rarity === 'Mythic') &&
        b.set >= 0 &&
        (b.encounter_id === 0 || b.encounter_id === 1 || b.encounter_id === 2)
    )
    if (slots.length === 0) return new Map()

    /* eslint-disable @typescript-eslint/no-explicit-any, no-restricted-syntax */
    const { data: rawTargets } = await (
      supabase.from('boss_target_tokens' as never) as any
    )
      /* eslint-enable @typescript-eslint/no-explicit-any, no-restricted-syntax */
      .select(
        'boss_name, rarity, set, target_tokens, season_number, encounter_id, skip, source, seeded_from_seasons'
      )
      .eq('guild_code', guildCode)
      .in('season_number', [season, LEGACY_SEASON])
      .in('encounter_id', [0, 1, 2])

    // Skip rows shadow legacy targets; no-data sentinels neither feed nor shadow one.
    const candidateRows = (
      (rawTargets as TargetTokenRow[] | null) ?? []
    ).filter(
      (row) => !isTargetNoDataSentinel(row.source, row.seeded_from_seasons)
    )

    const scopedTargets = selectSeasonScoped(
      candidateRows,
      season,
      (row) =>
        `${row.boss_name}_${row.rarity === 'Mythic' ? 'M' : 'L'}${row.set}_${row.encounter_id ?? 0}`
    )
    if (scopedTargets.size === 0) return new Map()

    const hasPrimeSlots = slots.some((s) => s.encounter_id !== 0)
    const nameBySlugEncounter = new Map<string, string>()
    if (hasPrimeSlots) {
      const { data: mappingRows } = await supabase
        .from('boss_mapping')
        .select('boss_type, encounter_index, boss_name')
      for (const m of (mappingRows as Array<{
        boss_type: string
        encounter_index: number
        boss_name: string
      }> | null) ?? []) {
        if (m?.boss_type && m?.boss_name != null) {
          nameBySlugEncounter.set(
            `${m.boss_type}::${m.encounter_index}`,
            m.boss_name
          )
        }
      }
    }

    const bossHpData = await getAllBossHp(guildCode)
    const byBossName = bossHpData.byBossName ?? {}
    const primes = bossHpData.primes ?? {}

    const out: PlaybookClearTargetsByKey = new Map()
    for (const slot of slots) {
      const raritySet = columnsToRaritySet(slot.rarity, slot.set)
      if (!raritySet) continue
      const level = raritySet

      const targetKey = `${slot.boss_type}_${level}_${slot.encounter_id}`
      let target = scopedTargets.get(targetKey)
      if (!target && slot.encounter_id !== 0) {
        const loreName = nameBySlugEncounter.get(
          `${slot.boss_type}::${slot.encounter_id}`
        )
        if (loreName && loreName !== slot.boss_type) {
          target = scopedTargets.get(
            `${loreName}_${level}_${slot.encounter_id}`
          )
        }
      }
      if (!target || target.skip === true || target.target_tokens <= 0) continue

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
      if (bossHp <= 0) continue

      // Must match get_player_boss_performance: raw type for mains, lore name for primes.
      const bossName =
        slot.encounter_id === 0
          ? slot.boss_type
          : (nameBySlugEncounter.get(
              `${slot.boss_type}::${slot.encounter_id}`
            ) ?? slot.boss_type)
      out.set(`${bossName}::${slot.encounter_id}::${raritySet}`, {
        requiredDpt: bossHp / target.target_tokens,
        targetTokens: target.target_tokens,
        bossHp
      })
    }

    return out
  } catch (err) {
    logger.warn(
      {
        guildCode,
        season,
        error: err instanceof Error ? err.message : String(err)
      },
      'playbook clear targets unavailable'
    )
    return new Map()
  }
}

/** Times out before the outer loader's 4s race. */
export async function loadPlaybookClearTargets(
  supabase: TypedSupabaseClient,
  guildCode: string,
  season: string
): Promise<PlaybookClearTargetsByKey> {
  if (!guildCode || !season) return new Map()
  const timeout = new Promise<PlaybookClearTargetsByKey>((resolve) =>
    setTimeout(() => resolve(new Map()), HELPER_TIMEOUT_MS)
  )
  return Promise.race([
    resolvePlaybookClearTargets(supabase, guildCode, season),
    timeout
  ])
}
