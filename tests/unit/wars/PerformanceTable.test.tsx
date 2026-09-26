import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import PerformanceTable from '@/app/(dashboard)/wars/_components/PerformanceTable'
import type { UnitPerformance } from '@/app/(dashboard)/wars/_types'

function makeRow(
  id: string,
  name: string,
  winRate: number,
  uses: number,
  avgScore: number,
  avgKills: number
): UnitPerformance {
  return {
    unit: {
      id,
      name,
      shortCode: name.slice(0, 2).toUpperCase(),
      faction: 'Imperium'
    },
    uses,
    wins: 5,
    losses: 5,
    winRate,
    avgScore,
    avgKills
  }
}

// One deliberate winRate tie (Bravo/Charlie) exercises the stable name tiebreak.
const rows: UnitPerformance[] = [
  makeRow('u1', 'Alpha', 50, 12, 300, 2.5),
  makeRow('u2', 'Charlie', 90, 7, 100, 0.5),
  makeRow('u3', 'Bravo', 90, 20, 200, 1.5)
]

describe('PerformanceTable', () => {
  it('renders headers in order and defaults to win-rate descending', () => {
    render(<PerformanceTable rows={rows} />)

    const headers = screen.getAllByRole('columnheader')
    expect(headers.map((h) => h.textContent?.trim())).toEqual([
      'Unit',
      'Uses',
      'Win rate',
      'Avg score',
      'Avg kills'
    ])

    const bodyRows = document.querySelectorAll('tbody tr')
    expect(within(bodyRows[0] as HTMLElement).getByText('Bravo')).toBeTruthy()
  })

  it('flips to ascending when the active win-rate header is clicked again', async () => {
    const user = userEvent.setup()
    render(<PerformanceTable rows={rows} />)

    await user.click(
      screen.getByRole('button', { name: 'Sort Win rate ascending' })
    )

    const bodyRows = document.querySelectorAll('tbody tr')
    expect(within(bodyRows[0] as HTMLElement).getByText('Alpha')).toBeTruthy()
  })

  it('shows the original empty-state copy when there are no rows', () => {
    render(<PerformanceTable rows={[]} />)
    expect(
      screen.getByText('No data available for the selected period.')
    ).toBeTruthy()
  })

  it('breaks primary-value ties by unit name ascending (stable base order)', () => {
    render(<PerformanceTable rows={rows} />)

    const cells = screen
      .getAllByRole('row')
      .slice(1)
      .map((row) => within(row).getAllByRole('cell')[0]?.textContent)
    expect(cells[0]).toContain('Bravo')
    expect(cells[1]).toContain('Charlie')
    expect(cells[2]).toContain('Alpha')
  })
})
