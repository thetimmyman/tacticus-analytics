import { describe, expect, it } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import WarRoomAnalytics, { buildUsageRows } from './WarRoomAnalytics'
import type { HeroUsage } from './types'

const usage: HeroUsage[] = [
  {
    war_id: 'w1',
    player_id: 'p1',
    player_name: 'Alice',
    unit_id: 'kharn',
    is_mow: false,
    times_fielded: 2,
    times_died: 0
  },
  {
    war_id: 'w1',
    player_id: 'p2',
    player_name: 'Bob',
    unit_id: 'kharn',
    is_mow: false,
    times_fielded: 1,
    times_died: 1
  },
  {
    war_id: 'w1',
    player_id: 'p1',
    player_name: 'Alice',
    unit_id: 'necroReanimator',
    is_mow: true,
    times_fielded: 1,
    times_died: 0
  }
]

describe('WarRoomAnalytics', () => {
  it('aggregates per hero and shows fielded, used-by, and died counts', () => {
    render(<WarRoomAnalytics usage={usage} catalog={undefined} />)

    const table = screen.getByRole('table')
    const rows = within(table).getAllByRole('row')
    expect(rows).toHaveLength(3) // header + two heroes

    // kharn first: three fieldings, two players, one death.
    expect(within(rows[1]!).getByText('3')).toBeTruthy()
    expect(within(rows[1]!).getByText('2')).toBeTruthy()
    expect(within(rows[1]!).getByText('1')).toBeTruthy()
  })

  it('renders the empty state without a table', () => {
    render(<WarRoomAnalytics usage={[]} catalog={undefined} />)

    expect(
      screen.getByText('No hero usage recorded this war yet.')
    ).toBeTruthy()
    expect(screen.queryByRole('table')).toBeNull()
  })

  it('shapes rows by unique player identity and sorts by fieldings', () => {
    const rows = buildUsageRows([
      ...usage,
      {
        ...usage[0]!,
        player_id: 'p3',
        player_name: 'Alice',
        times_fielded: 1
      }
    ])

    expect(rows[0]).toMatchObject({
      unitId: 'kharn',
      timesFielded: 4,
      usedBy: 3
    })
    expect(rows[0]!.playerNames).toEqual(['Alice', 'Bob'])
  })
})
