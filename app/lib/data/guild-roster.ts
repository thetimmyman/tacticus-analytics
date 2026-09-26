import type {
  Database,
  PlayerMapping,
  TypedSupabaseClient
} from '@tacticus/app-core/types'

interface RosterQueryResult<Row> {
  data: Row[] | null
  error: { message: string; code?: string } | null
  count: number | null
  status: number
  statusText: string
}

interface RosterSingleResult<Row> {
  data: Row | null
  error: { message: string; code?: string } | null
  count: number | null
  status: number
  statusText: string
}

/** Avoids supabase-js parsing an unresolved select. */
export interface GuildRosterQuery<
  Row extends Record<string, unknown>
> extends PromiseLike<RosterQueryResult<Row>> {
  eq(column: string, value: unknown): GuildRosterQuery<Row>
  neq(column: string, value: unknown): GuildRosterQuery<Row>
  gt(column: string, value: unknown): GuildRosterQuery<Row>
  gte(column: string, value: unknown): GuildRosterQuery<Row>
  lt(column: string, value: unknown): GuildRosterQuery<Row>
  lte(column: string, value: unknown): GuildRosterQuery<Row>
  is(column: string, value: unknown): GuildRosterQuery<Row>
  in(column: string, values: readonly unknown[]): GuildRosterQuery<Row>
  not(column: string, operator: string, value: unknown): GuildRosterQuery<Row>
  or(filters: string): GuildRosterQuery<Row>
  contains(column: string, value: unknown): GuildRosterQuery<Row>
  order(
    column: string,
    options?: { ascending?: boolean; nullsFirst?: boolean }
  ): GuildRosterQuery<Row>
  limit(count: number): GuildRosterQuery<Row>
  range(from: number, to: number): GuildRosterQuery<Row>
  single(): PromiseLike<RosterSingleResult<Row>>
  maybeSingle(): PromiseLike<RosterSingleResult<Row>>
}

/** `is_current = true` keeps renamed/transferred players' historical rows out. */
export function guildRosterQuery<
  Row extends Record<string, unknown> = PlayerMapping
>(
  client: TypedSupabaseClient,
  guildCode: string,
  select: string,
  selectOptions?: { count?: 'exact' | 'planned' | 'estimated'; head?: boolean }
): GuildRosterQuery<Row> {
  const query = selectOptions
    ? client.from('player_mapping').select(select, selectOptions)
    : client.from('player_mapping').select(select)
  return query
    .eq('guild_code', guildCode)
    .eq('is_current', true) as unknown as GuildRosterQuery<Row>
}

export type GuildRosterApiKeyRow = Pick<
  Database['public']['Tables']['player_mapping']['Row'],
  | 'player_id'
  | 'display_name'
  | 'tacticus_api_key_encrypted'
  | 'api_key_is_valid'
>
