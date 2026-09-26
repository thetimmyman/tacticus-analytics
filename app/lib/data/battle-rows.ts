/**
 * ORDER BY startedOn DESC is terminal because PostgREST caps rows. No remainingHp > 0
 * filter: it drops one-shots and understates baselines.
 */

import type { Database } from '@/app/lib/db'

export type BattleRowsScope =
  { guild: string } | { guilds: readonly string[] } | { cluster: string }

export interface BattleRowsParams {
  /** Widened to `string`: a literal type makes supabase-js's select parser OOM tsc. */
  select: string
  scope: BattleRowsScope
  rarities?: readonly string[]
  encounters?: 'main' | 'main-and-primes' | 'primes' | readonly number[]
  /** Makes the 10k row cap per-season so batched seasons cannot crowd each other out. */
  season?: string
  seasons?: readonly string[]
}

export interface BattleRowsResult<Row> {
  data: Row[] | null
  error: { message: string; code?: string } | null
}

/** `Row` must match `params.select`. */
export function buildBattleRowsQuery<Row = Record<string, unknown>>(
  client: Database,
  params: BattleRowsParams
): PromiseLike<BattleRowsResult<Row>> {
  let query = client
    .from('EOT_GR_data')
    .select(params.select)
    .eq('damageType', 'Battle')
    .gt('damageDealt', 0)
    .not('Name', 'is', null)

  if ('guild' in params.scope) {
    query = query.eq('Guild', params.scope.guild)
  } else if ('guilds' in params.scope) {
    query = query.in('Guild', params.scope.guilds as string[])
  } else {
    query = query.eq('cluster_code', params.scope.cluster)
  }

  if (params.rarities) {
    query = query.in('rarity', params.rarities as string[])
  }

  const encounters = params.encounters ?? 'main'
  if (encounters === 'main') {
    query = query.eq('encounterId', 0)
  } else if (encounters === 'main-and-primes') {
    query = query.in('encounterId', [0, 1, 2])
  } else if (encounters === 'primes') {
    query = query.in('encounterId', [1, 2])
  } else {
    query = query.in('encounterId', encounters as number[])
  }

  if (params.season !== undefined) {
    query = query.eq('Season', params.season)
  } else if (params.seasons) {
    query = query.in('Season', params.seasons as string[])
  }

  return query.order('startedOn', {
    ascending: false
  }) as unknown as PromiseLike<BattleRowsResult<Row>>
}
