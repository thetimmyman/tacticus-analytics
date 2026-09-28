import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  })
}))

vi.mock('@/app/lib/utils/error-handling', () => ({
  parseSupabaseError: vi.fn((error) => ({
    message: error?.message || 'Unknown error'
  }))
}))

import {
  beginGuildRosterObservation,
  markPlayersNotInGuildAsInactive,
  savePlayerMappings
} from '@/app/lib/sync/db-operations'
import type { LokiMember } from '@/app/lib/sync/transformers'

describe('beginGuildRosterObservation', () => {
  it('uses the database-issued timestamp and fails closed when unavailable', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({
        data: '2026-08-20T19:45:00.000Z',
        error: null
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: 'unavailable' }
      })
    const supabase = { rpc } as unknown as Parameters<
      typeof beginGuildRosterObservation
    >[0]

    await expect(beginGuildRosterObservation(supabase)).resolves.toBe(
      '2026-08-20T19:45:00.000Z'
    )
    await expect(beginGuildRosterObservation(supabase)).resolves.toBe(
      '1970-01-01T00:00:00.000Z'
    )
    expect(rpc).toHaveBeenNthCalledWith(1, 'begin_guild_roster_observation')
  })
})

function buildMockSupabase(
  currentRows: Array<{ player_id: string }>,
  options: { observationStale?: boolean } = {}
) {
  const deactivatedIds: string[][] = []

  const selectChain = {
    eq() {
      return this
    },
    or() {
      return Promise.resolve({ data: currentRows, error: null })
    }
  }

  const supabase = {
    from: vi.fn(() => ({
      select: () => selectChain
    })),
    rpc: vi.fn((_name: string, args: Record<string, unknown>) => {
      const ids = args.p_player_ids as string[]
      deactivatedIds.push(ids)
      return Promise.resolve({
        data: {
          success: true,
          guild_code: args.p_guild_code,
          requested_count: ids.length,
          deactivated_count: options.observationStale ? 0 : ids.length,
          observation_stale: options.observationStale ?? false,
          deactivated_mapping_ids: options.observationStale
            ? []
            : ids.map((_, index) => index + 1),
          revoked_attestations: 0,
          purged_loki_credential_count: 0,
          purged_loki_guild_codes: [],
          authority_cleared: true
        },
        error: null
      })
    })
  }

  return {
    supabase: supabase as unknown as Parameters<
      typeof markPlayersNotInGuildAsInactive
    >[0],
    deactivatedIds
  }
}

describe('markPlayersNotInGuildAsInactive (recent-activity guard)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('spares roster-present and recently-active members; only genuinely-departed C is deactivated', async () => {
    const { supabase, deactivatedIds } = buildMockSupabase([
      { player_id: 'A' },
      { player_id: 'B' },
      { player_id: 'C' }
    ])

    const currentMemberIds = new Set(['A'])
    const recentlyActiveIds = new Set(['B'])

    await markPlayersNotInGuildAsInactive(
      supabase,
      'GUILD01',
      currentMemberIds,
      recentlyActiveIds
    )

    expect(deactivatedIds).toHaveLength(1)
    expect(deactivatedIds[0]).toEqual(['C'])
  })

  it('does not call the atomic RPC when every absent member is spared', async () => {
    const { supabase, deactivatedIds } = buildMockSupabase([
      { player_id: 'A' },
      { player_id: 'B' }
    ])

    await markPlayersNotInGuildAsInactive(
      supabase,
      'GUILD01',
      new Set(['A']),
      new Set(['B'])
    )

    expect(deactivatedIds).toHaveLength(0)
  })

  it('still deactivates a genuinely-departed member with no recent activity', async () => {
    const { supabase, deactivatedIds } = buildMockSupabase([
      { player_id: 'A' },
      { player_id: 'Z' }
    ])

    await markPlayersNotInGuildAsInactive(
      supabase,
      'GUILD01',
      new Set(['A']),
      new Set()
    )

    expect(deactivatedIds).toHaveLength(1)
    expect(deactivatedIds[0]).toEqual(['Z'])
  })

  it('does not report deactivation when the roster predates a mapping update', async () => {
    const { supabase } = buildMockSupabase(
      [{ player_id: 'A' }, { player_id: 'Z' }],
      { observationStale: true }
    )

    const result = await markPlayersNotInGuildAsInactive(
      supabase,
      'GUILD01',
      new Set(['A']),
      new Set(),
      '2026-08-20T19:00:00.000Z'
    )

    expect(result).toEqual(new Set())
  })
})

