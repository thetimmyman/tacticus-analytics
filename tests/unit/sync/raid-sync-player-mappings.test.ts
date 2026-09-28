import { describe, it, expect } from 'vitest'
import { updatePlayerMappings } from '@/app/lib/sync/worker-jobs/raid-sync'
import type { RawRaidEntry } from '@/app/lib/sync/transformers'
import type {
  ServiceSupabaseClient,
  WorkerResult
} from '@/app/lib/sync/worker-types'

/**
 * Enabling the write must not reactivate a transferred member, strip a partial-window
 * duplicate label, or overwrite an Article 17 tombstone.
 */
type Row = Record<string, unknown>

type Capture = {
  upserts: Row[][]
  updates: Array<{ playerId: unknown; payload: Row }>
}

function makeSupabase(
  capture: Capture,
  fixtures: { mappingRows?: Row[]; rosterRows?: Row[] } = {}
) {
  const fromHandler = (table: string) => {
    if (table !== 'player_mapping') {
      throw new Error(`Unexpected .from('${table}') in raid-sync test`)
    }
    return {
      select: (_columns: string) => {
        let byPlayerId = false
        const builder = {
          in: (_column: string, _values: readonly unknown[]) => {
            byPlayerId = true
            return builder
          },
          eq: (_column: string, _value: unknown) => builder,
          then: (resolve: (value: { data: Row[]; error: null }) => unknown) =>
            Promise.resolve({
              data: byPlayerId
                ? (fixtures.mappingRows ?? [])
                : (fixtures.rosterRows ?? []),
              error: null
            }).then(resolve)
        }
        return builder
      },
      upsert: (rows: Row | Row[], _opts?: Record<string, unknown>) => {
        capture.upserts.push(Array.isArray(rows) ? rows : [rows])
        return Promise.resolve({ data: null, error: null })
      },
      update: (payload: Row) => ({
        eq: (_column: string, playerId: unknown) => {
          capture.updates.push({ playerId, payload })
          return Promise.resolve({ data: null, error: null })
        }
      })
    }
  }
  return { from: fromHandler } as unknown as ServiceSupabaseClient
}

function makeCapture(): Capture {
  return { upserts: [], updates: [] }
}

function makeResult(): WorkerResult {
  return {
    jobId: 'job-1',
    success: true,
    recordsProcessed: 0,
    playersUpdated: 0,
    errors: [],
    upsertFailures: 0,
    duration: 0
  } as WorkerResult
}

function entry(userId: string, username?: string): RawRaidEntry {
  return (
    username === undefined ? { userId } : { userId, username }
  ) as RawRaidEntry
}

