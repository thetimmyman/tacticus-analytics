import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

vi.mock('@/app/(dashboard)/roster/utils/roster-helpers', () => ({
  getRankName: vi.fn(() => 'Stone 1'),
  getRarityFromProgressionIndex: vi.fn(() => 'Common')
}))

vi.mock('@/app/lib/player/item-catalog', () => ({
  loadItemTypeMap: vi.fn()
}))

import { persistRosterSnapshot } from '@/app/lib/player/roster-sync'

function buildSupabase() {
  const eqCalls: Array<[string, unknown]> = []
  const updateSpy = vi.fn()
  const updateChain = {
    eq: vi.fn((column: string, value: string | number | boolean) => {
      eqCalls.push([column, value])
      return updateChain
    }),
    then: (
      resolve: (value: { error: null }) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve({ error: null }).then(resolve, reject)
  }
  updateSpy.mockReturnValue(updateChain)

  return {
    supabase: {
      from: vi.fn((table: string) => {
        if (table === 'player_mapping') {
          return { update: updateSpy }
        }
        throw new Error(`Unexpected table: ${table}`)
      })
    },
    eqCalls,
    updateSpy
  }
}

describe('persistRosterSnapshot player_power persistence', () => {
  it('updates player_power from a trusted player-profile value by user_id', async () => {
    const { supabase, eqCalls, updateSpy } = buildSupabase()

    const result = await persistRosterSnapshot(
      'user-123',
      [],
      [],
      supabase as never,
      undefined,
      { playerPower: 12345.9 }
    )

    expect(result).toEqual({ upserted: 0, playerPowerUpdated: true })
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ player_power: 12345 })
    )
    expect(eqCalls).toContainEqual(['user_id', 'user-123'])
    expect(eqCalls).toContainEqual(['is_current', true])
  })

  it('prefers player_mapping id scoping when available', async () => {
    const { supabase, eqCalls, updateSpy } = buildSupabase()

    const result = await persistRosterSnapshot(
      'user-123',
      [],
      [],
      supabase as never,
      42,
      { playerPower: 0 }
    )

    expect(result.playerPowerUpdated).toBe(true)
    expect(updateSpy).toHaveBeenCalledWith(
      expect.objectContaining({ player_power: 0 })
    )
    expect(eqCalls).toEqual([['id', 42]])
  })

  it('does not write invalid power values', async () => {
    const { supabase, updateSpy } = buildSupabase()

    const result = await persistRosterSnapshot(
      'user-123',
      [],
      [],
      supabase as never,
      undefined,
      { playerPower: -1 }
    )

    expect(result).toEqual({ upserted: 0, playerPowerUpdated: false })
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('keeps claimed-player roster rows on the user_id conflict path', async () => {
    const { supabase, updateSpy } = buildSupabase()
    const upsertSpy = vi.fn().mockResolvedValue({ error: null })

    vi.mocked(supabase.from).mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return { update: updateSpy }
      }
      if (table === 'hero_mappings') {
        return {
          select: vi.fn(() => ({
            in: vi.fn().mockResolvedValue({
              data: [{ id: 7, unit_id: 'hero-a' }],
              error: null
            })
          }))
        }
      }
      if (table === 'player_roster') {
        return { upsert: upsertSpy }
      }
      throw new Error(`Unexpected table: ${table}`)
    })

    const result = await persistRosterSnapshot(
      'user-123',
      [{ id: 'hero-a', progressionIndex: 1 }],
      [],
      supabase as never,
      42
    )

    expect(result).toEqual({ upserted: 1, playerPowerUpdated: false })
    expect(upsertSpy).toHaveBeenCalledWith(
      [expect.objectContaining({ user_id: 'user-123', hero_mapping_id: 7 })],
      { onConflict: 'user_id,hero_mapping_id', ignoreDuplicates: false }
    )
    const row = upsertSpy.mock.calls[0]?.[0]?.[0] as Record<string, unknown>
    expect(row).not.toHaveProperty('player_mapping_id')
  })
})
