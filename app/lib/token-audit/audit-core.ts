// Pure helpers comparing live Tacticus token state (ground truth) with our estimators.

import {
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'

export const AUDIT_MODES = ['daily', 'rollover'] as const
export type AuditMode = (typeof AUDIT_MODES)[number]

export const ROLLOVER_WINDOW_HOURS = 36
export const DAILY_MIN_SPACING_HOURS = 20

/** Null skips this run. Two rollover anchors: the calendar start covers the pre-first-battle window,
 * the first battle covers guilds with a missing or stale calendar entry. */
export function decideAuditMode(args: {
  now: Date
  seasonStartAt: Date | null
  seasonFirstBattleAt: Date | null
  lastDailyRunAt: Date | null
}): AuditMode | null {
  const { now, seasonStartAt, seasonFirstBattleAt, lastDailyRunAt } = args
  for (const anchor of [seasonStartAt, seasonFirstBattleAt]) {
    if (!anchor) continue
    const seasonAgeHours = (now.getTime() - anchor.getTime()) / 3_600_000
    if (seasonAgeHours >= 0 && seasonAgeHours < ROLLOVER_WINDOW_HOURS) {
      return 'rollover'
    }
  }
  if (
    lastDailyRunAt &&
    now.getTime() - lastDailyRunAt.getTime() <
      DAILY_MIN_SPACING_HOURS * 3_600_000
  ) {
    return null
  }
  return 'daily'
}

export interface LiveTokenReading {
  current: number
  max: number
  nextTokenInSeconds: number | null
  regenDelayInSeconds: number
}

export interface EstimatorReading {
  tokensAvailable: number | null
  tokenNextSeconds: number | null
}

export interface AuditRow {
  guild_code: string
  player_id: string
  display_name: string
  season: string
  mode: AuditMode
  live_tokens: number
  live_tokens_max: number
  live_token_next_seconds: number | null
  live_regen_delay_seconds: number
  live_bombs: number | null
  live_bomb_next_seconds: number | null
  live_bomb_regen_delay_seconds: number | null
  replay_tokens: number | null
  replay_token_next_seconds: number | null
  rpc_tokens: number | null
  rpc_token_next_seconds: number | null
  rpc_data_source: string | null
  /** OMIT the key (not null) until the RPC and table have the column, or the insert fails. */
  rpc_post_snapshot_spends?: number | null
  cpta_tokens: number | null
  battle_rows_seen: number
  replay_tokens_delta: number | null
  rpc_tokens_delta: number | null
  cpta_tokens_delta: number | null
  constants_ok: boolean
}

/** Deltas are estimator − live (negative = undercount). */
export function buildAuditRow(args: {
  guildCode: string
  playerId: string
  displayName: string
  season: string
  mode: AuditMode
  live: LiveTokenReading
  liveBombs: LiveTokenReading | null
  replay: EstimatorReading | null
  rpc: (EstimatorReading & { dataSource: string | null }) | null
  cptaTokens: number | null
  /** undefined omits the key; decide once per run, since batch-inserted rows share a key shape. */
  rpcPostSnapshotSpends?: number | null
  battleRowsSeen: number
}): AuditRow {
  const { live } = args
  const row: AuditRow = {
    guild_code: args.guildCode,
    player_id: args.playerId,
    display_name: args.displayName,
    season: args.season,
    mode: args.mode,
    live_tokens: live.current,
    live_tokens_max: live.max,
    live_token_next_seconds: live.nextTokenInSeconds,
    live_regen_delay_seconds: live.regenDelayInSeconds,
    live_bombs: args.liveBombs?.current ?? null,
    live_bomb_next_seconds: args.liveBombs?.nextTokenInSeconds ?? null,
    live_bomb_regen_delay_seconds: args.liveBombs?.regenDelayInSeconds ?? null,
    replay_tokens: args.replay?.tokensAvailable ?? null,
    replay_token_next_seconds: args.replay?.tokenNextSeconds ?? null,
    rpc_tokens: args.rpc?.tokensAvailable ?? null,
    rpc_token_next_seconds: args.rpc?.tokenNextSeconds ?? null,
    rpc_data_source: args.rpc?.dataSource ?? null,
    cpta_tokens: args.cptaTokens,
    battle_rows_seen: args.battleRowsSeen,
    replay_tokens_delta:
      args.replay?.tokensAvailable != null
        ? args.replay.tokensAvailable - live.current
        : null,
    rpc_tokens_delta:
      args.rpc?.tokensAvailable != null
        ? args.rpc.tokensAvailable - live.current
        : null,
    cpta_tokens_delta:
      args.cptaTokens != null ? args.cptaTokens - live.current : null,
    // False means the game's economy or API contract changed; the monitor pages on it.
    constants_ok:
      live.max === MAX_TOKENS &&
      live.regenDelayInSeconds === TWELVE_HOURS_IN_SECONDS
  }
  if (args.rpcPostSnapshotSpends !== undefined) {
    row.rpc_post_snapshot_spends = args.rpcPostSnapshotSpends
  }
  return row
}
