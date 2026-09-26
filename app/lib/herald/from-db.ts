import 'server-only'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'
import {
  createEmptyHeraldRunResult,
  runHeraldForSync,
  type HeraldBattle,
  type HeraldRunResult
} from './engine'

const logger = createComponentLogger('herald.from-db')

// Buffer over the 15-min defeat window; availability dedups, so extra is safe.
const DEFAULT_LOOKBACK_MS = 30 * 60 * 1000

export interface RunHeraldFromDbParams {
  supabase: SupabaseClient
  guildCode: string
  lookbackMs?: number
  nowMs?: number
}

const stringOrNull = (value: unknown): string | null =>
  typeof value === 'string' ? value : null

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' ? value : null

const numberOrStringOrNull = (value: unknown): number | string | null =>
  typeof value === 'number' || typeof value === 'string' ? value : null

/** Feeds recent EOT_GR_data rows from the DB to runHeraldForSync; unique constraints make reruns safe. */
export async function runHeraldFromDb(
  params: RunHeraldFromDbParams
): Promise<HeraldRunResult> {
  const {
    supabase,
    guildCode,
    lookbackMs = DEFAULT_LOOKBACK_MS,
    nowMs = Date.now()
  } = params
  const sinceIso = new Date(nowMs - lookbackMs).toISOString()

  const { data: rows, error } = await supabase
    .from('EOT_GR_data')
    .select(
      'type, encounterIndex, completedOn, remainingHp, maxHp, rarity, userId, displayName, tier, set, Season, loopIndex'
    )
    .eq('Guild', guildCode)
    .gte('completedOn', sinceIso)
    .order('completedOn', { ascending: true })

  if (error) {
    logger.error(
      { guildCode, err: error.message },
      'herald.from-db.fetch_failed'
    )
    return createEmptyHeraldRunResult('', 'db_fetch_failed')
  }

  if (!rows || rows.length === 0) {
    return createEmptyHeraldRunResult()
  }

  const allBattles: HeraldBattle[] = rows.map((r: Record<string, unknown>) => ({
    type: stringOrNull(r.type),
    encounterIndex: numberOrStringOrNull(r.encounterIndex),
    completedOn:
      typeof r.completedOn === 'string'
        ? new Date(r.completedOn).getTime()
        : null,
    remainingHp: numberOrNull(r.remainingHp),
    maxHp: numberOrNull(r.maxHp),
    rarity: stringOrNull(r.rarity),
    userId: stringOrNull(r.userId),
    displayName: stringOrNull(r.displayName),
    tier: numberOrStringOrNull(r.tier),
    set: numberOrStringOrNull(r.set),
    Season: numberOrStringOrNull(r.Season),
    loopIndex: numberOrStringOrNull(r.loopIndex)
  }))

  const battles = allBattles.filter((b) => b.remainingHp === 0)

  return runHeraldForSync({
    supabase,
    guildCode,
    battles,
    allBattles,
    nowMs
  })
}
