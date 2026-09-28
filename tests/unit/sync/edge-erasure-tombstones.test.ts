import { describe, expect, it } from 'vitest'
import { loadErasureTombstones } from '@/supabase/functions/_shared/sync-modules/erasure-tombstones'
import { processRaidEntry } from '@/supabase/functions/_shared/sync-modules/transforms'

/** An erased subject's mapping is inactive, so without the tombstone lookup sync writes the real name back. */
type Row = Record<string, unknown>

function makeClient(fixtures: {
  mappingRows?: Row[]
  mappingError?: { message: string }
  battleRows?: Row[]
}) {
  const seen: string[] = []
  const client = {
    from(table: string) {
      seen.push(table)
      const builder = {
        select: (_columns: string) => builder,
        eq: (_column: string, _value: unknown) => builder,
        in: (_column: string, _values: readonly unknown[]) => builder,
        like: (_column: string, _pattern: string) => builder,
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(
            table === 'player_mapping'
              ? {
                  data: fixtures.mappingRows ?? [],
                  error: fixtures.mappingError ?? null
                }
              : { data: fixtures.battleRows ?? [], error: null }
          ).then(resolve)
      }
      return builder
    }
  }
  return { client, seen }
}

const TABLES = {
  playerMappingTable: 'player_mapping',
  dataTable: 'EOT_GR_data'
}

describe('loadErasureTombstones (edge tier)', () => {
  it('finds a tombstone on a mapping row the current-roster read cannot see', async () => {
    const { client } = makeClient({
      mappingRows: [
        { player_id: 'erased-1', display_name: '[DELETED_USER_9f8e7d6c]' }
      ]
    })

    const result = await loadErasureTombstones(client, TABLES, 'GUILD', '100', [
      'erased-1'
    ])

    expect(result.tombstones['erased-1']).toBe('[DELETED_USER_9f8e7d6c]')
    expect(result.withheld).toEqual([])
  })

  it('finds a tombstone on the battle rows when the mapping row is gone entirely', async () => {
    const { client } = makeClient({
      mappingRows: [],
      battleRows: [
        { userId: 'erased-2', displayName: '[DELETED_USER_1a2b3c4d]' }
      ]
    })

    const result = await loadErasureTombstones(client, TABLES, 'GUILD', '100', [
      'erased-2'
    ])

    expect(result.tombstones['erased-2']).toBe('[DELETED_USER_1a2b3c4d]')
  })

  it('withholds every id in the chunk when the erasure status cannot be read', async () => {
    const { client } = makeClient({
      mappingError: { message: 'connection reset' }
    })

    const result = await loadErasureTombstones(client, TABLES, 'GUILD', '100', [
      'a',
      'b'
    ])

    expect(result.tombstones).toEqual({})
    expect(result.withheld).toEqual(['a', 'b'])
  })

  it('reads nothing at all for an empty window', async () => {
    const { client, seen } = makeClient({})

    const result = await loadErasureTombstones(
      client,
      TABLES,
      'GUILD',
      '100',
      []
    )

    expect(result.tombstones).toEqual({})
    expect(seen).toEqual([])
  })

  it('a seeded tombstone beats the payload username in the edge transform', async () => {
    const seeded = await loadErasureTombstones(
      makeClient({
        mappingRows: [
          { player_id: 'erased-3', display_name: '[DELETED_USER_5e6f7a8b]' }
        ]
      }).client,
      TABLES,
      'GUILD',
      '100',
      ['erased-3']
    )

    const processed = processRaidEntry(
      {
        userId: 'erased-3',
        username: 'TheirRealName',
        type: 'Szarekh',
        encounterIndex: 0
      },
      'GUILD',
      100,
      seeded.tombstones,
      {},
      null,
      null
    )

    expect(processed?.displayName).toBe('[DELETED_USER_5e6f7a8b]')
  })

  it('never promotes a tombstone-shaped username on its own', async () => {
    const processed = processRaidEntry(
      {
        userId: 'odd-1',
        username: '[DELETED_USER_deadbeef]',
        type: 'Szarekh',
        encounterIndex: 0
      },
      'GUILD',
      100,
      {},
      {},
      null,
      null
    )

    expect(processed?.displayName).toBe('Player#ODD1')
    expect(processed?.displayName).not.toBe('[DELETED_USER_deadbeef]')
  })
})
