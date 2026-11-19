import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance
} from 'vitest'

const guild = (n: number) => ({
  guild_code: `CODE${String(n).padStart(3, '0')}`,
  guild_tag: null,
  guild_name: `Pager Guild ${String(n).padStart(2, '0')}`,
  cluster_code: 'C1',
  cluster_name: 'C1 Name',
  season: '114',
  current_gr_ranking: n,
  current_war_rank: null,
  war_rank: null,
  active_players: 10,
  total_damage: 1000,
  total_battles: 5,
  veteran_count: 0,
  top_boss_hits: [],
  votlw_champions: [],
  available_rarities: ['Mythic', 'Legendary', 'Epic'],
  explore_privacy_mode: 'public'
})

// 90 guilds at 20 per page: five pages, enough to show both gap markers.
const GUILDS = Array.from({ length: 90 }, (_, i) => guild(i + 1))

// One stable array: a fresh [] on every render re-runs the hook effects forever.
const NO_GUILDS: never[] = []
const source = vi.hoisted(() => ({ loading: false, empty: false }))

vi.mock('@/app/(public)/explore/hooks/useGuildData', () => ({
  useGuildData: () => ({
    guilds: source.empty ? NO_GUILDS : GUILDS,
    loading: source.loading,
    refreshing: false,
    lastRefreshed: null,
    handleManualRefresh: () => {}
  })
}))

import ExploreContent from '@/app/(public)/explore/ExploreContent'

const results = (page: number, of: number) =>
  screen.getByRole('region', { name: `Guilds, page ${page} of ${of}` })

describe('Explore pager moves the reader to the new page', () => {
  let scrollIntoView: MockInstance<Element['scrollIntoView']>
  beforeEach(() => {
    source.loading = false
    source.empty = false
    scrollIntoView = vi
      .spyOn(Element.prototype, 'scrollIntoView')
      .mockImplementation(() => {})
  })
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('does not move focus or scroll on first render', () => {
    render(<ExploreContent />)
    expect(document.activeElement).toBe(document.body)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('puts keyboard focus on the new list and scrolls it into view', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)
    expect(screen.getByText('Pager Guild 01')).toBeTruthy()

    screen.getByRole('button', { name: /^next page$/i }).focus()
    await user.keyboard('{Enter}')

    expect(screen.getByText('Pager Guild 21')).toBeTruthy()
    expect(document.activeElement).toBe(results(2, 5))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    // A div takes script focus in a real browser only with a tabindex.
    expect(results(2, 5).getAttribute('tabindex')).toBe('-1')
  })

  it('keeps focus on the list when Next disables itself on the last page', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)
    await user.click(screen.getByRole('button', { name: /^page 3$/i }))
    await user.click(screen.getByRole('button', { name: /^page 5$/i }))
    expect(document.activeElement).toBe(results(5, 5))
    expect(
      (
        screen.getByRole('button', {
          name: /^next page$/i
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true)
    // Last-page Next press that used to drop focus to the document body.
    await user.click(screen.getByRole('button', { name: /^previous page$/i }))
    await user.click(screen.getByRole('button', { name: /^next page$/i }))
    expect(document.activeElement).toBe(results(5, 5))
  })

  it('keeps focus on the list when the page-1 shortcut unmounts', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)
    await user.click(screen.getByRole('button', { name: /^page 3$/i }))
    await user.click(screen.getByRole('button', { name: /^page 5$/i }))
    await user.click(screen.getByRole('button', { name: /^page 4$/i }))
    // Page 4: the "1" shortcut is separate from the pages around the current one.
    const shortcut = screen.getAllByRole('button', { name: /^page 1$/i })[0]
    shortcut.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByText('Pager Guild 01')).toBeTruthy()
    expect(document.activeElement).toBe(results(1, 5))
  })

  it('announces the page in the list name, including the one-page case', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)
    expect(results(1, 5)).toBeTruthy()
    await user.type(
      screen.getByRole('textbox', { name: /search guilds/i }),
      'Guild 4'
    )
    await waitFor(() =>
      expect(screen.getByRole('region', { name: 'Guilds' })).toBeTruthy()
    )
  })

  it('does not take focus from the search box when a filter resets the page', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)
    await user.click(screen.getByRole('button', { name: /^next page$/i }))
    expect(results(2, 5)).toBeTruthy()
    scrollIntoView.mockClear()

    const search = screen.getByRole('textbox', { name: /search guilds/i })
    await user.type(search, 'Guild 4')
    // The reset to page 1 renders a moment after the list narrows: wait for it,
    // or a late focus move would not be seen.
    await waitFor(() => expect(screen.getByText('Pager Guild 41')).toBeTruthy())
    expect(screen.getByRole('region', { name: 'Guilds' })).toBeTruthy()
    expect(document.activeElement).toBe(search)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('does nothing when the current page is chosen again, and arms nothing later', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)
    await user.click(screen.getByRole('button', { name: /^next page$/i }))
    scrollIntoView.mockClear()

    const current = screen.getByRole('button', { name: /^page 2$/i })
    await user.click(current)
    expect(document.activeElement).toBe(current)
    expect(scrollIntoView).not.toHaveBeenCalled()

    // The no-op press must not leave a pending focus move for a later,
    // filter-driven page reset.
    const search = screen.getByRole('textbox', { name: /search guilds/i })
    await user.type(search, 'Guild 4')
    // The reset to page 1 renders a moment after the list narrows: wait for it,
    // or a late focus move would not be seen.
    await waitFor(() => expect(screen.getByText('Pager Guild 41')).toBeTruthy())
    expect(screen.getByRole('region', { name: 'Guilds' })).toBeTruthy()
    expect(document.activeElement).toBe(search)
    expect(scrollIntoView).not.toHaveBeenCalled()
  })

  it('shows the position as text for phones, where the numbered row is hidden', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)
    expect(screen.getByText('Page 1 of 5')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /^next page$/i }))
    expect(screen.getByText('Page 2 of 5')).toBeTruthy()
  })

  it('keeps the no-results message inside the named list', async () => {
    source.empty = true
    render(<ExploreContent />)
    const list = screen.getByRole('region', { name: 'Guilds' })
    expect(list.textContent).toMatch(/no guilds found/i)
  })

  it('marks the list busy while the first read is still loading', () => {
    source.empty = true
    source.loading = true
    render(<ExploreContent />)
    expect(
      screen.getByRole('region', { name: 'Guilds' }).getAttribute('aria-busy')
    ).toBe('true')
  })
})
