import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTokenBurnRows } from '@/app/components/performance/hooks/player-performance-data/useTokenBurnRows'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async (_name: string, _args: Record<string, unknown>) => ({
    data: [
      {
        player_id: 'synthetic-player',
        display_name: 'Synthetic Player',
        tokens_used: 2,
        tokens_available: 1,
        token_next_in_seconds: 60
      }
    ],
    error: null
  }))
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({ rpc: mocks.rpc })
}))

const fetchMock = vi.fn(async () => ({
  ok: true,
  json: async () => ({
    players: [
      {
        player_id: 'synthetic-player',
        tokens_available: 3,
        token_next_in_seconds: 30
      }
    ]
  })
}))

function wrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  mocks.rpc.mockClear()
  fetchMock.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('performance token availability uses the current profile role', () => {
  it.each([undefined, 'member', 'admin'])(
    'keeps base performance rows without officer enrichment for %s',
    async (role) => {
      const { result } = renderHook(
        () => useTokenBurnRows('G1', '9999', true, role),
        { wrapper: wrapper() }
      )
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(mocks.rpc).toHaveBeenCalledWith('get_token_usage_for_guild', {
        p_guild_code: 'G1',
        p_season: '9999'
      })
      expect(fetchMock).not.toHaveBeenCalled()
      expect(result.current.data?.[0]).toMatchObject({
        player_id: 'synthetic-player',
        tokens_used: 2,
        tokens_available: 1,
        token_next_in_seconds: 60
      })
    }
  )

  it.each(['Officer', 'leader'])(
    'enriches base rows for current %s profiles',
    async (role) => {
      const { result } = renderHook(
        () => useTokenBurnRows('G1', '9999', true, role),
        { wrapper: wrapper() }
      )
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        '/api/guild-tokens?guild=G1&season=9999',
        { signal: expect.any(AbortSignal) }
      )
      expect(result.current.data?.[0]).toMatchObject({
        player_id: 'synthetic-player',
        tokens_used: 2,
        tokens_available: 3,
        token_next_in_seconds: 30
      })
    }
  )

  it('does not reuse officer enrichment after a role downgrade in the same query cache', async () => {
    const { result, rerender } = renderHook(
      ({ role }) => useTokenBurnRows('G1', '9999', true, role),
      { initialProps: { role: 'officer' }, wrapper: wrapper() }
    )
    await waitFor(() =>
      expect(result.current.data?.[0]?.tokens_available).toBe(3)
    )
    rerender({ role: 'member' })
    await waitFor(() =>
      expect(result.current.data?.[0]?.tokens_available).toBe(1)
    )
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.rpc).toHaveBeenCalledTimes(2)
  })
})