describe('markPlayersNotInGuildAsInactive (D3 all-members circuit breaker)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('skips deactivation entirely when ALL current members are absent from the roster (>5)', async () => {
    const { supabase, deactivatedIds } = buildMockSupabase([
      { player_id: 'A' },
      { player_id: 'B' },
      { player_id: 'C' },
      { player_id: 'D' },
      { player_id: 'E' },
      { player_id: 'F' }
    ])

    await markPlayersNotInGuildAsInactive(
      supabase,
      'GUILD01',
      new Set(),
      new Set()
    )

    expect(deactivatedIds).toHaveLength(0)
  })

  it('does NOT trip the breaker for a small guild (<=5) so it can churn fully', async () => {
    const { supabase, deactivatedIds } = buildMockSupabase([
      { player_id: 'A' },
      { player_id: 'B' },
      { player_id: 'C' },
      { player_id: 'D' },
      { player_id: 'E' }
    ])

    await markPlayersNotInGuildAsInactive(
      supabase,
      'GUILD01',
      new Set(),
      new Set()
    )

    expect(deactivatedIds).toHaveLength(1)
    expect(deactivatedIds[0]!.sort()).toEqual(['A', 'B', 'C', 'D', 'E'])
  })

  it('does NOT trip the breaker when some members survive (rawCandidates < currentActiveCount)', async () => {
    const { supabase, deactivatedIds } = buildMockSupabase([
      { player_id: 'A' },
      { player_id: 'B' },
      { player_id: 'C' },
      { player_id: 'D' },
      { player_id: 'E' },
      { player_id: 'F' }
    ])

    await markPlayersNotInGuildAsInactive(
      supabase,
      'GUILD01',
      new Set(['A']),
      new Set()
    )

    expect(deactivatedIds).toHaveLength(1)
    expect(deactivatedIds[0]!.sort()).toEqual(['B', 'C', 'D', 'E', 'F'])
  })
})

