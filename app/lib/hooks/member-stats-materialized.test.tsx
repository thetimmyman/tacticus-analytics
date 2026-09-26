import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({ rpc: mocks.rpc })
}))

import { useMemberStatsMaterialized } from '@/app/lib/hooks/member-stats-materialized'

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useMemberStatsMaterialized', () => {
  it('reads the complete server-side guild aggregate', async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          display_name: 'Domain Player',
          guild_code: 'GUILD',
          role: 'member',
          player_id: 'game-player-1',
          is_current: true,
          theme_preference: null,
          primary_boss: null,
          secondary_boss: null,
          last_profile_update: '2026-08-08T12:00:00+00:00',
          total_damage: 125,
          battle_count: 1,
          bomb_count: 0,
          tokens_used: 1,
          average_damage: 125,
          max_damage: 125,
          last_active: '2026-08-09T12:00:00+00:00',
          token_status: 'normal',
          legendary_battles: 1,
          unique_bosses_fought: 1,
          battles_last_7_days: 1,
          token_offender_threshold: 40,
          token_abuser_threshold: 50,
          config_guild_code: 'GUILD'
        }
      ],
      error: null
    })

    const { result } = renderHook(() => useMemberStatsMaterialized('GUILD'), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.rpc).toHaveBeenCalledOnce()
    expect(mocks.rpc).toHaveBeenCalledWith('get_guild_member_stats', {
      p_guild_code: 'GUILD'
    })
    expect(result.current.data?.[0]).toMatchObject({
      player_id: 'game-player-1',
      total_damage: 125,
      unique_bosses_fought: 1
    })
  })

  it('surfaces an RPC failure instead of returning partial statistics', async () => {
    const error = { message: 'aggregate unavailable' }
    mocks.rpc.mockResolvedValue({ data: null, error })

    const { result } = renderHook(() => useMemberStatsMaterialized('GUILD'), {
      wrapper: createWrapper()
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBe(error)
  })
})
