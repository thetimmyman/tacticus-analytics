// Prime HP comes from the main's get_current_boss_status rows; a defeated prime's null HP is 0.
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useCurrentBossStatus } from '@/app/(dashboard)/guild-management/upcoming-assignments/hooks/useCurrentBossStatus'

const rpcMock = vi.fn()
const fromMock = vi.fn()

const PROGRESSION_CONFIG = {
  firstPassSequence: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2', 'M3'],
  loopSequence: ['L4', 'L5', 'M1', 'M2', 'M3'],
  loopStartStage: 'L4',
  gameVersion: 'test'
}

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    rpc: rpcMock,
    from: fromMock
  })
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

const RPC_ROWS = [
  {
    boss_name: 'Szarekh',
    rarity: 'Legendary',
    set: 2,
    encounter_id: 0,
    max_hp: 1000,
    remaining_hp: 500,
    loop_index: 0,
    completed_on: '2026-07-27T10:00:00Z',
    lifecycle_state: 'warded',
    warded: true,
    alive_primes: 1
  },
  {
    boss_name: 'Hapthatra Prime',
    rarity: 'Legendary',
    set: 2,
    encounter_id: 1,
    max_hp: 800,
    remaining_hp: null,
    loop_index: 0,
    completed_on: '2026-07-27T09:00:00Z',
    lifecycle_state: 'defeated',
    warded: false,
    alive_primes: 1
  },
  {
    boss_name: 'Mesophet Prime',
    rarity: 'Legendary',
    set: 2,
    encounter_id: 2,
    max_hp: 900,
    remaining_hp: 300,
    loop_index: 0,
    completed_on: '2026-07-27T09:30:00Z',
    lifecycle_state: 'active',
    warded: false,
    alive_primes: 1
  }
]

beforeEach(() => {
  rpcMock.mockReset()
  fromMock.mockReset()
  rpcMock.mockResolvedValue({ data: RPC_ROWS, error: null })
})

describe('useCurrentBossStatus prime source (F7)', () => {
  it('builds prime encounters from the RPC rows without any inline table query', async () => {
    const { result } = renderHook(
      () =>
        useCurrentBossStatus({
          guildCode: 'G1',
          seasonNumber: '104',
          progressionConfig: PROGRESSION_CONFIG,
          enabled: true
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.data?.hasData).toBe(true)
    })

    const encounters = result.current.data?.encounters ?? []
    expect(encounters).toHaveLength(3)

    const prime1 = encounters.find((e) => e.encounterId === 1)
    const prime2 = encounters.find((e) => e.encounterId === 2)

    expect(prime1?.bossName).toBe('Hapthatra Prime')
    expect(prime1?.remainingHp).toBe(0)
    expect(prime1?.maxHp).toBe(800)

    expect(prime2?.bossName).toBe('Mesophet Prime')
    expect(prime2?.remainingHp).toBe(300)
    expect(prime2?.maxHp).toBe(900)

    expect(fromMock).not.toHaveBeenCalled()
    expect(rpcMock).toHaveBeenCalledWith('get_current_boss_status', {
      p_guild_code: 'G1',
      p_season: '104'
    })
  })

  it('zeroes a defeated prime even when its latest row carries stale positive HP', async () => {
    // An out-of-order bomb row leaves remaining_hp positive; lifecycle_state must win.
    rpcMock.mockResolvedValue({
      data: [
        RPC_ROWS[0],
        { ...RPC_ROWS[1], remaining_hp: 450, lifecycle_state: 'defeated' }
      ],
      error: null
    })

    const { result } = renderHook(
      () =>
        useCurrentBossStatus({
          guildCode: 'G1',
          seasonNumber: '104',
          progressionConfig: PROGRESSION_CONFIG,
          enabled: true
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.data?.hasData).toBe(true)
    })

    const prime1 = result.current.data?.encounters.find(
      (e) => e.encounterId === 1
    )
    expect(prime1?.remainingHp).toBe(0)
  })

  it('keeps un-engaged prime slots as null-HP placeholders', async () => {
    rpcMock.mockResolvedValue({ data: [RPC_ROWS[0]], error: null })

    const { result } = renderHook(
      () =>
        useCurrentBossStatus({
          guildCode: 'G1',
          seasonNumber: '104',
          progressionConfig: PROGRESSION_CONFIG,
          enabled: true
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.data?.hasData).toBe(true)
    })

    const encounters = result.current.data?.encounters ?? []
    expect(encounters).toHaveLength(3)
    const prime1 = encounters.find((e) => e.encounterId === 1)
    expect(prime1?.bossName).toBeNull()
    expect(prime1?.remainingHp).toBeNull()
    expect(prime1?.maxHp).toBeNull()
    expect(fromMock).not.toHaveBeenCalled()
  })

  it('keeps the observed defeated stage when progression config is unavailable', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          ...RPC_ROWS[0],
          remaining_hp: 0,
          lifecycle_state: 'defeated'
        }
      ],
      error: null
    })

    const { result } = renderHook(
      () =>
        useCurrentBossStatus({
          guildCode: 'G1',
          seasonNumber: '104',
          progressionConfig: null,
          enabled: true
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.data?.hasData).toBe(true)
    })

    expect(result.current.data).toEqual(
      expect.objectContaining({
        stageCode: 'L3',
        loopIndex: 0,
        advancedStage: false,
        remainingHp: 0,
        maxHp: 1000,
        bossNameFromData: 'Szarekh'
      })
    )
  })

  it('keeps the observed stage when config does not contain it', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          ...RPC_ROWS[0],
          remaining_hp: 0,
          lifecycle_state: 'defeated'
        }
      ],
      error: null
    })

    const { result } = renderHook(
      () =>
        useCurrentBossStatus({
          guildCode: 'G1',
          seasonNumber: '104',
          progressionConfig: {
            firstPassSequence: ['L1', 'L2'],
            loopSequence: ['L1', 'L2'],
            loopStartStage: 'L1',
            gameVersion: 'test'
          },
          enabled: true
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(result.current.data?.hasData).toBe(true)
    })

    expect(result.current.data).toEqual(
      expect.objectContaining({
        stageCode: 'L3',
        loopIndex: 0,
        advancedStage: false,
        remainingHp: 0,
        bossNameFromData: 'Szarekh'
      })
    )
  })
})
