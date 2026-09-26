import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import ActivityTable from '@/app/(dashboard)/wars/_components/ActivityTable'
import type { RecentAttempt } from '@/app/(dashboard)/wars/_types'

vi.mock('@/app/lib/hooks/useHasMounted', () => ({
  useHasMounted: () => true
}))

vi.mock('@/app/lib/catalogs/heroes', () => ({
  useHeroCatalog: () => ({ data: null })
}))

vi.mock('@/app/(dashboard)/wars/_components/ZoneImageTooltip', () => ({
  default: ({ children }: { children: ReactNode }) => children
}))

const rows: RecentAttempt[] = [
  {
    id: 'attempt-1',
    attacker: { name: 'Argent Vex', guildTag: 'ARGV' },
    defender: { name: 'Nullhold', guildTag: 'NULL' },
    attackerUnits: [
      {
        id: 'unit-1',
        name: 'Eldryon',
        shortCode: 'ELD',
        remainingHp: 100,
        startingHp: 100
      }
    ],
    defenderUnits: [
      {
        id: 'unit-2',
        name: 'Krogar',
        shortCode: 'KRO',
        remainingHp: null
      }
    ],
    // A real zone id; a non-zone value would hit the humanize fallback.
    zoneType: 'Trenches1',
    score: 12500,
    kills: 3,
    buffLevel: 2,
    time: '2026-08-01T12:00:00Z',
    isGuildMember: true,
    isPerfect: true,
    isFailed: false
  }
]

describe('ActivityTable', () => {
  it('renders headers in order and the first row content', () => {
    render(<ActivityTable rows={rows} />)

    const headers = screen
      .getAllByRole('columnheader')
      .map((h) => h.textContent)
    expect(headers).toEqual([
      'Attacker',
      'Attack Team',
      'Defender',
      'Defender Team',
      'Zone',
      'Kills',
      'Deaths',
      'Score',
      'Buff',
      'Time'
    ])

    const dataRows = screen.getAllByRole('row').slice(1)
    expect(dataRows).toHaveLength(1)
    const cells = within(dataRows[0]!).getAllByRole('cell')

    expect(cells[0]?.textContent).toContain('Argent Vex')
    expect(cells[0]?.textContent).toContain('ARGV')
    expect(cells[2]?.textContent).toContain('Nullhold')
    expect(cells[2]?.textContent).toContain('NULL')
    expect(cells[4]?.textContent).toBe('Left Frontline')
    expect(cells[5]?.textContent).toBe('3')
    expect(cells[6]?.textContent).toBe('0')
    expect(cells[7]?.textContent).toContain('12.5K')
    expect(cells[7]?.textContent).toContain('Perfect')
    expect(cells[8]?.textContent).toBe('Buff 2')
  })

  it('renders no data rows when there are no attempts', () => {
    render(<ActivityTable rows={[]} />)
    expect(screen.getAllByRole('row')).toHaveLength(2)
    expect(screen.queryByText('No data available.')).not.toBeInTheDocument()
  })

  it('renders no header ever gains a sort button (all columns sortable: false)', () => {
    render(<ActivityTable rows={rows} />)
    expect(
      screen
        .getAllByRole('columnheader')
        .some((header) => header.querySelector('button'))
    ).toBe(false)
  })
})
