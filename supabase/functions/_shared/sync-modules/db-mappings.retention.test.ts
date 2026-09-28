import {
  assert,
  assertEquals
} from 'https://deno.land/std@0.168.0/testing/asserts.ts'
import { savePlayerMappings } from './db-mappings.ts'

/**
 * Edge twin of the app retention test: an absent member is kept as is_current=false (never deleted
 * or upserted); a rejoining member flips back to is_current=true.
 */

type Row = Record<string, unknown>

function buildDeps(options: {
  currentRosterRows: string[]
  existingRows: Row[]
}) {
  const upserted: Row[] = []
  const rpcCalls: Array<{ name: string; args: Record<string, unknown> }> = []
  const deletes: string[] = []

  const activityChain: Record<string, unknown> = {
    eq: () => activityChain,
    gte: () => activityChain,
    order: () => activityChain,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ data: [], error: null }).then(resolve)
  }

  const rosterChain: Record<string, unknown> = {
    eq: () => rosterChain,
    or: () => rosterChain,
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({
        data: options.currentRosterRows.map((player_id) => ({ player_id })),
        error: null
      }).then(resolve)
  }

  const supabase = {
    from(table: string) {
      if (table === 'raid_data') {
        return { select: () => activityChain }
      }
      return {
        select: (columns: string) =>
          columns.includes('protected')
            ? {
                in: () =>
                  Promise.resolve({ data: options.existingRows, error: null })
              }
            : rosterChain,
        upsert: (records: Row[]) => {
          upserted.push(...records)
          return { select: () => Promise.resolve({ data: [], error: null }) }
        },
        delete: () => {
          deletes.push(table)
          return Promise.resolve({ error: null })
        }
      }
    },
    rpc: (name: string, args: Record<string, unknown>) => {
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
    }
  }

  const logger = { info: () => {}, warn: () => {}, error: () => {} }
  return { deps: { supabase, logger }, upserted, rpcCalls, deletes }
}

const row = (player_id: string, overrides: Row = {}): Row => ({
  player_id,
  protected: false,
  guild_code: 'GUILD',
  is_current: true,
  cluster_code: null,
  cluster_id: null,
  avatar_unit_id: null,
  player_level: null,
  player_power: null,
  user_id: null,
  ownership_attestation_id: null,
  ...overrides
})

const config = { playerMappingTable: 'player_mapping', dataTable: 'raid_data' }

Deno.test(
  'edge savePlayerMappings: a departed member is deactivated, not deleted',
  async () => {
    const { deps, upserted, rpcCalls, deletes } = buildDeps({
      currentRosterRows: ['A', 'B', 'C'],
      existingRows: [row('A'), row('B')]
    })

    await savePlayerMappings(
      // deno-lint-ignore no-explicit-any
      deps as any,
      config,
      'GUILD',
      // deno-lint-ignore no-explicit-any
      [
        { userId: 'A', displayName: 'Alpha', role: 'leader' },
        { userId: 'B', displayName: 'Bravo', role: 'member' }
      ] as any,
      ['A', 'B'],
      new Date().toISOString()
    )

    const deactivations = rpcCalls.filter(
      (call) => call.name === 'deactivate_player_mappings_observed'
    )
    assertEquals(deactivations.length, 1)
    assertEquals(deactivations[0].args.p_player_ids, ['C'])
    assertEquals(upserted.map((record) => record.player_id).sort(), ['A', 'B'])
    assert(upserted.every((record) => record.is_current === true))
    assertEquals(deletes, [])
  }
)

Deno.test(
  'edge savePlayerMappings: a rejoining member flips is_current back to true',
  async () => {
    const { deps, upserted, rpcCalls } = buildDeps({
      currentRosterRows: ['A', 'B'],
      existingRows: [row('A'), row('B'), row('C', { is_current: false })]
    })

    await savePlayerMappings(
      // deno-lint-ignore no-explicit-any
      deps as any,
      config,
      'GUILD',
      // deno-lint-ignore no-explicit-any
      [
        { userId: 'A', displayName: 'Alpha', role: 'leader' },
        { userId: 'B', displayName: 'Bravo', role: 'member' },
        { userId: 'C', displayName: 'Charlie', role: 'member' }
      ] as any,
      ['A', 'B', 'C'],
      new Date().toISOString()
    )

    assertEquals(
      rpcCalls.filter(
        (call) => call.name === 'deactivate_player_mappings_observed'
      ).length,
      0
    )
    const rejoined = upserted.find((record) => record.player_id === 'C')
    assert(rejoined !== undefined)
    assertEquals(rejoined?.is_current, true)
    assertEquals(rejoined?.display_name, 'Charlie')
    assertEquals(rejoined?.guild_code, 'GUILD')
  }
)
