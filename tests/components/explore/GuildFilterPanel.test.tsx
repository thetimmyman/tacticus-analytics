import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { Rarity } from '@tacticus/app-core/rarity-utils'
import { GuildFilterPanel } from '@/app/(public)/explore/components/GuildFilterPanel'
import type { GuildData } from '@/app/(public)/explore/types'

const guild = (over: Partial<GuildData> = {}): GuildData =>
  ({
    guild_code: 'AAAAA',
    guild_name: 'Example Guild',
    season: '12',
    active_players: 10,
    total_damage: 1000,
    ...over
  }) as GuildData

const RARITIES = ['Mythic', 'Legendary', 'Epic'] as Rarity[]

function setup(over: Record<string, unknown> = {}) {
  const props = {
    searchQuery: '',
    onSearchChange: vi.fn(),
    selectedCluster: 'all',
    onClusterChange: vi.fn(),
    clusters: ['Alpha', 'Independent'],
    sortBy: 'ranking',
    onSortChange: vi.fn(),
    availableRarities: RARITIES,
    selectedRarities: RARITIES.slice(0, 2),
    defaultRarities: RARITIES.slice(0, 2),
    rarityCounts: {},
    onRarityChange: vi.fn(),
    onRarityReset: vi.fn(),
    onResetFilters: vi.fn(),
    lastRefreshed: null,
    hasMounted: true,
    refreshing: false,
    onRefresh: vi.fn(),
    showSkeletons: false,
    filteredGuilds: [guild()],
    guilds: [guild()],
    ...over
  }
  render(<GuildFilterPanel {...props} />)
  return props
}

describe('Explore filter panel', () => {
  it('gives the search box and both selects an accessible name', () => {
    setup()
    expect(
      screen.getByRole('textbox', {
        name: /search guilds, clusters, or codes/i
      })
    ).toBeTruthy()
    expect(screen.getByRole('combobox', { name: /cluster/i })).toBeTruthy()
    expect(screen.getByRole('combobox', { name: /sort by/i })).toBeTruthy()
  })

  it('keeps rarity behind one disclosure that is closed on a phone', async () => {
    setup()
    const toggle = screen.getByRole('button', { name: /^rarity/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    // The strip stays in the DOM so it can be open from sm up; on a phone it is
    // CSS-hidden until the disclosure opens.
    const strip = document.getElementById(toggle.getAttribute('aria-controls')!)
    expect(strip?.className).toContain('hidden')
    await userEvent.click(toggle)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(strip?.className).not.toContain('hidden')
  })

  it('says on the closed control when rarity is not at its default', () => {
    setup({ selectedRarities: ['Epic'] as Rarity[] })
    const toggle = screen.getByRole('button', { name: /^rarity/i })
    expect(within(toggle).getByText('(1 active)')).toBeTruthy()
  })

  it('shows no rarity count and no Reset while everything is at its default', () => {
    setup()
    const toggle = screen.getByRole('button', { name: /^rarity/i })
    expect(within(toggle).queryByText(/active/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^reset$/i })).toBeNull()
  })

  it('offers one Reset when only the search or cluster is set, without a rarity count', async () => {
    const props = setup({ searchQuery: 'alpha' })
    const toggle = screen.getByRole('button', { name: /^rarity/i })
    expect(within(toggle).queryByText(/active/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /^reset$/i }))
    expect(props.onResetFilters).toHaveBeenCalledTimes(1)
  })

  it('does not count an empty rarity selection (which shows the defaults) as active', () => {
    setup({ selectedRarities: [] })
    const toggle = screen.getByRole('button', { name: /^rarity/i })
    expect(within(toggle).queryByText(/active/)).toBeNull()
    expect(screen.queryByRole('button', { name: /^reset$/i })).toBeNull()
  })

  it('shows a dash, not a time, for Last updated until a refresh has happened', () => {
    setup()
    expect(screen.getByText(/last updated/i).textContent).toBe(
      'Last updated: \u2014'
    )
  })

  it('reports a cluster choice as an active filter too', () => {
    setup({ selectedCluster: 'Alpha' })
    expect(screen.getByRole('button', { name: /^reset$/i })).toBeTruthy()
  })

  it('does not invent a season when no guild data says which one it is', () => {
    setup({ filteredGuilds: [], guilds: [] })
    expect(screen.getByTestId('explore-season').textContent).toBe('—')
    expect(screen.queryByText('83')).toBeNull()
  })

  it('skips a guild with no season when another one has it', () => {
    setup({
      guilds: [guild({ season: '' }), guild({ season: '114' })]
    })
    expect(screen.getByTestId('explore-season').textContent).toBe('114')
  })

  it('shows the season from the loaded data', () => {
    setup({ guilds: [guild({ season: '114' })] })
    expect(screen.getByTestId('explore-season').textContent).toBe('114')
  })

  it('keeps Refresh in the control row and disables it while reading', () => {
    const props = setup({ showSkeletons: true })
    const refresh = screen.getByRole('button', { name: /refresh data/i })
    expect((refresh as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(refresh)
    expect(props.onRefresh).not.toHaveBeenCalled()
  })
})
