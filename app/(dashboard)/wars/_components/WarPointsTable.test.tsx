import { describe, it, expect } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { WarPointsTable } from '@/app/(dashboard)/wars/_components/WarPointsTable'
import type { WarPointsRow } from '@/app/(dashboard)/wars/_components/_hooks/useWarAnalyticsData'

const row = (patch: Partial<WarPointsRow> = {}): WarPointsRow => ({
  playerId: 'p1',
  player: 'Guilliman',
  wars: 1,
  attempts: 10,
  total: 42,
  atk: 30,
  buf: 4,
  bon: 10,
  tok: -2,
  suc: 8,
  cnt16: 3,
  cnt14: 2,
  cnt12: 1,
  cnt11: 0,
  cln: 2,
  failN: 1,
  failM: 0,
  ...patch
})

describe('WarPointsTable', () => {
  it('renders headers in order and the first row', () => {
    render(
      <WarPointsTable
        warPoints={{ players: [row()], chartMax: 42, totalAttempts: 10 }}
        deselectedCount={0}
        warsCount={1}
      />
    )

    const table = screen.getByRole('table')
    const headerCells = within(table)
      .getAllByRole('columnheader')
      .map((th) => th.textContent)
    expect(headerCells).toEqual([
      'Player',
      '',
      'Tot',
      'Atk',
      'Buf',
      'Bon',
      'Pen',
      'Suc',
      '16',
      '14',
      '12',
      '11',
      'Cln',
      'FN',
      'FM'
    ])

    const [bodyRow] = within(table).getAllByRole('row').slice(1)
    const cells = within(bodyRow!)
      .getAllByRole('cell')
      .map((td) => td.textContent)
    expect(cells[0]).toContain('Guilliman')
    // The bar column is swapped per render; asserting its width catches a placeholder fallthrough.
    const barCell = within(bodyRow!).getAllByRole('cell')[1]!
    const bar = barCell.querySelector('div[style]') as HTMLElement
    expect(bar).toBeTruthy()
    expect(bar.style.width).toBe('100%') // total 42 of chartMax 42
    expect(cells[2]).toBe('42') // Tot
    expect(cells[3]).toBe('30') // Atk
    expect(cells[4]).toBe('+4') // Buf
    expect(cells[6]).toBe('-2') // Pen
  })

  it('has no sort controls — every column is static', () => {
    render(
      <WarPointsTable
        warPoints={{ players: [row()], chartMax: 42, totalAttempts: 10 }}
        deselectedCount={0}
        warsCount={1}
      />
    )
    expect(screen.queryAllByRole('button', { name: /Sort/ })).toHaveLength(0)
  })

  it('renders the empty state when there are no players', () => {
    render(
      <WarPointsTable
        warPoints={{ players: [], chartMax: 0, totalAttempts: 0 }}
        deselectedCount={0}
        warsCount={0}
      />
    )
    // Outside the tests directory's jest-dom types.
    expect(screen.getByText('No completed guild attacks yet.')).toBeTruthy()
  })
})
