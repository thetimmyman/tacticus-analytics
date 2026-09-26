import {
  cleanup,
  fireEvent,
  render,
  screen,
  within
} from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RosterUnitsView } from '@/app/(dashboard)/roster/components/RosterUnitsView'
import type { ProcessedRosterUnit } from '@/app/(dashboard)/roster/_lib/process-units'
import type { RosterFiltersApi } from '@/app/(dashboard)/roster/_lib/useRosterFilters'

// View mode is CSS-gated, so both grid and table exist in jsdom; assert the table.

const baseUnit: ProcessedRosterUnit = {
  id: 'unit-1',
  name: 'Alpha',
  faction: 'Ultramarines',
  grandAlliance: 'Imperial',
  progressionIndex: 10,
  xp: 0,
  xpLevel: 5,
  rank: 3, // overridden per-unit below — ranks must differ so an

  shards: 20,
  abilities: [{ id: 'a1', level: 2 }],
  rarity: 'Rare',
  rarityColor: 'text-blue-400',
  iconUrl: null
}

// Given order contradicts the claimed sort, so an internal re-sort fails.
const units: ProcessedRosterUnit[] = [
  { ...baseUnit, id: 'u1', name: 'Alpha', xpLevel: 5, rank: 1 },
  { ...baseUnit, id: 'u2', name: 'Beta', xpLevel: 8, rank: 2 },
  { ...baseUnit, id: 'u3', name: 'Gamma', xpLevel: 2, rank: 3 }
]

function makeRf(overrides: Partial<RosterFiltersApi> = {}): RosterFiltersApi {
  return {
    sortField: 'rank',
    sortDirection: 'desc',
    handleSort: vi.fn(),
    ...overrides
  } as unknown as RosterFiltersApi
}

const tableRowNames = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map(
      (row) =>
        within(row).getAllByRole('cell')[0]?.querySelector('.font-medium')
          ?.textContent
    )

describe('RosterUnitsView table', () => {
  afterEach(() => cleanup())

  it('renders headers in order and the given (externally sorted) row order', () => {
    render(
      <RosterUnitsView
        units={units}
        totalFilteredCount={units.length}
        viewMode="table"
        rf={makeRf()}
      />
    )

    const headers = within(screen.getByRole('table'))
      .getAllByRole('columnheader')
      .map((h) => h.textContent?.trim())
    expect(headers).toEqual([
      'Name',
      'Faction',
      'Alliance',
      'Rank',
      'Stars',
      'Level',
      'Rarity',
      'Shards',
      'Abilities'
    ])

    expect(tableRowNames()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('forwards the clicked sortable column to the hook instead of sorting locally', () => {
    const handleSort = vi.fn()
    render(
      <RosterUnitsView
        units={units}
        totalFilteredCount={units.length}
        viewMode="table"
        rf={makeRf({ sortField: 'rank', sortDirection: 'desc', handleSort })}
      />
    )

    fireEvent.click(
      within(screen.getByRole('table')).getByRole('button', {
        name: /sort by name/i
      })
    )

    expect(handleSort).toHaveBeenCalledWith('name')
    expect(tableRowNames()).toEqual(['Alpha', 'Beta', 'Gamma'])
  })
})
