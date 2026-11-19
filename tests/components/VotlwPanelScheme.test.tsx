import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import type {
  PlayerPoints,
  SeasonResults,
  SetWinner
} from '@tacticus/app-core/votlw.types'
import VOTLWBattlefieldHonors from '@/app/components/votlw/VOTLWBattlefieldHonors'
import VOTLWIndividualAwards from '@/app/components/votlw/VOTLWIndividualAwards'
import VOTLWLeaderboard from '@/app/components/votlw/VOTLWLeaderboard'
import VOTLWSeasonStats from '@/app/components/votlw/VOTLWSeasonStats'

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
 * Each recap panel paints its own black surface, so the whole panel needs one
 * `scheme-dark` scope plus an opaque base: light-dark() follows the nearest
 * color-scheme, and a translucent gradient edge shows the light page through.
 * Contrast is measured in the browser fixture; this guards the structure.
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

const season: SeasonResults = {
  topKiller: { player: 'Alpha', value: 14 },
  bestBomber: { player: 'Bravo', value: 410_000 },
  worstBomb: { player: 'Delta', value: 1_200 },
  almostHadHim: { player: 'Charlie', boss: 'Sample Boss', hpLeft: 52_000 },
  firstToken: { player: 'Alpha', time: '2026-01-01T00:05:00Z' },
  lastToken: { player: 'Delta', time: '2026-01-07T23:40:00Z' },
  tokenEfficiency: { player: 'Bravo', ratio: 1.8 },
  mostDamage: { player: 'Alpha', damage: 9_000_000 },
  bombMaster: { player: 'Bravo', bombs: 12 },
  legendarySlayer: { player: 'Alpha', kills: 5 },
  sideBossSlayer: { player: 'Charlie', kills: 3 },
  mostImproved: { player: 'Delta', improvementPct: 22 }
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

  it('gives every black gradient card in the season stats its own opaque scope', () => {
    const { container } = render(<VOTLWSeasonStats seasonAwards={season} />)
    const cards = container.querySelectorAll(
      '.via-red-950\\/40, .via-orange-950\\/40'
    )

    expect(cards).toHaveLength(2)
    for (const card of cards) {
      expectInsideOpaquePanel(card, card)
    }
    expectInsideOpaquePanel(screen.getByText(/DEATH DEALER/u), cards[0] ?? null)
    expectInsideOpaquePanel(
      screen.getByText(/DEMOLITION EXPERT/u),
      cards[1] ?? null
    )
  })

  it('scopes the battlefield honors captions to the panel', () => {
    const { container } = render(
      <VOTLWBattlefieldHonors seasonAwards={season} />
    )
    const panel = container.firstElementChild

    expectInsideOpaquePanel(screen.getByText('Rising Star'), panel)
    expectInsideOpaquePanel(screen.getByText('First Token Used'), panel)
  })
})
