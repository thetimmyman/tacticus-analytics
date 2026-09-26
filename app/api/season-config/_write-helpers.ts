import { Errors } from '@/app/lib/errors/AppError'
import { createComponentLogger } from '@/app/lib/logging'

const RARITY_SET_REGEX = /^[LM][1-5]$/
const SUB_INDEX_VALUES = [1, 2] as const
const PING_MODES = new Set(['combined', 'per_side', 'skip_all'])

export const SEASON_CONFIG_NOTES_MAX_LEN = 4000
export const SEASON_CONFIG_PENDING_BOSS_NAME = '__pending__'

export type SeasonConfigSubIndex = (typeof SUB_INDEX_VALUES)[number]
export type SeasonConfigPingMode = 'combined' | 'per_side' | 'skip_all'

export interface SeasonConfigBaseInput {
  guild_code: string
  season_number: string
  level: string
}

const logger = createComponentLogger('season-config-write-helpers')

interface SeasonConfigDbError {
  message?: string
  /** PGRST202 = function missing from the schema cache. */
  code?: string
}

interface SeasonConfigPlannerRow {
  id: string
  sub_bosses: Record<string, unknown> | null
  boss_name: string
}

interface SeasonConfigPlannerWritePayload {
  sub_bosses: Record<string, unknown>
  selected_by: string
}

interface SeasonConfigPlannerInsertPayload
  extends SeasonConfigBaseInput, SeasonConfigPlannerWritePayload {
  boss_name: typeof SEASON_CONFIG_PENDING_BOSS_NAME
}

interface SeasonConfigSelectQuery {
  eq(column: string, value: string): SeasonConfigSelectQuery
  limit(count: number): Promise<{
    data: SeasonConfigPlannerRow[] | null
    error: SeasonConfigDbError | null
  }>
}

interface SeasonConfigUpdateQuery {
  eq(
    column: string,
    value: string
  ): {
    // Selects the touched ids so an RLS-filtered zero-row update is a loud error.
    select(columns: string): Promise<{
      data: Array<{ id: string }> | null
      error: SeasonConfigDbError | null
    }>
  }
}

interface SeasonConfigPlannerTable {
  select(columns: string): SeasonConfigSelectQuery
  update(payload: SeasonConfigPlannerWritePayload): SeasonConfigUpdateQuery
  insert(
    payload: SeasonConfigPlannerInsertPayload
  ): Promise<{ error: SeasonConfigDbError | null }>
}

interface SeasonConfigSupabaseLike {
  from(table: string): unknown
  /** Without rpc (or on PGRST202) the merge falls back to read-modify-write. */
  rpc?(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: unknown; error: SeasonConfigDbError | null }>
}

interface MergeSeasonConfigSubBossPatchParams<
  TInput extends SeasonConfigBaseInput = SeasonConfigBaseInput
> {
  supabase: unknown
  selectedBy: string
  input: TInput
  patch: Record<string, unknown>
  endpoint: string
  lookupFailureMessage: string
  updateFailureMessage: string
  insertFailureMessage: string
}

export function normalizeSeasonConfigStringField(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : ''
}

export function normalizeSeasonConfigRaritySet(raw: unknown): string {
  const value = normalizeSeasonConfigStringField(raw)
  return RARITY_SET_REGEX.test(value) ? value : ''
}

export function normalizeSeasonConfigBaseInput(body: unknown): {
  input: SeasonConfigBaseInput
  raw: Record<string, unknown>
} | null {
  if (!body || typeof body !== 'object') return null
  const raw = body as Record<string, unknown>
  const guildCode = normalizeSeasonConfigStringField(raw.guild_code)
  const seasonNumber = normalizeSeasonConfigStringField(raw.season_number)
  const level = normalizeSeasonConfigRaritySet(raw.level)
  if (!guildCode || !seasonNumber || !level) return null
  return {
    input: {
      guild_code: guildCode,
      season_number: seasonNumber,
      level
    },
    raw
  }
}

export function normalizeSeasonConfigSubIndex(
  raw: unknown
): SeasonConfigSubIndex | null {
  if (typeof raw !== 'number') return null
  return SUB_INDEX_VALUES.includes(raw as SeasonConfigSubIndex)
    ? (raw as SeasonConfigSubIndex)
    : null
}

export function normalizeSeasonConfigKillThresholdPct(
  raw: unknown
): number | null {
  const pct =
    typeof raw === 'number'
      ? raw
      : typeof raw === 'string'
        ? Number.parseFloat(raw)
        : NaN
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null
  return pct
}

export function normalizeSeasonConfigNoteField(
  raw: unknown
): string | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw !== 'string') return undefined
  // The single choke point: readers treat any string, even "", as set; null = cleared, no legacy fallback.
  if (raw.trim() === '') return null
  return raw.length > SEASON_CONFIG_NOTES_MAX_LEN
    ? raw.slice(0, SEASON_CONFIG_NOTES_MAX_LEN)
    : raw
}

