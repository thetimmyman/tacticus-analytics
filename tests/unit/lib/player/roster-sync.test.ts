import { describe, expect, it, vi } from 'vitest'
import { persistRosterSnapshot } from '@/app/lib/player/roster-sync'
import { loadItemTypeMap } from '@/app/lib/player/item-catalog'

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  })
}))
vi.mock('@/app/(dashboard)/roster/utils/roster-helpers', () => ({
  getRankName: () => 'Stone 1',
  getRarityFromProgressionIndex: () => 'Common'
}))
vi.mock('@/app/lib/player/item-catalog', () => ({ loadItemTypeMap: vi.fn() }))
const observation = {
  playerMappingId: 42,
  attemptId: '00000000-0000-4000-8000-000000000001',
  observedAt: '2026-01-01T00:00:00.000Z'
}
const owner = '00000000-0000-4000-8000-000000000002'
function client() {
  const rpc = vi.fn(
    (
      _name: string,
      args: {
        p_rows: unknown[]
        p_player_power: number | null
        p_complete: boolean
      }
    ) => ({
      abortSignal: async () => ({
        data: {
          status: 'applied',
          upserted: args.p_rows.length,
          playerPowerUpdated: args.p_player_power !== null,
          unchanged: false,
          complete: args.p_complete
        },
        error: null
      })
    })
  )
  const from = vi.fn((table: string) => {
    if (table !== 'hero_mappings')
      throw new Error('Unexpected direct snapshot write')
    return {
      select: () => ({
        in: async () => ({
          data: [{ id: 7, unit_id: 'synthetic-unit' }],
          error: null
        })
      })
    }
  })
  return { rpc, from }
}

describe('persistRosterSnapshot', () => {
  it('does not let duplicate known units hide an unmapped unit', async () => {
    const supabase = client()
    await persistRosterSnapshot(
      owner,
      [
        { id: 'synthetic-unit' },
        { id: 'synthetic-unit' },
        { id: 'unmapped-unit' }
      ],
      [],
      supabase as never,
      42,
      { observation, playerPower: 50 }
    )
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_player_roster_snapshot',
      expect.objectContaining({
        p_rows: [],
        p_complete: false,
        p_player_power: 50
      })
    )
  })
  it.each(['missing', 'unavailable'])(
    'preserves existing roster when equipment classification is %s',
    async (failure) => {
      if (failure === 'missing')
        vi.mocked(loadItemTypeMap).mockResolvedValueOnce(new Map())
      else
        vi.mocked(loadItemTypeMap).mockRejectedValueOnce(
          new Error('catalog unavailable')
        )
      const supabase = client()
      await persistRosterSnapshot(
        owner,
        [{ id: 'synthetic-unit', items: [{ id: 'synthetic-item', level: 3 }] }],
        [],
        supabase as never,
        42,
        { observation, playerPower: 50 }
      )
      expect(supabase.rpc).toHaveBeenCalledWith(
        'persist_player_roster_snapshot',
        expect.objectContaining({
          p_rows: [],
          p_complete: false,
          p_player_power: 50
        })
      )
    }
  )
  it('does not persist a partial mapping result as a complete roster', async () => {
    const supabase = client()
    await persistRosterSnapshot(
      owner,
      [{ id: 'synthetic-unit' }, { id: 'unmapped-unit' }],
      [],
      supabase as never,
      42,
      { observation }
    )
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_player_roster_snapshot',
      expect.objectContaining({ p_rows: [], p_complete: false })
    )
  })
  it('normalizes trusted power and preserves the scoped observation for an empty roster', async () => {
    const supabase = client()
    const result = await persistRosterSnapshot(
      owner,
      [],
      [],
      supabase as never,
      42,
      { playerPower: 12345.9, observation }
    )
    expect(result).toMatchObject({
      upserted: 0,
      playerPowerUpdated: true,
      complete: false
    })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_player_roster_snapshot',
      expect.objectContaining({
        p_user_id: owner,
        p_player_mapping_id: 42,
        p_player_power: 12345,
        p_complete: false
      })
    )
    expect(supabase.from).not.toHaveBeenCalled()
  })
  it('refuses a snapshot for a different mapping than the observed one', async () => {
    const supabase = client()
    await expect(
      persistRosterSnapshot(owner, [], [], supabase as never, 43, {
        observation
      })
    ).rejects.toThrow('Roster observation required')
    expect(supabase.rpc).not.toHaveBeenCalled()
  })
  it('does not submit an invalid power value', async () => {
    const supabase = client()
    expect(
      await persistRosterSnapshot(owner, [], [], supabase as never, 42, {
        playerPower: -1,
        observation
      })
    ).toMatchObject({ playerPowerUpdated: false })
    expect(supabase.rpc).toHaveBeenCalledWith(
      'persist_player_roster_snapshot',
      expect.objectContaining({ p_player_power: null })
    )
  })
  it('keeps ownership outside normalized rows and lets the authority choose conflict scope', async () => {
    const supabase = client()
    const result = await persistRosterSnapshot(
      owner,
      [{ id: 'synthetic-unit', progressionIndex: 1 }],
      [],
      supabase as never,
      42,
      { observation }
    )
    expect(result).toMatchObject({ upserted: 1, complete: true })
    const row = supabase.rpc.mock.calls[0]?.[1].p_rows[0]
    expect(row).toMatchObject({ hero_mapping_id: 7, stars: 1 })
    expect(row).not.toHaveProperty('user_id')
    expect(row).not.toHaveProperty('player_mapping_id')
    expect(row).not.toHaveProperty('synced_at')
  })
})
