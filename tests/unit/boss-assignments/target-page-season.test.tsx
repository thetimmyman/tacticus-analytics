import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import TargetTokensPage from '@/app/(dashboard)/boss-assignments/targets/page'
import { db } from '@/app/lib/db'
import { getRuntimeProfile } from '@tacticus/app-core/runtime-profile'

vi.mock('@/app/(dashboard)/boss-assignments/_lib/access', () => ({
  requireBossAssignmentsAccess: vi.fn(async () => ({
    profile: { guild_code: 'SYN-TARGETS' },
    canEdit: true,
    canManageHerald: false,
    canSeed: true
  }))
}))
vi.mock('@/app/lib/db', () => ({ db: vi.fn() }))
vi.mock('@/app/lib/utils/season', () => ({
  getLatestSeason: vi.fn(async () => '103')
}))
vi.mock('@/app/lib/data/guild-per-boss-actual-tokens', () => ({
  getGuildPerBossActualTokens: vi.fn(async () => ({}))
}))
vi.mock('@tacticus/app-core/runtime-profile', () => ({
  getRuntimeProfile: vi.fn(() => 'desktop')
}))

beforeEach(() => {
  vi.mocked(getRuntimeProfile).mockReturnValue('desktop')
  vi.mocked(db).mockResolvedValue({
    rpc: async (name: string) => ({
      data:
        name === 'get_distinct_seasons_for_guild'
          ? ['90', '102', '103']
          : '103',
      error: null
    })
  } as never)
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) =>
      Response.json(
        url.includes('/schedule')
          ? {
              selected: {
                season_number: 103,
                config_id: 'synthetic',
                slots: []
              },
              current: {
                season_number: 103,
                config_id: 'synthetic',
                slots: []
              },
              upcoming: {
                season_number: 104,
                config_id: 'synthetic',
                slots: []
              },
              all: { slots: [], config_ids: [] }
            }
          : { rows: [] }
      )
    )
  )
})
afterEach(() => vi.unstubAllGlobals())

async function renderPage(season?: string) {
  const page = await TargetTokensPage({
    searchParams: Promise.resolve({ season })
  })
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } }
  })
  render(<QueryClientProvider client={queryClient}>{page}</QueryClientProvider>)
}

describe('target page captured desktop seasons', () => {
  it('offers saved captured seasons without the older uncaptured imported season', async () => {
    await renderPage('103')
    const selector = screen.getByRole('radiogroup', {
      name: 'Assignment season'
    })
    expect(
      within(selector)
        .getAllByRole('radio')
        .map((radio) => radio.textContent)
    ).toEqual(['Saved · S102', 'Saved · S103'])
  })

  it('refuses a direct uncaptured season selection before loading an inferred schedule', async () => {
    await renderPage('90')
    expect(
      screen.getByText('Season configuration unavailable')
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('radiogroup', { name: 'Assignment season' })
    ).not.toBeInTheDocument()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('preserves the hosted rotation window and explicit uncaptured selection', async () => {
    vi.mocked(getRuntimeProfile).mockReturnValue('hosted')
    await renderPage('90')
    const selector = screen.getByRole('radiogroup', {
      name: 'Assignment season'
    })
    expect(within(selector).getByRole('radio', { name: 'S90' })).toBeChecked()
    expect(within(selector).getAllByRole('radio').length).toBeGreaterThan(3)
    expect(
      screen.getByRole('button', { name: 'Seed from history' })
    ).toBeInTheDocument()
  })

  it('does not re-add an uncaptured latest-season anchor to the desktop selector', async () => {
    vi.mocked(db).mockResolvedValue({
      rpc: async (name: string) => ({
        data:
          name === 'get_distinct_seasons_for_guild'
            ? ['90', '102', '103']
            : '115',
        error: null
      })
    } as never)
    await renderPage('103')
    const selector = screen.getByRole('radiogroup', {
      name: 'Assignment season'
    })
    expect(
      within(selector)
        .getAllByRole('radio')
        .map((radio) => radio.textContent)
    ).toEqual(['Saved · S102', 'Saved · S103'])
  })

  it('opens the newest captured saved season when the default latest season is uncaptured', async () => {
    vi.mocked(db).mockResolvedValue({
      rpc: async (name: string) => ({
        data:
          name === 'get_distinct_seasons_for_guild'
            ? ['102', '90', '103']
            : '115',
        error: null
      })
    } as never)
    await renderPage()
    expect(screen.getByText('Season 103')).toBeInTheDocument()
    const selector = screen.getByRole('radiogroup', {
      name: 'Assignment season'
    })
    expect(
      within(selector).getByRole('radio', { name: 'Saved · S103' })
    ).toBeChecked()
    expect(
      within(selector).queryByRole('radio', { name: /S115|S90/ })
    ).not.toBeInTheDocument()
  })
})
