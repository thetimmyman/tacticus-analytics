import { describe, expect, it, vi } from 'vitest'

import { savePlayerMappings } from '@/supabase/functions/_shared/sync-modules/db-mappings.ts'

function buildClient(
  options: {
    malformedProof?: boolean
    claimed?: boolean
    transfer?: 'moves' | 'fails'
  } = {}
) {
  const transferCalls: Array<Record<string, unknown>> = []
  const upserted: Array<Record<string, unknown>> = []
  const rpcCalls: Array<Record<string, unknown>> = []
  const existingRows = [
    {
      player_id: 'player-1',
      protected: false,
      guild_code: 'OLD',
      is_current: true,
      tacticus_api_key_encrypted: 'encrypted-key',
      tacticus_share_url: null,
      theme_preference: 'dark',
      boss_preferences: null,
      cluster_code: null,
      cluster_id: null,
      avatar_unit_id: null,
      player_level: null,
      player_power: null,
      // Extra fields prove a broad DB response cannot leak into the Edge upsert.
      user_id: options.claimed === false ? null : 'subject-1',
      ownership_attestation_id:
        options.claimed === false ? null : 'attestation-1',
      discord_user_id: '123456789012345678',
      discord_username: 'discord-user',
      is_app_admin: true
    }
  ]
  let playerSelect = 0
  const activityResult = Promise.resolve({ data: [], error: null })
  const activityChain: Record<string, unknown> = {
    eq: vi.fn(() => activityChain),
    gte: vi.fn(() => activityChain),
    then: activityResult.then.bind(activityResult)
  }
  const resetResult = Promise.resolve({ data: [], error: null })
  const resetChain: Record<string, unknown> = {
    eq: vi.fn(() => resetChain),
    or: vi.fn(() => resetChain),
    then: resetResult.then.bind(resetResult)
  }
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'raid_data') {
        return { select: vi.fn(() => activityChain) }
      }
      return {
        select: vi.fn(() => {
          playerSelect += 1
          return playerSelect === 1
            ? {
                in: vi.fn().mockResolvedValue({
                  data: existingRows,
                  error: null
                })
              }
            : resetChain
        }),
        upsert: vi.fn((records: Array<Record<string, unknown>>) => {
          upserted.push(...records)
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        })
      }
    }),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === 'transfer_roster_confirmed_players') {
        transferCalls.push(args)
        return Promise.resolve(
          options.transfer === 'fails'
            ? { data: null, error: { message: 'permission denied' } }
            : {
                data: (args.p_player_ids as string[]).map((id) => ({
                  player_id: id,
                  from_guild_code: 'OLD'
                })),
                error: null
              }
        )
      }
      rpcCalls.push(args)
      const ids = args.p_player_ids as string[]
      return Promise.resolve({
        data: options.malformedProof
          ? { success: true }
          : {
              success: true,
              guild_code: args.p_guild_code,
              requested_count: ids.length,
              deactivated_count: ids.length,
              observation_stale: false,
              deactivated_mapping_ids: ids.map((_, index) => index + 1),
              revoked_attestations: 1,
              purged_loki_credential_count: 1,
              purged_loki_guild_codes: ['OLD'],
              authority_cleared: true
            },
        error: null
      })
    })
  }
  return { client, rpcCalls, transferCalls, upserted }
}

const logger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}

