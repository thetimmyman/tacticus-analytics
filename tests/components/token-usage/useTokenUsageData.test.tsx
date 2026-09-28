import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTokenUsageData } from '@/app/components/token-usage/hooks/useTokenUsageData'
import type { Rarity } from '@/app/lib/config'

const rpcMock = vi.fn()

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => ({ rpc: rpcMock })
}))

vi.mock('@tacticus/app-core/performance-monitor', () => ({
  logQuery: vi.fn()
}))

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false }
    }
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('useTokenUsageData', () => {
  beforeEach(() => {
    rpcMock.mockResolvedValue({
      data: [
        {
          display_name: 'Leader',
          tokens_used: 11,
          boss_tokens: 11,
          prime_tokens: 0,
          max_possible: 12,
          burned_tokens: 0
        },
        {
          display_name: 'Follower',
          tokens_used: 10,
          boss_tokens: 10,
          prime_tokens: 0,
          max_possible: 12,
          burned_tokens: 9
        }
      ],
      error: null
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/guild-tokens?')) {
          return {
            ok: true,
            json: async () => ({
              players: [
                {
                  display_name: 'Leader',
                  tokens_available: 1,
                  token_next_in_seconds: null,
                  bombs_available: 0,
                  bomb_next_in_seconds: null
                },
                {
                  display_name: 'Follower',
                  tokens_available: 1,
                  token_next_in_seconds: 6 * 60 * 60,
                  bombs_available: 0,
                  bomb_next_in_seconds: null
                }
              ]
            })
          }
        }
        if (url.startsWith('/api/members/token-usage/battles?')) {
          return {
            ok: true,
            json: async () => []
          }
        }
        throw new Error(`Unexpected fetch: ${url}`)
      })
    )
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  it('passes token cooldowns through the real merge path for burned-token parity', async () => {
    const { result } = renderHook(
      () =>
        useTokenUsageData({
          guildCode: 'test',
          season: '103',
          selectedRarities: []
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    const follower = result.current.players.find(
      (player) => player.displayName === 'FOLLOWER'
    )
    expect(follower?.burnedTokensUsage).toBe(0)
    expect(follower?.burnedTokens).toBe(0)
    expect(result.current.availabilityRows).toHaveLength(2)
    expect(result.current.availabilityRows[0]?.display_name).toBe('Leader')
  })

  it('uses player_id before display name when merging duplicate-name token rows', async () => {
    rpcMock.mockResolvedValue({
      data: [
        {
          player_id: 'p1',
          display_name: 'Twin',
          tokens_used: 11,
          boss_tokens: 11,
          prime_tokens: 0,
          max_possible: 12
        },
        {
          player_id: 'p2',
          display_name: 'Twin',
          tokens_used: 10,
          boss_tokens: 10,
          prime_tokens: 0,
          max_possible: 12
        }
      ],
      error: null
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/guild-tokens?')) {
          return {
            ok: true,
            json: async () => ({
              players: [
                {
                  player_id: 'p1',
                  display_name: 'Twin',
                  tokens_available: 1,
                  token_next_in_seconds: null,
                  bombs_available: 0,
                  bomb_next_in_seconds: null
                },
                {
                  player_id: 'p2',
                  display_name: 'Twin',
                  tokens_available: 1,
                  token_next_in_seconds: 6 * 60 * 60,
                  bombs_available: 0,
                  bomb_next_in_seconds: null
                }
              ]
            })
          }
        }
        if (url.startsWith('/api/members/token-usage/battles?')) {
          return {
            ok: true,
            json: async () => [
              {
                userId: 'p1',
                displayName: 'Twin',
                Season: '103',
                damageType: 'Battle',
                rarity: 'Legendary',
                damageDealt: 1,
                Name: 'Boss',
                encounterId: 0,
                loopIndex: 1
              },
              {
                userId: 'p2',
                displayName: 'Twin',
                Season: '103',
                damageType: 'Battle',
                rarity: 'Legendary',
                damageDealt: 1,
                Name: 'Boss',
                encounterId: 0,
                loopIndex: 1
              }
            ]
          }
        }
        throw new Error(`Unexpected fetch: ${url}`)
      })
    )

    const { result } = renderHook(
      () =>
        useTokenUsageData({
          guildCode: 'test',
          season: '103',
          selectedRarities: []
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    const leader = result.current.players.find(
      (player) => player.userId === 'p1'
    )
    const follower = result.current.players.find(
      (player) => player.userId === 'p2'
    )
    expect(leader?.totalTokens).toBe(11)
    expect(leader?.burnedTokens).toBe(0)
    expect(follower?.totalTokens).toBe(10)
    expect(follower?.burnedTokens).toBe(0)
  })

  it('does not mutate the selected rarity array while building the query key', async () => {
    const selectedRarities: Rarity[] = ['Mythic', 'Legendary']

    const { result } = renderHook(
      () =>
        useTokenUsageData({
          guildCode: 'test',
          season: '103',
          selectedRarities
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(selectedRarities).toEqual(['Mythic', 'Legendary'])
  })

  it('passes the query abort signal to token and battle fetches', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.startsWith('/api/guild-tokens?')) {
        return {
          ok: true,
          json: async () => ({ players: [] })
        }
      }
      if (url.startsWith('/api/members/token-usage/battles?')) {
        return {
          ok: true,
          json: async () => []
        }
      }
      throw new Error(`Unexpected fetch: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(
      () =>
        useTokenUsageData({
          guildCode: 'test',
          season: '103',
          selectedRarities: []
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    const guildTokensCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith('/api/guild-tokens?')
    )
    const battleHistoryCall = fetchMock.mock.calls.find(([input]) =>
      String(input).startsWith('/api/members/token-usage/battles?')
    )

    expect(guildTokensCall?.[1]?.signal).toBeInstanceOf(AbortSignal)
    expect(battleHistoryCall?.[1]?.signal).toBeInstanceOf(AbortSignal)
  })

  it('overlays pace rows onto envelope projections, per row, with envelope fallback', async () => {
    rpcMock.mockImplementation(async (fn: string) => {
      if (fn === 'get_guild_season_forecast') {
        return {
          data: {
            season: {
              number: 103,
              starts_at: '2026-07-01T00:00:00Z',
              ends_at: '2026-08-01T00:00:00Z',
              seconds_remaining: 86400
            },
            tokens: {
              available_now: 2,
              yet_to_regen: 2,
              capacity: 4,
              cap_bound_players: 0,
              estimated_cap_waste: 0
            },
            bombs: { available_now: 0, yet_to_regen: 0, capacity: 2 },
            per_player: [
              {
                player_id: 'p1',
                display_name: 'Leader',
                tokens_now: 2,
                next_token_seconds: 3600,
                tokens_will_regen: 1,
                tokens_at_season_end: 3,
                will_cap: false,
                estimated_cap_waste: 0
              },
              {
                player_id: 'p2',
                display_name: 'Follower',
                tokens_now: 1,
                next_token_seconds: 3600,
                tokens_will_regen: 1,
                tokens_at_season_end: 2,
                will_cap: true,
                estimated_cap_waste: 4
              }
            ]
          },
          error: null
        }
      }
      return {
        data: [
          {
            player_id: 'p1',
            display_name: 'Leader',
            tokens_used: 11,
            boss_tokens: 11,
            prime_tokens: 0,
            max_possible: 12
          },
          {
            player_id: 'p2',
            display_name: 'Follower',
            tokens_used: 10,
            boss_tokens: 10,
            prime_tokens: 0,
            max_possible: 12
          }
        ],
        error: null
      }
    })

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/guild-tokens?')) {
          return {
            ok: true,
            json: async () => ({
              players: [
                {
                  player_id: 'p1',
                  display_name: 'Leader',
                  tokens_available: 1,
                  token_next_in_seconds: null,
                  bombs_available: 0,
                  bomb_next_in_seconds: null
                },
                {
                  player_id: 'p2',
                  display_name: 'Follower',
                  tokens_available: 1,
                  token_next_in_seconds: 6 * 60 * 60,
                  bombs_available: 0,
                  bomb_next_in_seconds: null
                }
              ]
            })
          }
        }
        if (url.startsWith('/api/members/token-usage/battles?')) {
          return { ok: true, json: async () => [] }
        }
        if (url.startsWith('/api/season-forecast/outlook?')) {
          return {
            ok: true,
            json: async () => ({
              projection: null,
              players: [
                {
                  playerId: 'p1',
                  displayName: 'Leader',
                  tokensUsed: 11,
                  tokensRemaining: 17.4,
                  projectedWaste: 4.6,
                  atCapRisk: true
                }
              ]
            })
          }
        }
        throw new Error(`Unexpected fetch: ${url}`)
      })
    )

    const { result } = renderHook(
      () =>
        useTokenUsageData({
          guildCode: 'test',
          season: '103',
          selectedRarities: [],
          enableForecast: true
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.loading).toBe(false))

    const leader = result.current.players.find((p) => p.userId === 'p1')
    const follower = result.current.players.find((p) => p.userId === 'p2')

    expect(leader?.projection).toMatchObject({
      tokens_at_season_end: 17,
      will_cap: true,
      estimated_cap_waste: 5,
      tokens_now: 2,
      tokens_will_regen: 1
    })
    expect(follower?.projection).toMatchObject({
      tokens_at_season_end: 2,
      will_cap: true,
      estimated_cap_waste: 4
    })
  })

  it('propagates aborted token fetches instead of converting them to fallback rows', async () => {
    const abortError = new Error('aborted')
    abortError.name = 'AbortError'
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input)
        if (url.startsWith('/api/guild-tokens?')) {
          throw abortError
        }
        if (url.startsWith('/api/members/token-usage/battles?')) {
          return {
            ok: true,
            json: async () => []
          }
        }
        throw new Error(`Unexpected fetch: ${url}`)
      })
    )

    const { result } = renderHook(
      () =>
        useTokenUsageData({
          guildCode: 'test',
          season: '103',
          selectedRarities: []
        }),
      { wrapper }
    )

    await waitFor(() => expect(result.current.error).toBe(abortError))
  })
})
