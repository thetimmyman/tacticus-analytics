import { describe, expect, it } from 'vitest'
import { screen } from '@testing-library/react'

import { PersonalPotentialContent } from '@/app/(dashboard)/meta-atlas/components/PersonalPotentialContent'
import type { BossData } from '@/app/(dashboard)/meta-atlas/types'
import { renderWithProviders } from '../../utils/render'

const tokensOf = (cls: string) => cls.split(/\s+/u).filter(Boolean)

const DATA: BossData = {
  boss_type: 'guild_boss',
  boss_name: 'Synthetic Boss',
  boss_lookup_name: 'synthetic-boss',
  rarity_set: 'L1',
  encounter_index: 0,
  recommendations: [],
  loading: false,
  error: null
}

function renderWithoutRoster() {
  return renderWithProviders(
    <PersonalPotentialContent
      data={DATA}
      heroMappings={new Map()}
      rosterEntries={[]}
      hasBattleHistory={false}
      hasRoster={false}
    />
  )
}

describe('Connect Your Roster empty state on Light Mode', () => {
  it('titles the empty state with a theme-aware token, not text-white on the pale surface', () => {
    const { container } = renderWithoutRoster()
    const heading = screen.getByRole('heading', { name: 'Connect Your Roster' })
    const tokens = tokensOf(heading.getAttribute('class') ?? '')

    // The surface is a translucent amber tint over the white Light Mode page,
    // where text-white would vanish.
    expect(container.innerHTML).toContain('bg-amber-500/5')
    expect(tokens).not.toContain('text-white')
    expect(tokens).toContain('text-primary-wh40k')
  })

  it('leaves no text-white inside the empty-state content', () => {
    const { container } = renderWithoutRoster()

    expect(
      [...container.querySelectorAll('*')].filter((el) =>
        tokensOf(el.getAttribute('class') ?? '').includes('text-white')
      )
    ).toEqual([])
  })
})
