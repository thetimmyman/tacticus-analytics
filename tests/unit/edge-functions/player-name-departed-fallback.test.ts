// Departed names are a last-resort fallback and never grant guild membership.
import { describe, expect, it, vi } from 'vitest'
import {
  PLAYER_NAME_ROW_COLUMNS,
  buildPlayerNameIndex,
  createPlayerNameMapCache,
  fetchPlayerNameMapPaged,
  pickPlayerName,
  resolveDisplayName,
  seedErasureNames,
  seedSyncPlayerMappings,
  type PlayerNameMap,
  type PlayerNamePageClient,
  type PlayerNameRow
} from '@/supabase/functions/_shared/player-name-resolution-core'
import { processRaidEntry } from '@/supabase/functions/_shared/sync-modules/transforms'

const current = (player_id: string, display_name: string): PlayerNameRow => ({
  player_id,
  display_name,
  is_current: true
})
const departed = (player_id: string, display_name: string): PlayerNameRow => ({
  player_id,
  display_name,
  is_current: false
})

describe('buildPlayerNameIndex', () => {
  it('keeps current and departed names in separate maps', () => {
    const index = buildPlayerNameIndex([
      current('cur', 'Current Name'),
      departed('gone', 'Departed Name')
    ])
    expect([...index.currentNames]).toEqual([['cur', 'Current Name']])
    expect([...index.departedNames]).toEqual([['gone', 'Departed Name']])
    expect([...index.currentIds]).toEqual(['cur'])
  })

  it('a departed member resolves to a real name instead of Player#', () => {
    const { departedNames } = buildPlayerNameIndex([
      departed('abc-123', 'Gone')
    ])
    expect(resolveDisplayName('', 'abc-123', departedNames)).toBe('Gone')
  })

  it('never uses an erasure tombstone or placeholder as a fallback', () => {
    const { departedNames } = buildPlayerNameIndex([
      departed('erased', '[DELETED_USER_1726000000000]'),
      departed('alias', 'Player#ABCDEF')
    ])
    expect(departedNames.size).toBe(0)
  })

  it('a current row still wins if normalization folds two ids together', () => {
    const index = buildPlayerNameIndex(
      [departed('ID-1', 'Departed'), current('id-1', 'Current')],
      (id) => id.toLowerCase()
    )
    expect(index.currentNames.get('id-1')).toBe('Current')
    expect(index.departedNames.has('id-1')).toBe(false)
  })

  it('emits only player_id -> display_name and ignores identity columns', () => {
    const leaky = {
      ...departed('p7', 'Departed'),
      user_id: '00000000-0000-0000-0000-000000000001',
      discord_user_id: '123456789012345678',
      discord_username: 'someone#1',
      tacticus_api_key_encrypted: 'secret'
    } as PlayerNameRow
    const index = buildPlayerNameIndex([leaky])
    const serialized = JSON.stringify([
      ...index.currentNames,
      ...index.departedNames
    ])
    expect(serialized).toBe('[["p7","Departed"]]')
  })

  it('selects only identity-free columns', () => {
    expect(PLAYER_NAME_ROW_COLUMNS).toBe('player_id, display_name, is_current')
  })
})

describe('pickPlayerName precedence', () => {
  it('current -> live -> departed', () => {
    expect(pickPlayerName('Cur', 'Live', 'Old')).toBe('Cur')
    expect(pickPlayerName(undefined, 'Live', 'Old')).toBe('Live')
    expect(pickPlayerName(undefined, '  ', 'Old')).toBe('Old')
    expect(pickPlayerName(undefined, undefined, undefined)).toBeUndefined()
  })
})

describe('raid sync precedence (seedSyncPlayerMappings + processRaidEntry)', () => {
  const entry = (userId: string, username?: string) =>
    ({
      userId,
      username,
      encounterIndex: 0,
      type: 'Boss',
      damageDealt: 1,
      damageType: 'Normal',
      startedOn: 1_700_000_000,
      completedOn: 1_700_000_010,
      tier: 1,
      set: 0,
      rarity: 'Legendary',
      maxHp: 10,
      remainingHp: 5,
      encounterId: 1
    }) as never
  const run = (username?: string) => {
    const primary: Record<string, string> = {}
    const departedMap = seedSyncPlayerMappings(
      [current('cur', 'Current'), departed('gone', 'Old')],
      primary
    )
    return {
      current: processRaidEntry(
        entry('cur', 'Other'),
        'G',
        1,
        primary,
        {},
        null,
        null,
        undefined,
        departedMap
      )?.displayName,
      gone: processRaidEntry(
        entry('gone', username),
        'G',
        1,
        primary,
        {},
        null,
        null,
        undefined,
        departedMap
      )?.displayName
    }
  }

  it('current mapping beats the raid username', () => {
    expect(run().current).toBe('Current')
  })
  it("departed 'Old' + raid username 'New' => 'New'", () => {
    expect(run('New').gone).toBe('New')
  })
  it('departed name is used only when the username is unusable', () => {
    expect(run(undefined).gone).toBe('Old')
    expect(run('Player#ABCDEF').gone).toBe('Old')
  })
  it('departed names never enter the primary map', () => {
    const primary: Record<string, string> = { live: 'Loki' }
    seedSyncPlayerMappings(
      [departed('gone', 'Old'), current('live', 'Db')],
      primary
    )
    expect(primary).toEqual({ live: 'Loki' })
  })
})

