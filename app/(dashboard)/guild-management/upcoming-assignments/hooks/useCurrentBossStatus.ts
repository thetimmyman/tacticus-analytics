'use client'

import { dbClient } from '@/app/lib/db/client'
import { useBaseQuery } from '@/app/lib/hooks/shared'
import { createComponentLogger } from '@/app/lib/logging/client'
const logger = createComponentLogger(
  'guild-management.upcoming-assignments.hooks.useCurrentBossStatus'
)
import {
  computeStageFromMainEncounter,
  deriveStageCodeFromSetAndRarity
} from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import type { BossStatusRow } from '@/app/lib/data/boss-status-shared'
import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'

export type CurrentBossStatus = {
  // stageCode/loopIndex fall back to truthy 'M1'/0, so gate the no-data placeholder on this.
  hasData: boolean
  snapshotAt: string
  stageCode: string
  loopIndex: number
  advancedStage: boolean
  remainingHp: number | null
  maxHp: number | null
  bossNameFromData: string | null
  encounters: Array<{
    encounterId: 0 | 1 | 2
    bossName: string | null
    remainingHp: number | null
    maxHp: number | null
  }>
}

async function fetchCurrentBossStatus(args: {
  guildCode: string
  seasonNumber: string
  progressionConfig: ProgressionConfig | null
}): Promise<CurrentBossStatus> {
  const fetchedAt = new Date().toISOString()
  const supabase = dbClient()

  const { data, error } = await supabase.rpc('get_current_boss_status', {
    p_guild_code: args.guildCode,
    p_season: args.seasonNumber
  })

  if (error) {
    logger.warn({ error: error.message }, 'Failed to fetch current boss status')
  }

  const rows: BossStatusRow[] = Array.isArray(data)
    ? (data as BossStatusRow[])
    : []
  const mainRow = rows.find((row) => (row.encounter_id ?? 0) === 0) ?? null

  const setValue =
    typeof mainRow?.set === 'number' && Number.isFinite(mainRow.set)
      ? Math.max(0, Math.trunc(mainRow.set))
      : 0
  const rarity = typeof mainRow?.rarity === 'string' ? mainRow.rarity : 'Mythic'
  const stageCode =
    typeof mainRow?.rarity === 'string' && typeof mainRow.set === 'number'
      ? deriveStageCodeFromSetAndRarity(setValue, rarity)
      : 'M1'

  const loopIndex =
    typeof mainRow?.loop_index === 'number' &&
    Number.isFinite(mainRow.loop_index)
      ? Math.max(0, Math.trunc(mainRow.loop_index))
      : 0

  const parseHp = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }

  const maxHp = parseHp(mainRow?.max_hp)

  const remainingHpRaw = parseHp(mainRow?.remaining_hp)

  const remainingHp =
    remainingHpRaw ??
    (typeof maxHp === 'number' && Number.isFinite(maxHp) && maxHp > 0
      ? 0
      : null)

  let computedStage = { stageCode, loopIndex, advancedStage: false }
  if (args.progressionConfig) {
    try {
      computedStage = computeStageFromMainEncounter(
        {
          rarity: mainRow?.rarity ?? rarity,
          set: setValue,
          loopIndex,
          remainingHp
        },
        args.progressionConfig
      )
    } catch (error) {
      logger.warn(
        {
          error: error instanceof Error ? error.message : String(error),
          stageCode,
          loopIndex
        },
        'Progression config does not cover the observed boss stage'
      )
    }
  }

  const encounters: CurrentBossStatus['encounters'] = [
    {
      encounterId: 0,
      bossName:
        typeof mainRow?.boss_name === 'string' ? mainRow.boss_name : null,
      remainingHp: computedStage.advancedStage ? null : remainingHp,
      maxHp: computedStage.advancedStage ? null : maxHp
    }
  ]

  if (
    !computedStage.advancedStage &&
    typeof mainRow?.rarity === 'string' &&
    typeof mainRow.set === 'number'
  ) {
    // Same RPC rows (the current main's rarity/set/loop); a separate query could drift.
    for (const encounterId of [1, 2] as const) {
      const row =
        rows.find((r) => (r.encounter_id ?? 0) === encounterId) ?? null
      // The RPC returns NULLIF(remainingHp, 0), so a defeated prime arrives null; lifecycle_state
      // recovers 0 and also beats a stale positive HP from an out-of-order bomb row.
      const remainingHp =
        row?.lifecycle_state === 'defeated' ? 0 : parseHp(row?.remaining_hp)
      encounters.push({
        encounterId,
        bossName: typeof row?.boss_name === 'string' ? row.boss_name : null,
        remainingHp,
        maxHp: parseHp(row?.max_hp)
      })
    }
  }

  return {
    hasData: mainRow !== null,
    snapshotAt: mainRow?.completed_on ?? fetchedAt,
    stageCode: computedStage.stageCode || stageCode,
    loopIndex: computedStage.loopIndex,
    advancedStage: computedStage.advancedStage,
    remainingHp: computedStage.advancedStage ? null : remainingHp,
    maxHp: computedStage.advancedStage ? null : maxHp,
    bossNameFromData: computedStage.advancedStage
      ? null
      : (mainRow?.boss_name ?? null),
    encounters
  }
}

export function useCurrentBossStatus(args: {
  guildCode: string
  seasonNumber: string
  progressionConfig: ProgressionConfig | null
  enabled: boolean
}) {
  return useBaseQuery({
    queryKey: [
      'boss-assignments-current-boss-status',
      args.guildCode,
      args.seasonNumber,
      args.progressionConfig
    ],
    queryFn: () =>
      fetchCurrentBossStatus({
        guildCode: args.guildCode,
        seasonNumber: args.seasonNumber,
        progressionConfig: args.progressionConfig
      }),
    enabled: args.enabled,
    cacheDuration: 15 * 1000
  })
}