describe('updatePlayerMappings', () => {
  it('writes player_mapping from entry.username when the payload carries a real name', async () => {
    const capture = makeCapture()
    const supabase = makeSupabase(capture)
    const result = makeResult()

    const resolved = await updatePlayerMappings(
      'GUILD',
      [entry('user-1', 'RealUpstreamName')],
      supabase,
      result
    )

    expect(capture.upserts).toHaveLength(1)
    expect(capture.upserts[0]).toEqual([
      expect.objectContaining({
        player_id: 'user-1',
        display_name: 'RealUpstreamName',
        guild_code: 'GUILD',
        is_current: true
      })
    ])
    expect(result.playersUpdated).toBe(1)
    expect(resolved.get('user-1')).toBe('RealUpstreamName')
  })

  it('does not silently no-op when only entry.username (not entry.displayName) is present', async () => {
    const capture = makeCapture()
    const supabase = makeSupabase(capture)

    await updatePlayerMappings(
      'GUILD',
      [entry('user-2', 'AnotherRealName')],
      supabase,
      makeResult()
    )

    expect(capture.upserts.length).toBeGreaterThan(0)
  })

  it('never writes an upstream Player# alias username into player_mapping as a resolved name', async () => {
    const capture = makeCapture()
    const supabase = makeSupabase(capture)
    const result = makeResult()

    await updatePlayerMappings(
      'GUILD',
      [entry('user-3', 'Player#ABCDEF')],
      supabase,
      result
    )

    // An alias-shaped name is not a resolvable identity, so nothing is written.
    expect(capture.upserts).toHaveLength(0)
    expect(result.playersUpdated).toBe(0)
  })

  it('skips entries with no resolvable name and writes nothing', async () => {
    const capture = makeCapture()
    const supabase = makeSupabase(capture)
    const result = makeResult()

    await updatePlayerMappings('GUILD', [entry('user-4')], supabase, result)

    expect(capture.upserts).toHaveLength(0)
    expect(result.playersUpdated).toBe(0)
  })

  it('never asserts guild membership for a player who already has a mapping row', async () => {
    // Replaying the old guild's battles must not pull the member (and officer authority) back.
    const capture = makeCapture()
    const supabase = makeSupabase(capture, {
      mappingRows: [
        {
          player_id: 'transferred-1',
          display_name: 'Traveller',
          original_display_name: null,
          has_duplicate_name: false
        }
      ]
    })
    const result = makeResult()

    await updatePlayerMappings(
      'OLDGUILD',
      [entry('transferred-1', 'TravellerRenamed')],
      supabase,
      result
    )

    expect(capture.upserts).toHaveLength(0)
    expect(capture.updates).toHaveLength(1)
    expect(capture.updates[0]?.playerId).toBe('transferred-1')
    expect(capture.updates[0]?.payload).toMatchObject({
      display_name: 'TravellerRenamed'
    })
    expect(capture.updates[0]?.payload).not.toHaveProperty('guild_code')
    expect(capture.updates[0]?.payload).not.toHaveProperty('is_current')
    expect(capture.updates[0]?.payload).not.toHaveProperty('role')
  })

  it('creates a mapping — and only then asserts membership — for a player with no row anywhere', async () => {
    const capture = makeCapture()
    const supabase = makeSupabase(capture, { mappingRows: [] })

    await updatePlayerMappings(
      'GUILD',
      [entry('first-seen-1', 'Rookie')],
      supabase,
      makeResult()
    )

    expect(capture.updates).toHaveLength(0)
    expect(capture.upserts[0]?.[0]).toMatchObject({
      player_id: 'first-seen-1',
      guild_code: 'GUILD',
      is_current: true
    })
  })

  it('keeps a duplicate-name label when only one of the two namesakes battled in this window', async () => {
    // A window-only cohort would make Bob #1 look unique and strip the `Bob (GUILD_01)` join key.
    const capture = makeCapture()
    const supabase = makeSupabase(capture, {
      mappingRows: [
        {
          player_id: 'bob-1',
          display_name: 'Bob (GUILD_01)',
          original_display_name: 'Bob',
          has_duplicate_name: true
        }
      ],
      rosterRows: [
        {
          player_id: 'bob-1',
          display_name: 'Bob (GUILD_01)',
          original_display_name: 'Bob'
        },
        {
          player_id: 'bob-2',
          display_name: 'Bob (GUILD_02)',
          original_display_name: 'Bob'
        }
      ]
    })
    const result = makeResult()

    const resolved = await updatePlayerMappings(
      'GUILD',
      [entry('bob-1', 'Bob')],
      supabase,
      result
    )

    expect(capture.upserts).toHaveLength(0)
    expect(capture.updates).toHaveLength(0)
    expect(resolved.get('bob-1')).toBe('Bob (GUILD_01)')
  })

  it('never un-suffixes a duplicate-labelled member from raid history', async () => {
    // Raid history cannot clear a label; only the roster path, which sees who left, may un-suffix.
    const capture = makeCapture()
    const supabase = makeSupabase(capture, {
      mappingRows: [
        {
          player_id: 'bob-1',
          display_name: 'Bob (GUILD_01)',
          original_display_name: 'Bob',
          has_duplicate_name: true
        }
      ],
      rosterRows: []
    })

    const resolved = await updatePlayerMappings(
      'GUILD',
      [entry('bob-1', 'Bob')],
      supabase,
      makeResult()
    )

    expect(capture.upserts).toHaveLength(0)
    expect(capture.updates).toHaveLength(0)
    expect(resolved.get('bob-1')).toBe('Bob (GUILD_01)')
  })

  it('writes nothing for a player id the caller flagged as erased', async () => {
    const capture = makeCapture()
    const supabase = makeSupabase(capture, { mappingRows: [] })
    const result = makeResult()

    const resolved = await updatePlayerMappings(
      'GUILD',
      [entry('erased-1', 'TheirRealName')],
      supabase,
      result,
      new Set(['erased-1'])
    )

    expect(capture.upserts).toHaveLength(0)
    expect(capture.updates).toHaveLength(0)
    expect(result.playersUpdated).toBe(0)
    expect(resolved.has('erased-1')).toBe(false)
  })

  it('never renames a tombstoned mapping row, even if the caller did not flag it', async () => {
    const capture = makeCapture()
    const supabase = makeSupabase(capture, {
      mappingRows: [
        {
          player_id: 'erased-2',
          display_name: '[DELETED_USER_9f8e7d6c]',
          original_display_name: null,
          has_duplicate_name: false
        }
      ]
    })

    const resolved = await updatePlayerMappings(
      'GUILD',
      [entry('erased-2', 'TheirRealName')],
      supabase,
      makeResult()
    )

    expect(capture.upserts).toHaveLength(0)
    expect(capture.updates).toHaveLength(0)
    expect(resolved.get('erased-2')).toBe('[DELETED_USER_9f8e7d6c]')
  })

  it('never promotes a tombstone-shaped upstream username', async () => {
    const capture = makeCapture()
    const supabase = makeSupabase(capture, { mappingRows: [] })

    await updatePlayerMappings(
      'GUILD',
      [entry('odd-1', '[DELETED_USER_deadbeef]')],
      supabase,
      makeResult()
    )

    expect(capture.upserts).toHaveLength(0)
    expect(capture.updates).toHaveLength(0)
  })
})
