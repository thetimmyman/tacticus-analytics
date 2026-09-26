import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PlayerStatsTable from '@/app/(dashboard)/wars/_components/PlayerStatsTable'
import type { PlayerStats } from '@/app/(dashboard)/wars/_types'

function makePlayer(id: string, name: string, points: number): PlayerStats {
  return {
    playerId: id,
    playerName: name,
    attacks: {
      total: 10,
      wins: 5,
      losses: 5,
      points,
      perfect: 0,
      failed: 0,
      winRate: 50
    },
    defenses: { total: 5, holds: 2, breaches: 3, conceded: 1, holdRate: 40 }
  }
}

const players: PlayerStats[] = [
  makePlayer('p1', 'Anna', 100),
  makePlayer('p2', 'Bill', 300),
  makePlayer('p3', 'Cara', 200)
]

describe('PlayerStatsTable', () => {
  it('renders headers in order and defaults to points descending', () => {
    render(<PlayerStatsTable players={players} />)

    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent?.trim())).toEqual([
      'Player',
      'Zone',
      'Attacks',
      'Official Points',
      'Perfect',
      'Defended',
      'Held',
      'Failed',
      'Conceded'
    ])

    const bodyRows = document.querySelectorAll('tbody tr')
    expect(within(bodyRows[0] as HTMLElement).getByText('Bill')).toBeTruthy()
  })

  it('flips to ascending when the active points header is clicked again', async () => {
    const user = userEvent.setup()
    render(<PlayerStatsTable players={players} />)

    await user.click(
      screen.getByRole('button', { name: 'Sort Official Points ascending' })
    )

    const bodyRows = document.querySelectorAll('tbody tr')
    expect(within(bodyRows[0] as HTMLElement).getByText('Anna')).toBeTruthy()
  })

  it('sorts constant-valued columns by player name via the stable tiebreak', async () => {
    // Fixtures share identical defense stats, so Held falls through to the name tiebreak.
    render(<PlayerStatsTable players={players} />)

    await userEvent.click(screen.getByRole('button', { name: /sort by held/i }))

    const names = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent)
    expect(names[0]).toContain('Anna')
    expect(names[1]).toContain('Bill')
    expect(names[2]).toContain('Cara')
  })
})