describe('erasure precedence in raid sync (executed)', () => {
  const entry = (userId: string, username?: string) =>
    ({
      userId,
      username,
      encounterIndex: 0,
      type: 'Boss',
      damageDealt: 1,
      damageType: 'Normal',
      startedOn: 1_700_000_000,
      completedOn: 1_700_000_010,
      tier: 1,
      set: 0,
      rarity: 'Legendary',
      maxHp: 10,
      remainingHp: 5,
      encounterId: 1
    }) as never
  const nameFor = (
    playerId: string,
    tombstones: Record<string, string>,
    withheld: string[],
    username = 'Real Upstream Name'
  ) => {
    const primary: Record<string, string> = {}
    const departedMap = seedSyncPlayerMappings(
      [departed(playerId, 'Departed Real Name')],
      primary
    )
    seedErasureNames(primary, tombstones, withheld)
    return processRaidEntry(
      entry(playerId, username),
      'G',
      1,
      primary,
      {},
      null,
      null,
      undefined,
      departedMap
    )?.displayName
  }

  it('a tombstone beats both the departed name and the upstream username', () => {
    expect(nameFor('erased', { erased: '[DELETED_USER_abc12345]' }, [])).toBe(
      '[DELETED_USER_abc12345]'
    )
  })

  it('an unreadable erasure status falls back to the alias, not the departed name', () => {
    const name = nameFor('unknown-status', {}, ['unknown-status'], '')
    expect(name).toMatch(/^Player#/)
    expect(name).not.toBe('Departed Real Name')
  })

  it('positive control: with no erasure the departed name is used', () => {
    expect(nameFor('gone', {}, [], '')).toBe('Departed Real Name')
  })
})

type Row = PlayerNameRow & { id: number }
const pagedClient = (rows: Row[], failAfterCalls = Infinity) => {
  const gtCalls: number[] = []
  let calls = 0
  const client: PlayerNamePageClient = {
    from: () => ({
      select: () => ({
        order: () => ({
          gt: (_c, lastId) => {
            gtCalls.push(lastId)
            return {
              limit: (n) => {
                calls++
                if (calls > failAfterCalls) {
                  return Promise.resolve({
                    data: null,
                    error: { message: 'boom' }
                  })
                }
                const page = rows.filter((r) => r.id > lastId).slice(0, n)
                return Promise.resolve({ data: page, error: null })
              }
            }
          }
        })
      })
    })
  }
  return { client, gtCalls }
}
const rowsN = (n: number): Row[] =>
  Array.from({ length: n }, (_, i) => ({
    id: (i + 1) * 10,
    player_id: `p${i + 1}`,
    display_name: `Name ${i + 1}`,
    is_current: i % 2 === 0
  }))

describe('fetchPlayerNameMapPaged (keyset)', () => {
  it('terminates on an exact multiple of the page size', async () => {
    const { client, gtCalls } = pagedClient(rowsN(6))
    const map = await fetchPlayerNameMapPaged(client, { pageSize: 3 })
    expect(gtCalls).toEqual([0, 30, 60])
    expect(map.get('p6')).toBe('Name 6')
    expect(map.get('p5')).toBe('Name 5')
  })

  it('throws when the page cap is reached', async () => {
    const { client } = pagedClient(rowsN(10))
    await expect(
      fetchPlayerNameMapPaged(client, { pageSize: 2, maxPages: 3 })
    ).rejects.toThrow('page limit exceeded')
  })

  it('merges current names first, departed as fallback, with lowercase keys', async () => {
    const { client } = pagedClient([
      { id: 1, player_id: 'CUR', display_name: 'Current', is_current: true },
      { id: 2, player_id: 'GONE', display_name: 'Old', is_current: false }
    ])
    const map = await fetchPlayerNameMapPaged(client)
    expect(map.get('CUR')).toBe('Current')
    expect(map.get('gone')).toBe('Old')
  })
})

describe('createPlayerNameMapCache', () => {
  it('serves the stale cache when a refresh fails, and throws with no cache', async () => {
    let t = 0
    const good: PlayerNameMap = new Map([['p', 'Name']])
    const fetcher = vi
      .fn<(c: null) => Promise<PlayerNameMap>>()
      .mockResolvedValueOnce(good)
      .mockRejectedValueOnce(new Error('db down'))
    const warn = vi.fn()
    const load = createPlayerNameMapCache(fetcher, {
      ttlMs: 10,
      now: () => t,
      warn
    })
    expect(await load(null)).toBe(good)
    t = 100
    expect(await load(null)).toBe(good)
    expect(warn).toHaveBeenCalledOnce()

    const cold = createPlayerNameMapCache(
      () => Promise.reject(new Error('db down')),
      { ttlMs: 10 }
    )
    await expect(cold(null)).rejects.toThrow('db down')
  })
})
