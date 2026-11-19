import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type { PlayerPoints, SetWinner } from '@tacticus/app-core/votlw.types'
import VOTLWIndividualAwards from '@/app/components/votlw/VOTLWIndividualAwards'
import VOTLWLeaderboard from '@/app/components/votlw/VOTLWLeaderboard'

// Player names resolve through a query client; the panels only need the text.
vi.mock('@/app/components/ui/PlayerLink', () => ({
  PlayerLink: ({
    playerName,
    children
  }: {
    playerName: string
    children?: React.ReactNode
  }) => <span>{children ?? playerName}</span>
}))

/**
 * Each season-recap showpiece paints its own black surface, so the whole
 * panel must sit inside one `scheme-dark` scope that also has an opaque base:
 * the status palette resolves light-dark() against the nearest color-scheme,
 * and a header or caption outside that scope (or on a translucent gradient
 * edge that shows the page) reads against the wrong background on the light
 * theme. Contrast itself is measured in the browser fixture
 * (UI/Season recap panels story); this guards the structure it relies on.
 */

const player: PlayerPoints = {
  displayName: 'Alpha',
  totalPoints: 100,
  avgDamagePerHit: 400_000,
  tokenCount: 30,
  sweeps: 4,
  oneShots: 2,
  bombsUsed: 3,
  crashes: 1,
  awards: {
    goldMedals: 1,
    silverMedals: 0,
    bronzeMedals: 0,
    mostDamageAwards: 0,
    sideBossWins: 0,
    biggestHitAwards: 0,
    topKiller: false,
    bestBomber: false
  },
  breakdown: []
}

const winner: SetWinner = {
  set: 1,
  rarity: 'Legendary',
  levelString: 'L1',
  bossName: 'Sample Boss',
  gold: 'Alpha',
  silver: 'Bravo',
  bronze: 'Charlie',
  mostDamage: 'Alpha',
  sideBoss1: 'Delta',
  sideBoss2: 'Bravo',
  biggestHit: 'Charlie'
}

function expectInsideOpaquePanel(element: Element, panel: Element | null) {
  const scope = element.closest('.scheme-dark')
  expect(scope).not.toBeNull()
  expect(scope).toBe(panel)
  expect(scope).toHaveClass('bg-black')
}

describe('season recap panels keep their dark scope whole', () => {
  it('scopes the leaderboard header, toggle and expanded rankings to the panel', () => {
    const { container } = render(<VOTLWLeaderboard playerPoints={[player]} />)
    const panel = container.firstElementChild

    expectInsideOpaquePanel(screen.getByText('Battle Leaderboard'), panel)
    expectInsideOpaquePanel(screen.getByText('Full Season Rankings'), panel)
    const toggle = screen.getByRole('button', { name: /Show Full Rankings/u })
    expectInsideOpaquePanel(toggle, panel)

    fireEvent.click(toggle)
    expectInsideOpaquePanel(
      screen.getByPlaceholderText(/Search player/u),
      panel
    )
  })

  it('scopes the champion stats captions to the panel', () => {
    const { container } = render(
      <VOTLWIndividualAwards setWinners={[winner]} />
    )
    const panel = container.firstElementChild

    expectInsideOpaquePanel(screen.getByText('Champion Stats'), panel)
    expectInsideOpaquePanel(
      screen.getByText('Battle Records & Achievements'),
      panel
    )
    expectInsideOpaquePanel(screen.getByText(/Showing: Level/u), panel)
    expectInsideOpaquePanel(screen.getByRole('table'), panel)
  })
})
