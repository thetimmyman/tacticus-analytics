import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  waitFor,
  within,
  fireEvent
} from '@testing-library/react'

vi.mock('./PlatformSummaryChart', () => ({
  PlatformSummaryChart: () => null
}))

import { ActivityAnalytics } from './ActivityAnalytics'

const activityFixture = {
  summary: {
    totalClaimedUsers: 10,
    activeCount: 6,
    inactiveCount: 4,
    activityRate: 60,
    daysBack: 30
  },
  dailyActivity: [{ date: '2026-07-01', count: 3 }],
  // Alpha leads by default; sorting by Guild (desc) puts Beta first, proving a re-sort.
  guildActivity: [
    {
      guild_code: 'GA',
      guild_name: 'Guild Alpha',
      active: 8,
      total: 10,
      rate: 80
    },
    {
      guild_code: 'GB',
      guild_name: 'Guild Beta',
      active: 5,
      total: 9,
      rate: 56
    }
  ],
  roleActivity: [{ role: 'member', active: 5, total: 10, rate: 50 }],
  clusterActivity: [],
  pageViews: [],
  filters: { guilds: [], clusters: [], roles: [] }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => activityFixture
  }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

async function renderLoaded() {
  render(<ActivityAnalytics />)
  await waitFor(() =>
    expect(screen.getByText('Guild Activity Table')).toBeTruthy()
  )
}

// Narrows indexed access under noUncheckedIndexedAccess.
function rowAt(table: HTMLElement, index: number): HTMLElement {
  const row = within(table).getAllByRole('row')[index]
  if (!row) throw new Error(`No row at index ${index}`)
  return row
}

function tableUnderHeading(name: string): HTMLTableElement {
  const section = screen.getByText(name).closest('[class*="rounded-lg"]')
  if (!section) throw new Error(`No table section for ${name}`)

  const table = section.querySelector('table')
  if (!table) throw new Error(`No table under ${name}`)
  return table
}

describe('ActivityAnalytics — DataTable migration smoke tests', () => {
  it('renders the Guild Activity table headers, default active-desc order, and re-sorts on header click', async () => {
    await renderLoaded()

    const table = tableUnderHeading('Guild Activity Table')

    const headers = within(table)
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual(['Guild', 'Active', 'Total', 'Rate'])

    let firstRow = rowAt(table, 1)
    expect(within(firstRow).getByText('Guild Alpha')).toBeTruthy()

    const guildHeader = within(table).getByRole('columnheader', {
      name: /guild/i
    })
    fireEvent.click(within(guildHeader).getByRole('button'))

    await waitFor(() => {
      firstRow = rowAt(table, 1)
      expect(within(firstRow).getByText('Guild Beta')).toBeTruthy()
    })
  })
})
