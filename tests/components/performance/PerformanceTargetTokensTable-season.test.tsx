import React from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { PerformanceTargetTokensTable } from '@/app/components/performance/PerformanceTargetTokensTable'

// Without season_number the PUT writes the shadowed '' row, a silent no-op.

vi.mock('next/link', () => ({
  default: ({
    href,
    children
  }: {
    href: string
    children: React.ReactNode
  }) => <a href={href}>{children}</a>
}))

interface FetchCall {
  url: string
  method: string
  body?: string
}
let fetchCalls: FetchCall[] = []

const jsonResponse = (data: unknown) =>
  ({ ok: true, status: 200, json: async () => data }) as unknown as Response

const CURRENT_SEASON = 102
const SLOT = {
  boss_type: 'HiveTyrantKronos',
  boss_name: 'Hive Tyrant',
  rarity: 'Legendary',
  set: 3,
  encounter_id: 0
}
const PRIME_SLOT = {
  boss_type: 'Tanksmasha',
  boss_name: 'Tanksmasha',
  rarity: 'Legendary',
  set: 3,
  encounter_id: 2
}

let scheduleSlots: (typeof SLOT)[] = [SLOT]

beforeEach(() => {
  fetchCalls = []
  scheduleSlots = [SLOT]
  global.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : String(input)
    const method = (init?.method ?? 'GET').toUpperCase()
    fetchCalls.push({ url, method, body: init?.body as string | undefined })

    if (url.includes('/target-tokens/schedule')) {
      return jsonResponse({
        current: {
          config_id: 'cfg',
          season_number: CURRENT_SEASON,
          slots: scheduleSlots
        },
        upcoming: { config_id: 'cfg2', season_number: 103, slots: [] },
        all: { slots: [], config_ids: [] }
      })
    }
    if (url.includes('/target-tokens') && method === 'GET') {
      return jsonResponse({
        rows: [
          {
            boss_name: 'HiveTyrantKronos',
            rarity: 'Legendary',
            set: 3,
            encounter_id: 0,
            target_tokens: 5,
            source: 'officer_manual',
            seeded_from_seasons: null,
            notes: null,
            skip: false
          }
        ]
      })
    }
    if (url.includes('/target-tokens') && method === 'PUT') {
      return jsonResponse({ ok: true })
    }
    throw new Error(`unexpected fetch ${method} ${url}`)
  }) as unknown as typeof fetch
})

afterEach(() => {
  vi.restoreAllMocks()
})

function renderTable(
  props: {
    showPrimes?: boolean
    onShowPrimesChange?: (next: boolean) => void
  } = {}
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return render(
    <QueryClientProvider client={queryClient}>
      <PerformanceTargetTokensTable
        guildCode="ABCD"
        canManage
        selectedSeason={String(CURRENT_SEASON)}
        {...props}
      />
    </QueryClientProvider>
  )
}

describe('PerformanceTargetTokensTable — season-aware read + write', () => {
  it('scopes the target-tokens GET to the current rotation season', async () => {
    renderTable()

    await waitFor(() => {
      const getCall = fetchCalls.find(
        (c) => c.method === 'GET' && /\/target-tokens\?/.test(c.url)
      )
      expect(getCall, 'a season-scoped GET should fire').toBeTruthy()
      expect(getCall!.url).toContain(`season=${CURRENT_SEASON}`)
    })
  })

  it('sends season_number in the inline-edit PUT so the write is not a silent no-op', async () => {
    renderTable()

    const input = await screen.findByRole('textbox')
    fireEvent.change(input, { target: { value: '9' } })

    const saveButton = await screen.findByRole('button', {
      name: /save target tokens/i
    })
    fireEvent.click(saveButton)

    await waitFor(() => {
      const putCall = fetchCalls.find((c) => c.method === 'PUT')
      expect(putCall, 'an inline PUT should fire on save').toBeTruthy()
      const body = JSON.parse(putCall!.body ?? '{}')
      expect(body.season_number).toBe(String(CURRENT_SEASON))
      expect(body.boss_name).toBe('HiveTyrantKronos')
      expect(body.target_tokens).toBe(9)
    })
  })
})

describe('PerformanceTargetTokensTable — showPrimes prop', () => {
  it('hides prime rows and shows the hint when showPrimes=false', async () => {
    scheduleSlots = [SLOT, PRIME_SLOT]
    renderTable({ showPrimes: false })

    await screen.findByText(/Hive Tyrant/)
    expect(screen.queryByText(/Tanksmasha/)).toBeNull()
    expect(screen.getByText(/Primes hidden/i)).toBeTruthy()
  })

  it('shows prime rows and no hint by default (showPrimes defaults to true)', async () => {
    scheduleSlots = [SLOT, PRIME_SLOT]
    renderTable()

    await screen.findByText(/Tanksmasha/)
    expect(screen.queryByText(/Primes hidden/i)).toBeNull()
  })

  it('renders a header Primes checkbox bound to the shared state when onShowPrimesChange is provided', async () => {
    scheduleSlots = [SLOT, PRIME_SLOT]
    const onChange = vi.fn()
    renderTable({ showPrimes: true, onShowPrimesChange: onChange })

    await screen.findByText(/Tanksmasha/)
    const checkbox = screen.getByRole('checkbox')
    fireEvent.click(checkbox)
    expect(onChange).toHaveBeenCalledWith(false)
  })
})
