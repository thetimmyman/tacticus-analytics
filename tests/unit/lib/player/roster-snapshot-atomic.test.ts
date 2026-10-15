import { expect, it, vi } from 'vitest'
import { persistRosterSnapshot } from '@/app/lib/player/roster-sync'

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn()
  })
}))
vi.mock('@/app/lib/player/item-catalog', () => ({ loadItemTypeMap: vi.fn() }))

const observation = {
  playerMappingId: 42,
  attemptId: '00000000-0000-4000-8000-000000000001',
  observedAt: '2026-01-01T00:00:00.000Z'
}

it('commits mapped units and power through one scoped snapshot operation', async () => {
  const rpc = vi.fn(() => ({
    abortSignal: async () => ({
      data: {
        status: 'applied',
        upserted: 1,
        playerPowerUpdated: true,
        unchanged: false,
        complete: true
      },
      error: null
    })
  }))
  const from = vi.fn((table: string) => {
    if (table !== 'hero_mappings')
      throw new Error('partial writes are forbidden')
    return {
      select: () => ({
        in: async () => ({
          data: [{ id: 7, unit_id: 'synthetic-unit' }],
          error: null
        })
      })
    }
  })
  const result = await persistRosterSnapshot(
    null,
    [{ id: 'synthetic-unit', progressionIndex: 1 }],
    [],
    { from, rpc } as never,
    42,
    {
      playerPower: 12345,
      observation
    }
  )
  expect(result).toMatchObject({
    upserted: 1,
    playerPowerUpdated: true,
    complete: true
  })
  expect(rpc).toHaveBeenCalledTimes(1)
  expect(rpc).toHaveBeenCalledWith(
    'persist_player_roster_snapshot',
    expect.objectContaining({
      p_player_mapping_id: 42,
      p_user_id: null,
      p_attempt_id: observation.attemptId,
      p_player_power: 12345,
      p_complete: true
    })
  )
  expect(from.mock.calls.map(([table]) => table)).toEqual(['hero_mappings'])
})

it('refuses to persist without the operation observation', async () => {
  const from = vi.fn(),
    rpc = vi.fn()
  await expect(
    persistRosterSnapshot(null, [], [], { from, rpc } as never, 42, {})
  ).rejects.toThrow('Roster observation required')
  expect(from).not.toHaveBeenCalled()
  expect(rpc).not.toHaveBeenCalled()
})
