import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, onTestFinished, vi } from 'vitest'

const guild = (code: string, name: string) => ({
  guild_code: code,
  guild_tag: null,
  guild_name: name,
  cluster_code: 'C1',
  cluster_name: 'Alpha Cluster',
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
  explore_privacy_mode: 'public',
  last_updated: '2026-01-01T00:00:00Z'
})

const GUILDS = [guild('AAAAA', 'Alpha Guild'), guild('BBBBB', 'Beta Guild')]

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

const DETAILS = /5-season veterans/i

describe('Explore guild card disclosure', () => {
  it('exposes each guild as a heading holding one collapsed-by-default button', () => {
    render(<ExploreContent />)

    const heading = screen.getByRole('heading', {
      level: 3,
      name: 'Alpha Guild'
    })
    const button = within(heading).getByRole('button', { name: 'Alpha Guild' })
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(DETAILS)).toBeNull()
  })

  it('opens and closes the guild details from the keyboard (Enter, then Space)', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)

    const button = screen.getByRole('button', { name: 'Alpha Guild' })
    await user.tab()
    // Walk the tab order to the first guild card button; the filter controls come first.
    for (let i = 0; i < 20 && document.activeElement !== button; i += 1) {
      await user.tab()
    }
    expect(document.activeElement).toBe(button)

    await user.keyboard('{Enter}')
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText(DETAILS)).toBeTruthy()
    const panelId = button.getAttribute('aria-controls')
    expect(panelId).toBeTruthy()
    expect(document.getElementById(panelId as string)?.textContent).toMatch(
      DETAILS
    )

    await user.keyboard(' ')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByText(DETAILS)).toBeNull()
  })

  it('keeps one guild open at a time and reports it on the right button', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)

    const alpha = screen.getByRole('button', { name: 'Alpha Guild' })
    const beta = screen.getByRole('button', { name: 'Beta Guild' })
    await user.click(alpha)
    expect(alpha.getAttribute('aria-expanded')).toBe('true')
    await user.click(beta)
    expect(alpha.getAttribute('aria-expanded')).toBe('false')
    expect(beta.getAttribute('aria-expanded')).toBe('true')
  })

  it('still opens the details when the pointer hits the header away from the name', async () => {
    const user = userEvent.setup()
    render(<ExploreContent />)

    // The cluster line sits in the clickable header but outside the button.
    const [cluster] = screen.getAllByText('Alpha Cluster')
    await user.click(cluster)
    expect(
      screen
        .getByRole('button', { name: 'Alpha Guild' })
        .getAttribute('aria-expanded')
    ).toBe('true')
  })
  it('brings the opened guild header back into view, since closing the other one shifts the page', async () => {
    const original = Element.prototype.scrollIntoView
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    onTestFinished(() => {
      Element.prototype.scrollIntoView = original
    })
    const user = userEvent.setup()
    render(<ExploreContent />)

    await user.click(screen.getByRole('button', { name: 'Alpha Guild' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenLastCalledWith({ block: 'nearest' })

    // Collapsing scrolls nothing.
    await user.click(screen.getByRole('button', { name: 'Alpha Guild' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })
})
