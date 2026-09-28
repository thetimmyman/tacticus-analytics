import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

// PostgREST returns these columns lowercase; camelCase reads yield NaN.

const rpcMock = vi.fn()

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => ({ rpc: rpcMock })
}))

vi.mock(
  '@/app/(dashboard)/leaderboards/hooks/useGuildLeaderboardContext',
  () => ({
    useGuildLeaderboardContext: () => ({
      data: {
        season: '105',
        guildDisplayName: 'Test Guild'
      },
      isLoading: false,
      error: null
    })
  })
)

import MyGuildTab, {
  normalizeMetaAnalysisRows
} from '@/app/(dashboard)/meta-atlas/components/MyGuildTab'

const LOWERCASE_RPC_ROW = {
  bossname: 'Ghazghkull',
  encounterindex: 1,
  teamcomposition: {
    heroDetails: 'Actus,Aleph-Null',
    machineOfWarDetails: 'MoWName'
  },
  avgdamage: 123456,
  maxdamage: 222222,
  battlecount: 7,
  winrate: 85,
  consistency: 12,
  categories: ['Mech', 'Ranged']
}

function wrapper({ children }: { children: React.ReactNode }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

describe('MyGuildTab RPC key-casing (Phase 1b)', () => {
  beforeEach(() => {
    rpcMock.mockResolvedValue({ data: [LOWERCASE_RPC_ROW], error: null })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('normalizes LOWERCASE PostgREST columns to real numbers, not NaN', () => {
    const [entry] = normalizeMetaAnalysisRows([LOWERCASE_RPC_ROW])

    expect(entry.avgDamage).toBe(123456)
    expect(entry.maxDamage).toBe(222222)
    expect(entry.battleCount).toBe(7)
    expect(entry.winRate).toBe(85)
    expect(entry.consistency).toBe(12)
    expect(entry.encounterIndex).toBe(1)

    expect(Number.isNaN(entry.avgDamage)).toBe(false)
    expect(Number.isNaN(entry.battleCount)).toBe(false)
    expect(Number.isNaN(entry.winRate)).toBe(false)
    expect(Number.isNaN(entry.consistency)).toBe(false)
    expect(Number.isNaN(entry.encounterIndex)).toBe(false)

    expect(entry.bossName).toBe('Ghazghkull')
    expect(entry.teamComposition?.heroDetails).toBe('Actus,Aleph-Null')
    expect(entry.teamComposition?.machineOfWarDetails).toBe('MoWName')
    expect(entry.categories).toEqual(['Mech', 'Ranged'])
  })

  it('renders formatted metric values (no NaN) from a lowercase RPC row', async () => {
    render(<MyGuildTab guildCode="ABC123" />, { wrapper })

    await waitFor(() => {
      expect(screen.getAllByText('7').length).toBeGreaterThan(0)
    })

    expect(screen.queryByText(/NaN/)).toBeNull()
  })

  it('renders the empty state and skips the RPC when guildCode is empty', () => {
    render(<MyGuildTab guildCode="" />, { wrapper })

    expect(screen.getByText(/Join a guild to see your guild/i)).toBeTruthy()
    expect(rpcMock).not.toHaveBeenCalled()
  })
})
