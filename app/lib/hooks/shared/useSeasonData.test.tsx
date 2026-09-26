// Season comes from the bosses API, then the timing API; sentinel 999 cannot come from the static schedule.
import React from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useSeasonData } from '@/app/lib/hooks/shared/useSeasonData'

type FetchResponses = Record<string, unknown>

function installFetch(responses: FetchResponses, calls: string[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input)
      calls.push(url)
      const key = Object.keys(responses).find((k) => url.startsWith(k))
      if (!key) {
        return { ok: false, json: async () => null }
      }
      return { ok: true, json: async () => responses[key] }
    })
  )
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

const BOSSES_BASE = {
  success: true,
  configId: 'cfg-1',
  bosses: [],
  upcomingPreview: [],
  futurePreview: [],
  levels: [],
  resolvedAt: '2026-07-27T00:00:00Z'
}

beforeEach(() => {
  vi.unstubAllGlobals()
})

describe('useSeasonData season-number source (F9)', () => {
  it('takes the season number from the live timing API when the bosses API has none', async () => {
    const calls: string[] = []
    installFetch(
      {
        '/api/assignments/current-season-bosses': {
          ...BOSSES_BASE,
          seasonNumber: null
        },
        '/api/assignments/next-season-bosses': {
          ...BOSSES_BASE,
          seasonNumber: null
        },
        '/api/season/timing': {
          seasonNumber: 999,
          seasonStart: 1_700_000_000_000,
          seasonEnd: 1_700_100_000_000,
          source: 'loki-globalconfig'
        }
      },
      calls
    )

    const { result } = renderHook(() => useSeasonData('G1'), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.currentSeason?.seasonNumber).toBe(999)
    })
    expect(result.current.upcomingSeason?.seasonNumber).toBe(1000)

    const timingCalls = calls.filter((u) => u.startsWith('/api/season/timing'))
    expect(timingCalls.length).toBeGreaterThan(0)
    expect(timingCalls.every((u) => !u.includes('season='))).toBe(true)
  })

  it('prefers the bosses-API season number and scopes the timing request to it', async () => {
    const calls: string[] = []
    installFetch(
      {
        '/api/assignments/current-season-bosses': {
          ...BOSSES_BASE,
          seasonNumber: 104
        },
        '/api/assignments/next-season-bosses': {
          ...BOSSES_BASE,
          seasonNumber: 104
        },
        '/api/season/timing': {
          seasonNumber: 104,
          seasonStart: 1_700_000_000_000,
          seasonEnd: 1_700_100_000_000,
          source: 'loki-globalconfig'
        }
      },
      calls
    )

    const { result } = renderHook(() => useSeasonData('G1'), {
      wrapper: createWrapper()
    })

    await waitFor(() => {
      expect(result.current.currentSeason?.seasonNumber).toBe(104)
    })
    expect(result.current.upcomingSeason?.seasonNumber).toBe(105)

    await waitFor(() => {
      expect(
        calls.some((u) => u.startsWith('/api/season/timing?season=104'))
      ).toBe(true)
    })
  })
})