describe('Edge roster guarded writes', () => {
  it('does not move an attested cross-guild player from one roster snapshot', async () => {
    const { client, rpcCalls, upserted } = buildClient()

    await savePlayerMappings(
      { supabase: client, logger },
      { playerMappingTable: 'player_mapping', dataTable: 'raid_data' },
      'NEW',
      [{ userId: 'player-1', displayName: 'Player', role: 'leader' }],
      ['other-player']
    )

    expect(rpcCalls).toEqual([])
    expect(upserted).toEqual([])
  })

  it('moves a claimed player the live Tacticus roster lists in the new guild', async () => {
    const { client, transferCalls, upserted } = buildClient()

    await savePlayerMappings(
      { supabase: client, logger },
      { playerMappingTable: 'player_mapping', dataTable: 'raid_data' },
      'NEW',
      [{ userId: 'player-1', displayName: 'Player', role: 'officer' }],
      ['player-1', 'other-player']
    )

    expect(transferCalls).toEqual([
      { p_target_guild_code: 'NEW', p_player_ids: ['player-1'] }
    ])
    expect(upserted).toEqual([
      expect.objectContaining({
        player_id: 'player-1',
        guild_code: 'NEW',
        is_current: true,
        role: 'officer'
      })
    ])
  })

  it('does not move a claimed player the Tacticus roster lists twice', async () => {
    const { client, transferCalls, upserted } = buildClient()

    await savePlayerMappings(
      { supabase: client, logger },
      { playerMappingTable: 'player_mapping', dataTable: 'raid_data' },
      'NEW',
      [{ userId: 'player-1', displayName: 'Player', role: 'leader' }],
      ['player-1', 'player-1']
    )

    expect(transferCalls).toEqual([])
    expect(upserted).toEqual([])
  })

  it('leaves a claimed player in place when the move is refused', async () => {
    const { client, transferCalls, upserted } = buildClient({
      transfer: 'fails'
    })

    await savePlayerMappings(
      { supabase: client, logger },
      { playerMappingTable: 'player_mapping', dataTable: 'raid_data' },
      'NEW',
      [{ userId: 'player-1', displayName: 'Player', role: 'leader' }],
      ['player-1']
    )

    expect(transferCalls).toHaveLength(1)
    expect(upserted).toEqual([])
  })

  it('aborts before upsert when credential-purge proof is missing', async () => {
    const { client, upserted } = buildClient({
      malformedProof: true,
      claimed: false
    })

    await savePlayerMappings(
      { supabase: client, logger },
      { playerMappingTable: 'player_mapping', dataTable: 'raid_data' },
      'NEW',
      [{ userId: 'player-1', displayName: 'Player', role: 'leader' }],
      ['other-player']
    )

    expect(upserted).toEqual([])
    expect(logger.error).toHaveBeenCalledWith(
      'NEW',
      expect.stringContaining('invalid proof'),
      expect.any(Error)
    )
  })
})

// The roster write is swallowed but its outcome must still be recorded via RPC.
function buildRecordingClient(options: { loadFails?: boolean } = {}) {
  const rosterRpc: Array<Record<string, unknown>> = []
  const activityResult = Promise.resolve({ data: [], error: null })
  const activityChain: Record<string, unknown> = {
    eq: vi.fn(() => activityChain),
    gte: vi.fn(() => activityChain),
    then: activityResult.then.bind(activityResult)
  }
  const client = {
    from: vi.fn((table: string) => {
      if (table === 'raid_data') {
        return { select: vi.fn(() => activityChain) }
      }
      return {
        select: vi.fn(() => ({
          in: vi
            .fn()
            .mockResolvedValue(
              options.loadFails
                ? { data: null, error: { message: 'connection reset by peer' } }
                : { data: [], error: null }
            )
        }))
      }
    }),
    rpc: vi.fn((name: string, args: Record<string, unknown>) => {
      if (name === 'record_roster_write_outcome') rosterRpc.push(args)
      return Promise.resolve({ data: null, error: null })
    })
  }
  return { client, rosterRpc }
}

describe('roster-write outcome counter', () => {
  it('records a FAILURE when the roster write cannot proceed, and does not throw', async () => {
    const { client, rosterRpc } = buildRecordingClient({ loadFails: true })

    const outcome = await savePlayerMappings(
      { supabase: client, logger },
      { playerMappingTable: 'player_mapping', dataTable: 'raid_data' },
      'DEADGUILD',
      [{ userId: 'p1', displayName: 'Player One', role: 'member' }],
      ['p1']
    )

    expect(rosterRpc).toEqual([
      {
        p_guild_code: 'DEADGUILD',
        p_ok: false,
        p_rows_written: null,
        p_reason: expect.stringContaining('connection reset by peer')
      }
    ])
    expect(outcome).toMatchObject({ attempted: true, ok: false })
  })

  it('records NOTHING when the guards filter the whole snapshot away', async () => {
    // No eligible records is not a success; recording one would reset the failure counter.
    const { client, rosterRpc } = buildRecordingClient()

    const outcome = await savePlayerMappings(
      { supabase: client, logger },
      { playerMappingTable: 'player_mapping', dataTable: 'raid_data' },
      'EMPTYGUILD',
      [],
      ['p1']
    )

    expect(rosterRpc).toEqual([])
    expect(outcome).toMatchObject({ attempted: false })
  })
})
