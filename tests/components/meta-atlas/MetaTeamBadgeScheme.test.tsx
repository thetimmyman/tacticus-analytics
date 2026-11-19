import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/app/(dashboard)/meta-atlas/components/BossSearchCombobox', () => ({
  BossSearchCombobox: () => <div data-testid="boss-search" />
}))

import { MetaFilterBar } from '@/app/(dashboard)/meta-atlas/components/MetaFilterBar'
import {
  META_BADGE_NAMES,
  META_TEAM_FALLBACK
} from '@/app/lib/meta/meta-team-names'

/**
 * A badge that paints its own black surface must carry `scheme-dark`: the
 * amber/red/green text tiers resolve per color-scheme, so on the Light theme
 * they would otherwise land dark-on-black (Abaddon measured 1.78:1 and
 * 2.32:1). Contrast itself is measured in the browser; this guards the scope.
 */

const ALL_BADGES = [...META_BADGE_NAMES, META_TEAM_FALLBACK]
const BLACK_SURFACE = /^bg-black(\/\d+)?$/u

function renderBadges(selected: Set<string>) {
  const noop = vi.fn()
  render(
    <MetaFilterBar
      bossFilter=""
      onBossFilterChange={noop}
      showAllBosses={false}
      onToggleShowAll={noop}
      raritySets={['L1']}
      selectedRaritySets={new Set(['L1'])}
      onToggleRaritySet={noop}
      onSelectAllRaritySets={noop}
      onClearRaritySets={noop}
      metaTeams={ALL_BADGES}
      selectedMetaTeams={selected}
      onToggleMetaTeam={noop}
      onClearMetaTeams={noop}
      displayBossCount={1}
      currentSeason="106"
    />
  )
}

const tokensOf = (button: HTMLElement) => button.className.split(/\s+/u)

describe.each([
  ['unselected', new Set<string>()],
  ['selected', new Set<string>(ALL_BADGES)]
])('meta team badges (%s)', (state, selected) => {
  it('scopes Abaddon to the dark scheme with its black surface', () => {
    renderBadges(selected)

    const abaddon = screen.getByRole('button', { name: 'Abaddon' })
    expect(abaddon.getAttribute('aria-pressed')).toBe(
      String(state === 'selected')
    )
    const tokens = tokensOf(abaddon)
    expect(tokens.some((token) => BLACK_SURFACE.test(token))).toBe(true)
    expect(tokens).toContain('scheme-dark')
  })

  it('gives every black-surface badge the dark scheme', () => {
    renderBadges(selected)

    const blackSurfaces = ALL_BADGES.filter((name) =>
      tokensOf(screen.getByRole('button', { name })).some((token) =>
        BLACK_SURFACE.test(token)
      )
    )
    expect(blackSurfaces).toEqual(
      expect.arrayContaining(['Abaddon', 'Helbrecht', 'Lavstodes'])
    )
    for (const name of blackSurfaces) {
      expect(tokensOf(screen.getByRole('button', { name }))).toContain(
        'scheme-dark'
      )
    }
  })

  it('leaves translucent badges on the page scheme', () => {
    renderBadges(selected)

    for (const name of ['Admech', 'Custodes', 'Orkz', 'Other']) {
      expect(tokensOf(screen.getByRole('button', { name }))).not.toContain(
        'scheme-dark'
      )
    }
  })
})
