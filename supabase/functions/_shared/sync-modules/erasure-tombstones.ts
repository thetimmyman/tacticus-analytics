import {
  ERASURE_TOMBSTONE_PREFIX,
  isErasureTombstone
} from '../player-name-resolution-core.ts'

// Structural client type so vitest can pass a fake (Deno supabase-js does not resolve in Node).
export type TombstoneQueryClient = {
  // deno-lint-ignore no-explicit-any
  from: (table: string) => any
}

export type ErasureTombstoneLookup = {
  /** player id -> the exact tombstone string that must survive this run. */
  tombstones: Record<string, string>
  /** player ids whose erasure status could not be read: fail closed. */
  withheld: string[]
}

const CHUNK_SIZE = 200

function chunk(ids: string[]): string[][] {
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
    chunks.push(ids.slice(i, i + CHUNK_SIZE))
  }
  return chunks
}

/**
 * Article 17 tombstones for one raid window, so re-ingestion rewrites the tombstone, not the real name.
 * Mapping rows skip the guild/is_current filter (erasure deactivates them); battle rows cover the rest.
 */
export async function loadErasureTombstones(
  client: TombstoneQueryClient,
  config: { playerMappingTable: string; dataTable: string },
  guildCode: string,
  season: string | null,
  playerIds: string[]
): Promise<ErasureTombstoneLookup> {
  const tombstones: Record<string, string> = {}
  const withheld: string[] = []
  if (playerIds.length === 0) return { tombstones, withheld }

  // LIKE treats `_` as a wildcard, so this is coarse; isErasureTombstone decides.
  const pattern = `${ERASURE_TOMBSTONE_PREFIX}%`

  for (const ids of chunk(playerIds)) {
    const mappingResult = await client
      .from(config.playerMappingTable)
      .select('player_id, display_name')
      .like('display_name', pattern)
      .in('player_id', ids)

    if (mappingResult?.error) {
      for (const id of ids) withheld.push(id)
      continue
    }
    for (const row of mappingResult?.data ?? []) {
      if (
        typeof row?.player_id === 'string' &&
        isErasureTombstone(row?.display_name)
      ) {
        tombstones[row.player_id] = row.display_name
      }
    }

    if (season == null) continue

    const battleResult = await client
      .from(config.dataTable)
      .select('userId, displayName')
      .eq('Guild', guildCode)
      .eq('Season', season)
      .like('displayName', pattern)
      .in('userId', ids)

    for (const row of battleResult?.data ?? []) {
      if (
        typeof row?.userId === 'string' &&
        isErasureTombstone(row?.displayName) &&
        tombstones[row.userId] === undefined
      ) {
        tombstones[row.userId] = row.displayName
      }
    }
  }

  return { tombstones, withheld }
}
