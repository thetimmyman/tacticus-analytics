/** Each signal degrades to `null`; bomb range is computed live since breach rows leak across stages. */

import { getCurrentBossStatusWithLifecycle } from '@/app/lib/data/boss-status'
import { computeLiveBombRangeEncounters } from '@/app/lib/briefing/herald-bomb-range'
import { db, serviceDb } from '@/app/lib/db'
import {
  DEFAULT_BOMB_CALCULATION_MODE,
  bombDamagePerBomb,
  isBombCalculationMode
} from '@/app/lib/tacticus/bomb-damage'
import { createComponentLogger } from '@/app/lib/logging'

const logger = createComponentLogger('briefing.next-move-signals')

const DEFAULT_OVERKILL_THRESHOLD = 0.8

export interface NextMoveSignals {
  mainWarded: boolean | null
  bombDamagePerBomb: number | null
  guildBombsAvailable: number | null
  /**
   * `[]` is an authoritative "no"; `null` = inputs unavailable. The service-role RPC is
   * safe here: caller's own guild only, aggregate integers only.
   */
  bombRangeEncounterIds: number[] | null
}

const EMPTY: NextMoveSignals = {
  mainWarded: null,
  bombDamagePerBomb: null,
  guildBombsAvailable: null,
  bombRangeEncounterIds: null
}

interface LoadArgs {
  guildCode: string | undefined
  season: string
}

interface BombConfig {
  bombDamagePerBomb: number | null
  overkillThreshold: number
}

interface BossSignals {
  mainWarded: boolean | null
  bombRangeEncounterIds: number[] | null
}

async function loadGuildBombsAvailable(
  guildCode: string
): Promise<number | null> {
  try {
    const supabase = serviceDb()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- get_guild_bombs_available is ahead of generated DB types
    const { data, error } = await (supabase.rpc as any)(
      'get_guild_bombs_available',
      { p_guild_code: guildCode }
    )
    if (error) {
      logger.warn(
        { error: error.message },
        'next-move: guild bombs lookup failed'
      )
      return null
    }
    const row = Array.isArray(data) ? data[0] : data
    const bombs = row?.bombs_available
    return typeof bombs === 'number' && Number.isFinite(bombs) ? bombs : null
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'next-move: guild bombs lookup threw'
    )
    return null
  }
}

async function loadBossSignals(
  args: LoadArgs,
  config: BombConfig,
  guildBombsAvailable: number | null
): Promise<BossSignals> {
  if (!args.guildCode) return { mainWarded: null, bombRangeEncounterIds: null }
  try {
    const rows = await getCurrentBossStatusWithLifecycle(
      args.guildCode,
      args.season
    )
    const main = rows.find((r) => r.encounter_id === 0)
    const mainWarded = main ? Boolean(main.warded) : null
    const alive = rows.filter((r) => (r.remaining_hp ?? 0) > 0)

    const bombRangeEncounterIds =
      config.bombDamagePerBomb != null && guildBombsAvailable != null
        ? computeLiveBombRangeEncounters(
            alive,
            config.bombDamagePerBomb,
            guildBombsAvailable,
            config.overkillThreshold
          )
        : null

    if (bombRangeEncounterIds && bombRangeEncounterIds.length > 0) {
      logger.info(
        {
          guildCode: args.guildCode,
          season: args.season,
          bombRangeEncounterIds,
          guildBombsAvailable,
          bombDamagePerBomb: config.bombDamagePerBomb
        },
        'next-move: bomb-range flags active'
      )
    }
    return { mainWarded, bombRangeEncounterIds }
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'next-move: boss-status lookup failed'
    )
    return { mainWarded: null, bombRangeEncounterIds: null }
  }
}

async function loadBombConfig(args: LoadArgs): Promise<BombConfig> {
  const fallback: BombConfig = {
    bombDamagePerBomb: null,
    overkillThreshold: DEFAULT_OVERKILL_THRESHOLD
  }
  if (!args.guildCode) return fallback
  try {
    const supabase = await db()
    const { data, error } = await supabase
      .from('guild_config')
      .select(
        'guild_level, bomb_alert_calculation_mode, bomb_alert_overkill_threshold'
      )
      .eq('guild_code', args.guildCode)
      .maybeSingle()
    if (error) {
      logger.warn(
        { error: error.message },
        'next-move: guild_config bomb lookup failed'
      )
      return fallback
    }
    if (!data) return fallback
    // Same defaults as the Herald bomb-range alert.
    const level = typeof data.guild_level === 'number' ? data.guild_level : null
    const mode = isBombCalculationMode(data.bomb_alert_calculation_mode)
      ? data.bomb_alert_calculation_mode
      : DEFAULT_BOMB_CALCULATION_MODE
    const thresholdRaw = data.bomb_alert_overkill_threshold
    const threshold =
      typeof thresholdRaw === 'number' && thresholdRaw > 0 && thresholdRaw <= 1
        ? thresholdRaw
        : typeof thresholdRaw === 'string' &&
            Number.isFinite(Number.parseFloat(thresholdRaw))
          ? Number.parseFloat(thresholdRaw)
          : DEFAULT_OVERKILL_THRESHOLD
    return {
      bombDamagePerBomb: bombDamagePerBomb(level, mode),
      overkillThreshold:
        threshold > 0 && threshold <= 1 ? threshold : DEFAULT_OVERKILL_THRESHOLD
    }
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      'next-move: guild_config bomb lookup threw'
    )
    return fallback
  }
}

async function loadNextMoveSignals(args: LoadArgs): Promise<NextMoveSignals> {
  if (!args.guildCode || !args.season) return EMPTY
  const [config, guildBombsAvailable] = await Promise.all([
    loadBombConfig(args),
    loadGuildBombsAvailable(args.guildCode)
  ])
  const bossSignals = await loadBossSignals(args, config, guildBombsAvailable)
  return {
    ...bossSignals,
    bombDamagePerBomb: config.bombDamagePerBomb,
    guildBombsAvailable
  }
}

export async function loadNextMoveSignalsWithTimeout(
  args: LoadArgs,
  timeoutMs = 3000
): Promise<NextMoveSignals> {
  const timeout = new Promise<NextMoveSignals>((resolve) =>
    setTimeout(() => resolve(EMPTY), timeoutMs)
  )
  return Promise.race([loadNextMoveSignals(args).catch(() => EMPTY), timeout])
}
