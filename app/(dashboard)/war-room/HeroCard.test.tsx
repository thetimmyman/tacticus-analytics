import { describe, expect, it } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HeroCatalog } from '@/app/lib/catalogs/heroes'
import HeroCard from './HeroCard'

const catalog = new HeroCatalog([
  {
    unitId: 'sy-gex',
    displayName: 'Sy-gex',
    faction: 'Adeptus Mechanicus',
    traits: [],
    iconUrl: '/icons/sy-gex.png',
    category: 'hero',
    engineId: 'admecDestroyer'
  }
])

function openDetails(name = 'Sy-gex') {
  fireEvent.click(screen.getByRole('button', { name: `${name} details` }))
  return screen.getByRole('dialog')
}

describe('War Room hero details', () => {
  it('uses the roster frame and canonical portrait id for owned heroes', () => {
    const { container } = render(
      <HeroCard
        unitId="admecDestroyer"
        role="core"
        catalog={catalog}
        rosterHero={{
          id: 'sy-gex-db-slug',
          engineId: 'admecDestroyer',
          rank: 8,
          xpLevel: 44,
          progressionIndex: 8,
          starLevel: 10,
          abilities: [
            { id: 'Active', level: 38 },
            { id: 'Passive', level: 34 }
          ]
        }}
        floorRankIndex={9}
      />
    )
    expect(
      container.querySelector(
        'img[src="/images/portraits/admecDestroyer.webp"]'
      )
    ).toBeTruthy()
    expect(
      container.querySelector('img[src="/images/frames/rare.webp"]')
    ).toBeTruthy()
    expect(container.querySelector('[style*="190 / 247"]')).toBeTruthy()
    expect(screen.getByRole('img', { name: '10 stars' })).toBeTruthy()
    const dialog = openDetails()
    expect(within(dialog).getByText(/Level 44/)).toBeTruthy()
    expect(within(dialog).getByText(/Below battlefield floor/)).toBeTruthy()
    expect(within(dialog).getByText(/10 stars/)).toBeTruthy()
    expect(
      within(dialog).getByText(/Abilities: Active 38 · Passive 34/)
    ).toBeTruthy()
  })

  it('has unique described-by ids for repeated copies and closes its dialog accessibly', async () => {
    render(
      <>
        <HeroCard unitId="admecDestroyer" role="core" catalog={catalog} />
        <HeroCard unitId="admecDestroyer" role="flex" catalog={catalog} />
      </>
    )
    const buttons = screen.getAllByRole('button', { name: 'Sy-gex details' })
    const ids = buttons.map((button) => button.getAttribute('aria-describedby'))
    expect(new Set(ids).size).toBe(2)
    ids.forEach((id) => expect(document.getElementById(id!)).toBeTruthy())
    const user = userEvent.setup()
    await user.click(buttons[0]!)
    expect(screen.getByRole('dialog')).toBeTruthy()
    await user.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' })
    )
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(document.activeElement).toBe(buttons[0])
  })

  it('shows owned MoW level and abilities without a hero gear rank', () => {
    render(
      <HeroCard
        unitId="admecDestroyer"
        role="mow"
        catalog={catalog}
        rosterHero={{
          id: 'sygex-row',
          category: 'mow',
          xpLevel: 30,
          progressionIndex: 6,
          abilities: [{ id: 'Cannon', level: 25 }]
        }}
      />
    )
    const dialog = openDetails()
    expect(dialog.textContent).toContain('Owned')
    expect(dialog.textContent).toContain('No hero gear rank')
    expect(dialog.textContent).toContain('Level 30')
    expect(dialog.textContent).toContain('Abilities: Cannon 25')
    expect(dialog.textContent).not.toContain('Gear Silver')
  })

  it.each([
    ['ready', 'Not owned'],
    ['loading', 'Loading roster…'],
    ['error', 'Roster unavailable; ownership unknown.']
  ] as const)(
    'reports MoW state accurately when roster is %s',
    (rosterStatus, expected) => {
      render(
        <HeroCard
          unitId="admecDestroyer"
          role="mow"
          catalog={catalog}
          rosterStatus={rosterStatus}
        />
      )
      expect(openDetails().textContent).toContain(expected)
      expect(screen.getByRole('dialog').textContent).toContain(
        'No hero gear rank'
      )
    }
  )
})