describe('savePlayerMappings guarded authority writes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  function buildSaveMockSupabase(
    existingRows: Array<Record<string, unknown>>,
    options: {
      currentRows?: Array<Record<string, unknown>>
      malformedDeactivationProof?: boolean
    } = {}
  ) {
    const upsertedRecords: Array<Record<string, unknown>> = []
    const deactivationCalls: Array<Record<string, unknown>> = []

    const activityChain = {
      select: () => activityChain,
      eq: () => activityChain,
      gte: () => activityChain,
      order: () => Promise.resolve({ data: [], error: null })
    }

    const existingSelectInChain = {
      in: () => Promise.resolve({ data: existingRows, error: null })
    }

    const resetSelectChain = {
      eq() {
        return this
      },
      or() {
        return Promise.resolve({
          data: (options.currentRows ?? existingRows)
            .filter((row) => row.protected !== true && row.is_current !== false)
            .map((r) => ({ player_id: r.player_id })),
          error: null
        })
      }
    }

    let playerMappingSelectCall = 0

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'EOT_GR_data') {
          return activityChain
        }
        return {
          select: () => {
            playerMappingSelectCall += 1
            return playerMappingSelectCall === 1
              ? existingSelectInChain
              : resetSelectChain
          },
          upsert: (records: Array<Record<string, unknown>>) => {
            upsertedRecords.push(...records)
            return Promise.resolve({ data: null, error: null })
          }
        }
      }),
      rpc: vi.fn((_name: string, args: Record<string, unknown>) => {
        deactivationCalls.push(args)
        const ids = args.p_player_ids as string[]
        return Promise.resolve({
          data: options.malformedDeactivationProof
            ? { success: true }
            : {
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

    return {
      supabase: supabase as unknown as Parameters<typeof savePlayerMappings>[0],
      upsertedRecords,
      deactivationCalls
    }
  }

  it('omits ownership, Discord, app-admin authority AND user-supplied/credential columns from roster upserts', async () => {
    const existingRows = [
      {
        player_id: 'P1',
        user_id: 'auth-uid-123',
        protected: false,
        guild_code: 'GUILD01',
        is_current: true,
        tacticus_api_key_encrypted: 'enc:apikey:abc',
        discord_username: 'user#0001',
        discord_user_id: 'disc-999',
        tacticus_share_url: 'https://share/p1',
        theme_preference: 'dark',
        boss_preferences: { foo: 'bar' },
        is_app_admin: true,
        cluster_code: 'OLDC',
        cluster_id: 'old-cluster'
      }
    ]

    const { supabase, upsertedRecords } = buildSaveMockSupabase(existingRows)

    const lokiMembers: LokiMember[] = [
      { userId: 'P1', displayName: 'Tim', role: 'member' }
    ]

    await savePlayerMappings(supabase, 'GUILD01', lokiMembers, null, {
      cluster_code: 'NEWC',
      cluster_id: 'new-cluster'
    })

    const rec = upsertedRecords.find((r) => r.player_id === 'P1')
    expect(rec).toBeDefined()
    // The DB trigger owns authority; a service-role roster writer never carries it.
    expect(rec).not.toHaveProperty('user_id')
    expect(rec).not.toHaveProperty('ownership_attestation_id')
    expect(rec).not.toHaveProperty('discord_username')
    expect(rec).not.toHaveProperty('discord_user_id')
    expect(rec).not.toHaveProperty('is_app_admin')
    // Omitting credential columns stops a stale snapshot writing cleared values back.
    for (const forbidden of [
      'tacticus_api_key_encrypted',
      'tacticus_share_url',
      'theme_preference',
      'boss_preferences'
    ]) {
      expect(rec).not.toHaveProperty(forbidden)
    }
    expect(rec!.cluster_code).toBe('NEWC')
    expect(rec!.cluster_id).toBe('new-cluster')
    expect(rec!.display_name).toBe('Tim')
  })

  it('does not upsert a protected player at all (left untouched)', async () => {
    const existingRows = [
      {
        player_id: 'P2',
        user_id: 'auth-uid-999',
        protected: true,
        guild_code: 'GUILD01',
        is_current: true,
        tacticus_api_key_encrypted: 'enc:apikey:xyz',
        discord_username: null,
        discord_user_id: null,
        tacticus_share_url: null,
        theme_preference: null,
        boss_preferences: null,
        is_app_admin: null,
        cluster_code: null,
        cluster_id: null
      }
    ]

    const { supabase, upsertedRecords } = buildSaveMockSupabase(existingRows)

    const lokiMembers: LokiMember[] = [
      { userId: 'P2', displayName: 'Protected', role: 'member' }
    ]

    await savePlayerMappings(supabase, 'GUILD01', lokiMembers, null, null)

    expect(upsertedRecords.find((r) => r.player_id === 'P2')).toBeUndefined()
  })

  it('revokes old-guild authority before upserting a false transfer row', async () => {
    const existingRows = [
      {
        player_id: 'P3',
        protected: false,
        guild_code: 'OLDGUILD',
        is_current: true,
        tacticus_api_key_encrypted: null,
        tacticus_share_url: null,
        theme_preference: null,
        boss_preferences: null,
        cluster_code: null,
        cluster_id: null
      }
    ]
    const { supabase, upsertedRecords, deactivationCalls } =
      buildSaveMockSupabase(existingRows, { currentRows: [] })

    await savePlayerMappings(
      supabase,
      'NEWGUILD',
      [{ userId: 'P3', displayName: 'Departed', role: 'leader' }],
      ['P4'],
      null
    )

    expect(deactivationCalls).toEqual([
      expect.objectContaining({
        p_guild_code: 'OLDGUILD',
        p_player_ids: ['P3'],
        p_reason: 'roster_deactivation',
        p_source: 'app.player-mappings.mark-absent'
      })
    ])
    expect(upsertedRecords).toContainEqual(
      expect.objectContaining({
        player_id: 'P3',
        guild_code: 'NEWGUILD',
        is_current: false,
        role: 'member'
      })
    )
  })

  it('leaves an attested cross-guild player for the onboarding reconciler', async () => {
    const existingRows = [
      {
        player_id: 'P7',
        protected: false,
        guild_code: 'OLDGUILD',
        is_current: true,
        user_id: 'subject-7',
        ownership_attestation_id: 'attestation-7',
        cluster_code: null,
        cluster_id: null
      }
    ]
    const { supabase, upsertedRecords, deactivationCalls } =
      buildSaveMockSupabase(existingRows, { currentRows: [] })

    await savePlayerMappings(
      supabase,
      'NEWGUILD',
      [{ userId: 'P7', displayName: 'Claimed', role: 'leader' }],
      ['P7'],
      null
    )

    expect(deactivationCalls).toEqual([])
    expect(upsertedRecords).toEqual([])
  })

  it('aborts the upsert when atomic deactivation proof is malformed', async () => {
    const existingRows = [
      {
        player_id: 'P5',
        protected: false,
        guild_code: 'GUILD01',
        is_current: true,
        tacticus_api_key_encrypted: null,
        tacticus_share_url: null,
        theme_preference: null,
        boss_preferences: null,
        cluster_code: null,
        cluster_id: null
      }
    ]
    const { supabase, upsertedRecords } = buildSaveMockSupabase(existingRows, {
      malformedDeactivationProof: true
    })

    await savePlayerMappings(
      supabase,
      'GUILD01',
      [{ userId: 'P6', displayName: 'Current', role: 'member' }],
      null,
      null
    )

    expect(upsertedRecords).toEqual([])
  })
})
