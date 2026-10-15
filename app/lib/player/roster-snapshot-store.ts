import type { Json } from '@tacticus/app-core/database.generated'
import type { ServiceSupabaseClient } from '@/app/lib/db'

export interface RosterObservation {
  playerMappingId: number
  attemptId: string
  observedAt: string
}
export interface RosterVerificationSummary {
  total: number
  verified: number
  fresh: number
  oldestVerifiedAt: string | null
}
export interface RosterFreshnessWindow {
  freshMs: number
  retryMs: number
  requireEnabledGuild?: boolean
}
export interface RosterSnapshotReceipt {
  status: 'applied' | 'superseded'
  upserted: number
  playerPowerUpdated: boolean
  unchanged: boolean
  complete: boolean
  idempotent?: boolean
}
const unavailable = () => new Error('Roster snapshot storage unavailable')
const object = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export async function readRosterVerificationSummary(
  mappingIds: number[],
  freshMs: number,
  supabase: ServiceSupabaseClient
): Promise<RosterVerificationSummary> {
  if (mappingIds.length === 0)
    return { total: 0, verified: 0, fresh: 0, oldestVerifiedAt: null }
  try {
    const { data, error } = await supabase
      .rpc('get_player_roster_verification_summary', {
        p_mapping_ids: mappingIds,
        p_fresh_seconds: Math.ceil(freshMs / 1000)
      })
      .abortSignal(AbortSignal.timeout(10000))
    const value = object(data)
    if (
      error ||
      !value ||
      Object.keys(value).some(
        (key) =>
          !['total', 'verified', 'fresh', 'oldestVerifiedAt'].includes(key)
      ) ||
      ![value.total, value.verified, value.fresh].every(
        (count) => Number.isSafeInteger(count) && Number(count) >= 0
      ) ||
      Number(value.total) > mappingIds.length ||
      Number(value.verified) > Number(value.total) ||
      Number(value.fresh) > Number(value.verified) ||
      (Number(value.verified) === 0
        ? value.oldestVerifiedAt !== null
        : typeof value.oldestVerifiedAt !== 'string' ||
          !Number.isFinite(Date.parse(value.oldestVerifiedAt)))
    )
      throw unavailable()
    return value as unknown as RosterVerificationSummary
  } catch {
    throw unavailable()
  }
}

/** The authority filters verified snapshots and orders attempts using its clock. */
export async function selectRosterRefreshCandidates<T extends { id: number }>(
  players: T[],
  windows: RosterFreshnessWindow,
  supabase: ServiceSupabaseClient
): Promise<T[]> {
  if (players.length === 0) return []
  try {
    const byId = new Map(players.map((player) => [player.id, player]))
    if (
      byId.size !== players.length ||
      players.length > 10000 ||
      players.some(
        (player) => !Number.isSafeInteger(player.id) || player.id <= 0
      )
    )
      throw unavailable()
    const { data, error } = await supabase
      .rpc('get_player_roster_refresh_candidates', {
        p_mapping_ids: players.map((player) => player.id),
        p_fresh_seconds: Math.ceil(windows.freshMs / 1000),
        p_retry_seconds: Math.ceil(windows.retryMs / 1000),
        p_require_enabled_guild: windows.requireEnabledGuild ?? true
      })
      .abortSignal(AbortSignal.timeout(10000))
    if (
      error ||
      !Array.isArray(data) ||
      data.some((id) => !Number.isSafeInteger(id) || !byId.has(id)) ||
      new Set(data).size !== data.length
    )
      throw unavailable()
    return data.map((id) => byId.get(id)!)
  } catch {
    throw unavailable()
  }
}

function readObservation(
  data: unknown,
  playerMappingId: number | undefined
): RosterObservation {
  const value = object(data)
  if (
    !value ||
    Object.keys(value).some(
      (key) => !['playerMappingId', 'attemptId', 'observedAt'].includes(key)
    ) ||
    !Number.isSafeInteger(value.playerMappingId) ||
    Number(value.playerMappingId) <= 0 ||
    (playerMappingId !== undefined &&
      value.playerMappingId !== playerMappingId) ||
    typeof value.attemptId !== 'string' ||
    !UUID.test(value.attemptId) ||
    typeof value.observedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.observedAt))
  )
    throw unavailable()
  return value as unknown as RosterObservation
}

/** Atomically recheck background eligibility before recording an attempt. */
export async function tryBeginPlayerRosterRefresh(
  userId: string | null,
  playerMappingId: number,
  windows: RosterFreshnessWindow,
  supabase: ServiceSupabaseClient
): Promise<RosterObservation | null> {
  try {
    const { data, error } = await supabase
      .rpc('try_begin_player_roster_refresh', {
        p_player_mapping_id: playerMappingId,
        p_user_id: userId,
        p_fresh_seconds: Math.ceil(windows.freshMs / 1000),
        p_retry_seconds: Math.ceil(windows.retryMs / 1000),
        p_require_enabled_guild: windows.requireEnabledGuild ?? true
      })
      .abortSignal(AbortSignal.timeout(10000))
    if (error) throw unavailable()
    return data === null ? null : readObservation(data, playerMappingId)
  } catch {
    throw unavailable()
  }
}

/** Obtain before the provider read; database time orders overlapping results. */
export async function beginPlayerRosterRefresh(
  userId: string | null,
  playerMappingId: number | undefined,
  supabase: ServiceSupabaseClient,
  options: { timeoutMs?: number } = {}
): Promise<RosterObservation> {
  try {
    const { data, error } = await supabase
      .rpc('begin_player_roster_refresh', {
        p_player_mapping_id: playerMappingId ?? null,
        p_user_id: userId
      })
      .abortSignal(AbortSignal.timeout(options.timeoutMs ?? 10000))
    if (error) throw unavailable()
    return readObservation(data, playerMappingId)
  } catch {
    throw unavailable()
  }
}

/** The RPC owns atomic writes, ownership checks, replay fencing and freshness. */
export async function commitPlayerRosterSnapshot(
  observation: RosterObservation,
  userId: string | null,
  rows: Json[],
  playerPower: number | null,
  complete: boolean,
  supabase: ServiceSupabaseClient
): Promise<RosterSnapshotReceipt> {
  try {
    const { data, error } = await supabase
      .rpc('persist_player_roster_snapshot', {
        p_player_mapping_id: observation.playerMappingId,
        p_user_id: userId,
        p_attempt_id: observation.attemptId,
        p_rows: rows,
        p_player_power: playerPower,
        p_complete: complete
      })
      .abortSignal(AbortSignal.timeout(10000))
    const value = object(data)
    if (
      error ||
      !value ||
      Object.keys(value).some(
        (key) =>
          ![
            'status',
            'upserted',
            'playerPowerUpdated',
            'unchanged',
            'complete',
            'idempotent'
          ].includes(key)
      ) ||
      !['applied', 'superseded'].includes(String(value.status)) ||
      !Number.isSafeInteger(value.upserted) ||
      Number(value.upserted) < 0 ||
      typeof value.playerPowerUpdated !== 'boolean' ||
      typeof value.unchanged !== 'boolean' ||
      typeof value.complete !== 'boolean' ||
      (value.idempotent !== undefined && typeof value.idempotent !== 'boolean')
    )
      throw unavailable()
    return value as unknown as RosterSnapshotReceipt
  } catch {
    throw unavailable()
  }
}
