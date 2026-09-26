// With no season the hook omits the param so the server resolves the current season.
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useGuildMembers } from '@/app/lib/hooks/shared/useGuildMembers'

const mocks = vi.hoisted(() => ({
  guildMemberRpc: vi.fn(async () => ({
    data: [] as Array<Record<string, unknown>>,
    error: null
  }))
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    rpc: mocks.guildMemberRpc
  })
}))

vi.mock('@/app/lib/hooks/member-stats-materialized', () => ({
  useMemberStatsMaterialized: () => ({
    data: null,
    isLoading: false,
    error: null,
    refetch: vi.fn()
  })
}))

const fetchMock = vi.fn(async (_url: string) => ({
  ok: true,
  json: async () => ({ players: [] })
}))

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

beforeEach(() => {
  fetchMock.mockClear()
  mocks.guildMemberRpc.mockClear()
  vi.stubGlobal('fetch', fetchMock)
})

describe('useGuildMembers token season source (F9)', () => {
  it('uses the server-scoped browser-safe member RPC', async () => {
    renderHook(() => useGuildMembers({ guildCode: 'G1' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(mocks.guildMemberRpc).toHaveBeenCalledWith(
        'get_guild_members_browser_safe'
      )
    })
    expect(mocks.guildMemberRpc).not.toHaveBeenCalledWith(
      'get_guild_members_simple'
    )
  })

  it('preserves claimed status when another member user ID is redacted', async () => {
    mocks.guildMemberRpc.mockResolvedValueOnce({
      data: [
        {
          user_id: null,
          is_claimed: true,
          player_id: 'player-1',
          display_name: 'Claimed Member',
          guild_code: 'G1',
          role: 'member',
          is_current: true
        }
      ],
      error: null
    })
    const { result } = renderHook(() => useGuildMembers({ guildCode: 'G1' }), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.members).toHaveLength(1)
    })
    expect(result.current.members[0]).toMatchObject({
      playerId: 'player-1',
      userId: null,
      isClaimed: true
    })
  })

  it('omits the season param when no season is passed, deferring to the server', async () => {
    renderHook(
      () => useGuildMembers({ guildCode: 'G1', includeTokens: true }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/guild-tokens?')
        )
      ).toBe(true)
    })

    const tokenUrl = String(
      fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith('/api/guild-tokens?')
      )?.[0]
    )
    const params = new URL(tokenUrl, 'http://localhost').searchParams
    expect(params.get('guild')).toBe('G1')
    expect(params.has('season')).toBe(false)
  })

  it('passes an explicitly pinned season through unchanged', async () => {
    renderHook(
      () =>
        useGuildMembers({
          guildCode: 'G1',
          includeTokens: true,
          seasonNumber: 104
        }),
      { wrapper: createWrapper() }
    )

    await waitFor(() => {
      expect(
        fetchMock.mock.calls.some(([url]) =>
          String(url).startsWith('/api/guild-tokens?')
        )
      ).toBe(true)
    })

    const tokenUrl = String(
      fetchMock.mock.calls.find(([url]) =>
        String(url).startsWith('/api/guild-tokens?')
      )?.[0]
    )
    const params = new URL(tokenUrl, 'http://localhost').searchParams
    expect(params.get('season')).toBe('104')
  })
})
