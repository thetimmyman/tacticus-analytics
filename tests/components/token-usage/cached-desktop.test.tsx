import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useTokenUsageData } from '@/app/components/token-usage/hooks/useTokenUsageData'
import { CachedTokenAvailability } from '@/app/components/token-usage/CachedTokenAvailability'
import SummaryStats from '@/app/components/token-usage/SummaryStats'
const rpc = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/db/client', () => ({ dbClient: () => ({ rpc }) }))
vi.mock('@tacticus/app-core/performance-monitor', () => ({ logQuery: vi.fn() }))
const saved = {
  player_id: 'synthetic-player',
  display_name: 'Synthetic Member',
  tokens_available: 2,
  token_next_in_seconds: 3600,
  bombs_available: 0,
  bomb_next_in_seconds: 1800,
  burned_tokens: 1,
  time_over_cap_seconds: 43200,
  data_source: 'cached',
  last_sync_at: '2026-01-01T00:00:00Z',
  api_key_is_valid: false
}
function wrapper({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  )
}
describe('cached token usage interface', () => {
  beforeEach(() => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
    vi.clearAllMocks()
  })
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })
  it('reads only signed local endpoints even if forecasts are requested', async () => {
    const paths: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const path = String(input)
        paths.push(path)
        if (path.startsWith('/api/members/token-usage?'))
          return {
            ok: true,
            json: async () => [
              {
                ...saved,
                tokens_used: 4,
                max_possible: 7,
                boss_tokens: 3,
                prime_tokens: 1,
                computed_at: '2026-01-01T01:00:00Z'
              }
            ]
          }
        if (path.startsWith('/api/guild-tokens?'))
          return { ok: true, json: async () => ({ players: [saved] }) }
        if (path.startsWith('/api/members/token-usage/battles?'))
          return { ok: true, json: async () => [] }
        throw new Error('Unexpected local request')
      })
    )
    const { result } = renderHook(
      () =>
        useTokenUsageData({
          guildCode: 'SYN001',
          season: '100',
          selectedRarities: [],
          enableForecast: true
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.players[0]).toMatchObject({
      userId: 'synthetic-player',
      totalTokens: 4,
      tokensAvailable: 2,
      bombsAvailable: 0,
      burnedTokensUsage: 0,
      timeOverCapSeconds: 43200,
      dataSource: 'cached'
    })
    expect(result.current.computedAt).toBe('2026-01-01T01:00:00Z')
    expect(paths).toHaveLength(3)
    expect(paths.some((path) => path.includes('live=true'))).toBe(false)
    expect(rpc).not.toHaveBeenCalled()
  })
  it('surfaces unavailable saved reads as an error rather than an empty success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 503 }))
    )
    const { result } = renderHook(
      () =>
        useTokenUsageData({
          guildCode: 'SYN001',
          season: '100',
          selectedRarities: []
        }),
      { wrapper }
    )
    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    expect(result.current.players).toEqual([])
  })
  it('rejects malformed saved battle history rather than reporting an empty success', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => ({
        ok: true,
        json: async () =>
          String(input).includes('/battles?')
            ? { invalid: true }
            : String(input).startsWith('/api/guild-tokens?')
              ? { players: [saved] }
              : []
      }))
    )
    const { result } = renderHook(
      () =>
        useTokenUsageData({
          guildCode: 'SYN001',
          season: '100',
          selectedRarities: []
        }),
      { wrapper }
    )
    await waitFor(() =>
      expect(result.current.error?.message).toBe(
        'Saved battle history is malformed'
      )
    )
    expect(result.current.players).toEqual([])
  })
  it('counts saved snapshot projections as cached in the data source summary', () => {
    render(
      <SummaryStats
        totalStats={{
          totalTokens: 4,
          maxTokens: 4,
          averageUsage: 4,
          tokensAvailableAvg: 2,
          bombsAvailableCount: 0
        }}
        totalTokensAvailable={2}
        totalBurned={0}
        players={[
          {
            userId: 'synthetic-player',
            displayName: 'Synthetic Member',
            totalTokens: 4,
            bossTokens: 3,
            primeTokens: 1,
            avgTokensPerLoop: 4,
            efficiency: 100,
            tokensAvailable: 2,
            dataSource: 'cached',
            tokensByRarity: {
              common: 4,
              uncommon: 0,
              rare: 0,
              epic: 0,
              legendary: 0,
              mythic: 0
            }
          }
        ]}
      />
    )
    expect(screen.getByText('1 Cached')).toBeInTheDocument()
    expect(screen.queryByText(/ Live$/)).not.toBeInTheDocument()
  })
  it('shows saved numeric state, source, timestamps, cap status and local refresh', () => {
    const refresh = vi.fn()
    render(
      <CachedTokenAvailability
        rows={[
          saved,
          {
            ...saved,
            player_id: 'synthetic-idle',
            display_name: 'Idle Member',
            tokens_available: 3,
            token_next_in_seconds: null,
            bombs_available: 1,
            bomb_next_in_seconds: null,
            data_source: 'calculated',
            last_sync_at: null
          }
        ]}
        computedAt="2026-01-01T01:00:00Z"
        refresh={refresh}
      />
    )
    expect(
      screen.getByRole('region', { name: 'Saved token availability' })
    ).toBeInTheDocument()
    expect(screen.getByText('2 / 3')).toBeInTheDocument()
    expect(screen.getByText('0 / 1')).toBeInTheDocument()
    expect(screen.getByText('1h')).toBeInTheDocument()
    expect(screen.getByText('30m')).toBeInTheDocument()
    expect(screen.getAllByText('12h')).toHaveLength(2)
    expect(screen.getByText('Saved snapshot projection')).toBeInTheDocument()
    expect(screen.getByText('2026-01-01T00:00:00.000Z')).toBeInTheDocument()
    expect(screen.getAllByText('At cap')).toHaveLength(2)
    expect(screen.getByText('Saved battle history')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('No live API request')
    fireEvent.click(
      screen.getByRole('button', { name: 'Recalculate saved data' })
    )
    expect(refresh).toHaveBeenCalledOnce()
    expect(
      screen.queryByRole('button', { name: /sync guild/i })
    ).not.toBeInTheDocument()
  })
})