export function normalizeSeasonConfigPingMode(
  raw: unknown
): SeasonConfigPingMode | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw !== 'string') return undefined
  return PING_MODES.has(raw) ? (raw as SeasonConfigPingMode) : undefined
}

// 42501 (e.g. role demoted mid-session) is 403, not 500.
function isSeasonConfigRlsDenial(error: SeasonConfigDbError | null): boolean {
  if (!error) return false
  if (error.code === '42501') return true
  return (
    typeof error.message === 'string' &&
    error.message.toLowerCase().includes('row-level security')
  )
}

function seasonConfigRlsDenialError(
  endpoint: string,
  guildCode: string,
  details?: string
) {
  return Errors.forbidden(
    `Not authorized to write season config for guild ${guildCode}. The ` +
      `database policy on upcoming_season_bosses requires a CURRENT officer ` +
      `or leader membership in that guild, or a CURRENT leader of a guild in ` +
      `the same cluster.`,
    { endpoint, details }
  )
}

export async function mergeSeasonConfigSubBossPatch({
  supabase,
  selectedBy,
  input,
  patch,
  endpoint,
  lookupFailureMessage,
  updateFailureMessage,
  insertFailureMessage
}: MergeSeasonConfigSubBossPatchParams): Promise<void> {
  const client = supabase as SeasonConfigSupabaseLike

  // Both primes share one row, so JS read-modify-write loses concurrent patches; the RPC locks the row.
  if (typeof client.rpc === 'function') {
    const { error: rpcErr } = await client.rpc('merge_season_boss_sub_bosses', {
      p_guild_code: input.guild_code,
      p_season_number: input.season_number,
      p_level: input.level,
      p_patch: patch,
      p_selected_by: selectedBy || null
    })
    if (!rpcErr) return
    if (rpcErr.code !== 'PGRST202') {
      // rpcErr.message is raw DB text and AppError metadata reaches the client.
      logger.error(
        { endpoint, code: rpcErr.code, dbMessage: rpcErr.message },
        'merge_season_boss_sub_bosses RPC failed'
      )
      if (isSeasonConfigRlsDenial(rpcErr)) {
        throw seasonConfigRlsDenialError(
          endpoint,
          input.guild_code,
          'atomic merge RPC denied by row-level security'
        )
      }
      throw Errors.updateFailed(updateFailureMessage, {
        endpoint,
        details:
          'atomic merge RPC failed — see server logs for the database error'
      })
    }
    logger.warn(
      { endpoint },
      'merge_season_boss_sub_bosses missing from schema cache — falling back to non-atomic merge'
    )
  }

  const tbl = client.from('upcoming_season_bosses') as SeasonConfigPlannerTable

  const { data: existingRows, error: lookupErr } = await tbl
    .select('id, sub_bosses, boss_name')
    .eq('guild_code', input.guild_code)
    .eq('season_number', input.season_number)
    .eq('level', input.level)
    .limit(1)

  if (lookupErr) {
    throw Errors.updateFailed(lookupFailureMessage, {
      endpoint,
      details: lookupErr.message
    })
  }

  const rows = existingRows ?? []
  const existing = rows[0] ?? null
  const merged = {
    ...(existing?.sub_bosses ?? {}),
    ...patch
  }

  if (existing) {
    const { data: updatedRows, error: updateErr } = await tbl
      .update({ sub_bosses: merged, selected_by: selectedBy })
      .eq('id', existing.id)
      .select('id')
    if (updateErr) {
      if (isSeasonConfigRlsDenial(updateErr)) {
        throw seasonConfigRlsDenialError(
          endpoint,
          input.guild_code,
          updateErr.message
        )
      }
      throw Errors.updateFailed(updateFailureMessage, {
        endpoint,
        details: updateErr.message
      })
    }
    // The row was just read, so zero updated rows means RLS denial.
    if ((updatedRows ?? []).length === 0) {
      throw seasonConfigRlsDenialError(
        endpoint,
        input.guild_code,
        'update matched 0 rows for an existing planner row — likely an RLS ' +
          'write denial or a concurrent delete; the patch was NOT saved'
      )
    }
    return
  }

  // The sentinel boss_name reads as "not yet selected"; the full planner save overwrites it.
  const { error: insertErr } = await tbl.insert({
    guild_code: input.guild_code,
    season_number: input.season_number,
    level: input.level,
    boss_name: SEASON_CONFIG_PENDING_BOSS_NAME,
    sub_bosses: merged,
    selected_by: selectedBy
  })
  if (insertErr) {
    if (isSeasonConfigRlsDenial(insertErr)) {
      throw seasonConfigRlsDenialError(
        endpoint,
        input.guild_code,
        insertErr.message
      )
    }
    throw Errors.updateFailed(insertFailureMessage, {
      endpoint,
      details: insertErr.message
    })
  }
}
