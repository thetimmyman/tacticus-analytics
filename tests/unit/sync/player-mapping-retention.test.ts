import { describe, expect, it, vi } from 'vitest'

import { savePlayerMappings } from '@/app/lib/sync/db-operations/player-mappings'

/** A departing member keeps a retained is_current=false row, flipped back on rejoin. */

type ExistingRow = {
  player_id: string
  protected: boolean
  guild_code: string
  is_current: boolean
  cluster_code: string | null
  cluster_id: string | null
  user_id: string | null
  ownership_attestation_id: string | null
}

function buildClient(options: {
  currentRosterRows: string[]
  existingRows: ExistingRow[]
}) {
  const upserted: Array<Record<string, unknown>> = []
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const deletes: string[] = []

  const activityResult = Promise.resolve({ data: [], error: null })
  const activityChain: Record<string, unknown> = {
    eq: vi.fn(() => activityChain),
    gte: vi.fn(() => activityChain),
    order: vi.fn(() => activityChain),
    then: activityResult.then.bind(activityResult)
  }

  const rosterResult = Promise.resolve({
    data: options.currentRosterRows.map((player_id) => ({ player_id })),
    error: null
  })
  const rosterChain: Record<string, unknown> = {
    eq: vi.fn(() => rosterChain),
    or: vi.fn(() => rosterChain),
    then: rosterResult.then.bind(rosterResult)
  }

  const client = {
    from: vi.fn((table: string) => {
      if (table === 'EOT_GR_data') {
        return { select: vi.fn(() => activityChain) }
      }
      return {
        select: vi.fn((columns: string) =>
          columns.includes('protected')
            ? {
                in: vi.fn().mockResolvedValue({
                  data: options.existingRows,
                  error: null
                })
              }
            : rosterChain
        ),
        upsert: vi.fn((records: Array<Record<string, unknown>>) => {
          upserted.push(...records)
          return Promise.resolve({ error: null })
        }),
        // Present so a delete is observed rather than throwing.
        delete: vi.fn(() => {
          deletes.push(table)
          return Promise.resolve({ error: null })
        })
      }
    }),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      rpcCalls.push({ name, args })
      const ids = (args.p_player_ids as string[]) ?? []
      return Promise.resolve({
        data: {
          success: true,
          guild_code: args.p_guild_code,
          requested_count: ids.length,
          deactivated_count: ids.length,
          observation_stale: false,
          deactivated_mapping_ids: ids.map((_, index) => index + 1),
          revoked_attestations: 0,
          purged_loki_credential_count: 0,
          purged_loki_guild_codes: [],
          authority_cleared: true
        },
        error: null
      })
    })
  }

  return { client, upserted, rpcCalls, deletes }
}

const row = (
  player_id: string,
  overrides: Partial<ExistingRow> = {}
): ExistingRow => ({
  player_id,
  protected: false,
  guild_code: 'GUILD',
  is_current: true,
  cluster_code: null,
  cluster_id: null,
  user_id: null,
  ownership_attestation_id: null,
  ...overrides
})

describe('worker roster retention', () => {
  it('roster {A,B} against DB {A,B,C}: C is deactivated, never deleted, and its name is not overwritten', async () => {
    const { client, upserted, rpcCalls, deletes } = buildClient({
      currentRosterRows: ['A', 'B', 'C'],
      existingRows: [row('A'), row('B')]
    })

    await savePlayerMappings(
      client as never,
      'GUILD',
      [
        { userId: 'A', displayName: 'Alpha', role: 'leader' },
        { userId: 'B', displayName: 'Bravo', role: 'member' }
      ] as never,
      ['A', 'B'],
      null,
      new Date().toISOString()
    )

    const deactivations = rpcCalls.filter(
      (call) => call.name === 'deactivate_player_mappings_observed'
    )
    expect(deactivations).toHaveLength(1)
    expect(deactivations[0].args.p_player_ids).toEqual(['C'])
    expect(deactivations[0].args.p_guild_code).toBe('GUILD')

    expect(upserted.map((record) => record.player_id).sort()).toEqual([
      'A',
      'B'
    ])
    expect(upserted.every((record) => record.is_current === true)).toBe(true)

    expect(deletes).toEqual([])
  })

  it('a rejoining member flips is_current back to true with no deactivation', async () => {
    const { client, upserted, rpcCalls } = buildClient({
      currentRosterRows: ['A', 'B'],
      existingRows: [
        row('A'),
        row('B'),
        row('C', { is_current: false, guild_code: 'GUILD' })
      ]
    })

    await savePlayerMappings(
      client as never,
      'GUILD',
      [
        { userId: 'A', displayName: 'Alpha', role: 'leader' },
        { userId: 'B', displayName: 'Bravo', role: 'member' },
        { userId: 'C', displayName: 'Charlie', role: 'member' }
      ] as never,
      ['A', 'B', 'C'],
      null,
      new Date().toISOString()
    )

    expect(
      rpcCalls.filter(
        (call) => call.name === 'deactivate_player_mappings_observed'
      )
    ).toEqual([])

    const rejoined = upserted.find((record) => record.player_id === 'C')
    expect(rejoined).toBeDefined()
    expect(rejoined?.is_current).toBe(true)
    expect(rejoined?.display_name).toBe('Charlie')
    expect(rejoined?.guild_code).toBe('GUILD')
  })
})
