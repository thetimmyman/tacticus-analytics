import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

const guild = (code: string, name: string, cluster: string) => ({
  guild_code: code,
  guild_tag: null,
  guild_name: name,
  cluster_code: cluster,
  cluster_name: `${cluster} Name`,
  season: '114',
  current_gr_ranking: 1,
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

const GUILDS = [
  guild('AAAAA', 'Alpha Guild', 'C1'),
  guild('BBBBB', 'Beta Guild', 'C2')
]

vi.mock('@/app/(public)/explore/hooks/useGuildData', () => ({
  useGuildData: () => ({
    guilds: GUILDS,
    loading: false,
    refreshing: false,
    lastRefreshed: null,
    handleManualRefresh: () => {}
  })
}))

import ExploreContent from '@/app/(public)/explore/ExploreContent'

describe('Explore page filters', () => {
  it('Reset clears search, cluster and rarity together and shows every guild at once', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)

    const search = screen.getByRole('textbox', {
      name: /search guilds/i
    }) as HTMLInputElement
    await user.type(search, 'alpha')
    // Wait for the typing debounce so the search itself is what hides Beta.
    await waitFor(() => expect(screen.queryByText('Beta Guild')).toBeNull())
    await user.selectOptions(
      screen.getByRole('combobox', { name: /cluster/i }),
      'C1'
    )
    await user.click(screen.getByRole('button', { name: /^rarity/i }))
    await user.click(screen.getByRole('button', { name: /^E\s*Epic/ }))
    expect(
      screen.getByRole('button', { name: /^rarity \(1 active\)/i })
    ).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /^reset$/i }))

    // No timers advanced: the list must not wait for the typing debounce.
    expect(search.value).toBe('')
    expect(
      (screen.getByRole('combobox', { name: /cluster/i }) as HTMLSelectElement)
        .value
    ).toBe('all')
    expect(screen.getByText('Alpha Guild')).toBeTruthy()
    expect(screen.getByText('Beta Guild')).toBeTruthy()
    expect(screen.getByRole('button', { name: /^rarity$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^reset$/i })).toBeNull()
  })

  it('keeps keyboard focus inside the filters after Reset removes the button', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)
    await user.type(
      screen.getByRole('textbox', { name: /search guilds/i }),
      'x'
    )
    const reset = screen.getByRole('button', { name: /^reset$/i })
    reset.focus()
    await user.keyboard('{Enter}')
    expect(document.activeElement).toBe(
      screen.getByRole('group', { name: /guild filters/i })
    )
  })

  it('offers Reset for a whitespace-only search, which also narrows the list', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)
    await user.type(
      screen.getByRole('textbox', { name: /search guilds/i }),
      ' '
    )
    expect(screen.getByRole('button', { name: /^reset$/i })).toBeTruthy()
  })
})
