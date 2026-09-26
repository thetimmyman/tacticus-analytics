import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithProviders } from '../../utils/render'
import RecentActivityClient from '@/app/(dashboard)/wars/[warId]/recent/RecentActivityClient'
import type { RecentAttempt } from '@/app/(dashboard)/wars/_types'

vi.mock('@/app/(dashboard)/wars/_components/ActivityTable', () => ({
  default: ({ rows }: { rows: RecentAttempt[] }) => (
    <div data-testid="activity-table">{rows.length} rows</div>
  )
}))

vi.mock(
  '@/app/(dashboard)/wars/_components/ActivityFilterBar',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/app/(dashboard)/wars/_components/ActivityFilterBar')
      >()
    return {
      ...actual,
      default: () => <div data-testid="activity-filter-bar" />
    }
  }
)

const makeAttempt = (id: string): RecentAttempt => ({
  id,
  attacker: { name: `Attacker ${id}`, guildTag: 'ATK' },
  defender: { name: `Defender ${id}`, guildTag: 'DEF' },
  attackerUnits: [],
  defenderUnits: [],
  zoneName: 'Outer Reach',
  zoneType: 'Standard',
  score: 1000,
  kills: 1,
  buffLevel: 0,
  time: '2026-08-01T12:00:00Z',
  isGuildMember: true,
  isPerfect: false,
  isFailed: false
})

type Page = { attempts: RecentAttempt[]; nextCursor?: string }

const pageResponse = (page: Page) =>
  new Response(JSON.stringify(page), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  })

describe('RecentActivityClient Load all', () => {
  let fetchMock: ReturnType<typeof vi.fn>
  let inFlight: number
  let maxInFlight: number

  beforeEach(() => {
    inFlight = 0
    maxInFlight = 0
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  const servePages = (
    pages: Record<string, Page>,
    deferred?: Record<string, Promise<void>>
  ) => {
    fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
      inFlight += 1
      maxInFlight = Math.max(maxInFlight, inFlight)
      try {
        const url = new URL(String(input), 'http://localhost')
        const key = `${url.searchParams.get('filter') ?? 'all'}|${
          url.searchParams.get('cursor') ?? ''
        }`
        if (deferred?.[key]) await deferred[key]
        const page = pages[key]
        if (!page) throw new Error(`Unexpected page request: ${key}`)
        return pageResponse(page)
      } finally {
        inFlight -= 1
      }
    })
  }

  it('loads every remaining page sequentially and completes', async () => {
    servePages({
      'all|': {
        attempts: [makeAttempt('a1'), makeAttempt('a2')],
        nextCursor: 'c1'
      },
      'all|c1': {
        attempts: [makeAttempt('a3'), makeAttempt('a4')],
        nextCursor: 'c2'
      },
      'all|c2': { attempts: [makeAttempt('a5')] }
    })

    const user = userEvent.setup()
    renderWithProviders(<RecentActivityClient warId="war-1" />)

    await screen.findByRole('button', { name: 'Load all' })
    await user.click(screen.getByRole('button', { name: 'Load all' }))

    await waitFor(() => {
      expect(screen.getByTestId('activity-table')).toHaveTextContent('5 rows')
    })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(maxInFlight).toBe(1)
    expect(
      screen.queryByRole('button', { name: 'Load all' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Load 50 more/ })
    ).not.toBeInTheDocument()
  })

  it('does not issue a duplicate fetch while a page is in flight', async () => {
    let releasePage2: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      releasePage2 = resolve
    })
    servePages(
      {
        'all|': {
          attempts: [makeAttempt('a1')],
          nextCursor: 'c1'
        },
        'all|c1': { attempts: [makeAttempt('a2')] }
      },
      { 'all|c1': gate }
    )

    const user = userEvent.setup()
    renderWithProviders(<RecentActivityClient warId="war-1" />)

    await screen.findByRole('button', { name: 'Load all' })
    await user.click(screen.getByRole('button', { name: 'Load all' }))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await screen.findByText(/Loading all…/)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    releasePage2()
    await waitFor(() => {
      expect(screen.getByTestId('activity-table')).toHaveTextContent('2 rows')
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(maxInFlight).toBe(1)
  })

  it('resets load-all when the primary filter changes', async () => {
    servePages({
      'all|': {
        attempts: [makeAttempt('a1')],
        nextCursor: 'c1'
      },
      'all|c1': {
        attempts: [makeAttempt('a2')],
        nextCursor: 'c2'
      },
      'all|c2': { attempts: [makeAttempt('a3')] },
      'perfect|': {
        attempts: [makeAttempt('p1')],
        nextCursor: 'pc1'
      },
      'perfect|pc1': { attempts: [makeAttempt('p2')] }
    })

    const user = userEvent.setup()
    renderWithProviders(<RecentActivityClient warId="war-1" />)

    await screen.findByRole('button', { name: 'Load all' })
    await user.click(screen.getByRole('button', { name: 'Load all' }))
    await user.click(screen.getByRole('button', { name: 'Perfect' }))

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Load all' })
      ).toBeInTheDocument()
    })
    expect(screen.getByTestId('activity-table')).toHaveTextContent('1 rows')
    const perfectCursorCalls = fetchMock.mock.calls.filter(([input]) => {
      const url = new URL(String(input), 'http://localhost')
      return (
        url.searchParams.get('filter') === 'perfect' &&
        url.searchParams.get('cursor') !== null
      )
    })
    expect(perfectCursorCalls).toHaveLength(0)
  })
})
