import 'server-only'

import {
  getSeasonConfigById,
  getSeasonConfigForSeasonNumber,
  getSeasonConfigIdForOffset
} from '@/app/lib/loki/season-configs'
import {
  difficultyCodeFromOneBasedSet,
  heraldBossId,
  targetsRowKey,
  type EncounterId
} from '@/app/lib/boss-ops/identity'
import { resolveEncounterOps } from '@/app/lib/boss-ops/encounter-ops-merge'
import type {
  EncounterOpsEntry,
  EncounterOpsSlice
} from '@/app/lib/boss-ops/encounter-ops-merge'
import {
  loadHeraldConfigsByBossId,
  loadSeasonOpsBySlot,
  seasonalOpsKey
} from '@/app/lib/boss-ops/load-encounter-ops'

// Ops read for the Targets page; not loadSeasonalBossHubData (different window, flagged, too
// heavy). Keys use `targetsRowKey` (1-based `set`) like TargetsClient.mergedRows.

interface RotationSlot {
  bossType: string
  rarity: 'Legendary' | 'Mythic'
  /** 1-based; `season-configs` stores `set` 0-indexed. */
  set: number
  encounterId: EncounterId
}

/** Resolved like the target-tokens schedule route (lineup, then rotation math) so keys match. */
function seasonRotationSlots(seasonNumber: number): RotationSlot[] {
  const current = getSeasonConfigIdForOffset(0)
  const config =
    getSeasonConfigForSeasonNumber(seasonNumber) ??
    getSeasonConfigById(
      getSeasonConfigIdForOffset(seasonNumber - current.seasonNumber).id
    )

  const slots: RotationSlot[] = []
  for (const boss of config.bosses) {
    // Target tokens cover Guild Raid tiers only.
    if (boss.rarity !== 'Legendary' && boss.rarity !== 'Mythic') continue
    const encounterId = boss.encounter_id
    if (encounterId !== 0 && encounterId !== 1 && encounterId !== 2) continue
    const setOneBased = boss.set + 1
    if (!Number.isInteger(setOneBased) || setOneBased < 1) continue
    slots.push({
      bossType: boss.boss_type,
      rarity: boss.rarity,
      set: setOneBased,
      encounterId
    })
  }
  return slots
}

export interface LoadTargetsOpsSliceOptions {
  guildCode: string | null | undefined
  seasonNumber: number
  /** Officer gate; members get an empty slice with `loadFailed` false: not loaded, not failed. */
  enabled: boolean
}

export async function loadTargetsOpsSlice({
  guildCode,
  seasonNumber,
  enabled
}: LoadTargetsOpsSliceOptions): Promise<EncounterOpsSlice> {
  if (!enabled || !guildCode || !Number.isFinite(seasonNumber)) {
    return { seasonNumber, byKey: {}, loadFailed: false }
  }

  const [herald, seasonOps] = await Promise.all([
    loadHeraldConfigsByBossId(guildCode, true),
    loadSeasonOpsBySlot(guildCode, [seasonNumber], true)
  ])

  // Either read failing makes the whole slice untrustworthy (hidden roles, fabricated
  // 'kill'); one flag so consumers cannot leave the dangerous half editable.
  const loadFailed = herald.loadFailed || seasonOps.loadFailed

  const byKey: Record<string, EncounterOpsEntry> = {}
  for (const slot of seasonRotationSlots(seasonNumber)) {
    const difficultyCode = difficultyCodeFromOneBasedSet(slot.rarity, slot.set)
    const bossId = heraldBossId(slot.bossType, slot.encounterId)
    const resolved = resolveEncounterOps({
      encounterId: slot.encounterId,
      seasonOps:
        seasonOps.bySlot[seasonalOpsKey({ seasonNumber, difficultyCode })] ??
        null,
      heraldConfig: herald.byBossId[bossId] ?? null
    })
    const key = targetsRowKey(slot)
    byKey[key] = {
      key,
      bossType: slot.bossType,
      rarity: slot.rarity,
      set: slot.set,
      encounterId: slot.encounterId,
      difficultyCode,
      heraldBossId: bossId,
      ...resolved
    }
  }

  return { seasonNumber, byKey, loadFailed }
}
