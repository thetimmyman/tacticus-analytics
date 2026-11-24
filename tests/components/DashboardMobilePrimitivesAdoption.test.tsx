import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { MemberFilters } from '@/app/(dashboard)/guild-management/members/components/MemberFilters'
import { RosterFilterBar } from '@/app/(dashboard)/roster/components/RosterFilterBar'
import type { RosterFiltersApi } from '@/app/(dashboard)/roster/_lib/useRosterFilters'

function createRosterFilters(
  overrides: Partial<RosterFiltersApi> = {}
): RosterFiltersApi {
  return {
    filteredAndSortedUnits: [],
    searchTerm: '',
    setSearchTerm: vi.fn(),
    factionFilter: '',
    setFactionFilter: vi.fn(),
    allianceFilter: '',
    setAllianceFilter: vi.fn(),
    rarityFilter: '',
    setRarityFilter: vi.fn(),
    rankTierFilter: '',
    setRankTierFilter: vi.fn(),
    abilityMinFilter: '',
    setAbilityMinFilter: vi.fn(),
    abilityMaxFilter: '',
    setAbilityMaxFilter: vi.fn(),
    metaTeamFilter: [],
    setMetaTeamFilter: vi.fn(),
    sortField: 'rank',
    sortDirection: 'desc',
    handleSort: vi.fn(),
    toggleSortDirection: vi.fn(),
    changeSortField: vi.fn(),
    metaTeams: [],
    metaTeamsLoading: false,
    metaHeroesLoading: false,
    expandedHeroNames: new Set<string>(),
    teamCount: 0,
    ...overrides
  }
}

describe('Dashboard shared FilterBar adoptions', () => {
  it('RosterFilterBar delegates collapse count and reset to FilterBar', async () => {
    const user = userEvent.setup()
    const rf = createRosterFilters({
      searchTerm: 'Bellator',
      factionFilter: 'Ultramarines',
      rarityFilter: 'Legendary'
    })

    render(<RosterFilterBar rf={rf} />)

    const bar = screen.getByTestId('filter-bar')
    const toggle = within(bar).getByRole('button', {
      name: 'Filters (2 active)'
    })
    expect(toggle.className).toContain('sm:hidden')

    await user.click(within(bar).getByRole('button', { name: 'Reset' }))
    expect(rf.setSearchTerm).toHaveBeenCalledWith('')
    expect(rf.setFactionFilter).toHaveBeenCalledWith('')
    expect(rf.setRarityFilter).toHaveBeenCalledWith('')
    expect(rf.setMetaTeamFilter).toHaveBeenCalledWith([])
  })

  it('MemberFilters renders inside FilterBar and resets search and role', async () => {
    const user = userEvent.setup()
    const onSearchChange = vi.fn()
    const onRoleFilterChange = vi.fn()

    render(
      <MemberFilters
        searchTerm="Alpha"
        onSearchChange={onSearchChange}
        roleFilter="officer"
        onRoleFilterChange={onRoleFilterChange}
        roleOptions={['leader', 'officer', 'member']}
        roleBreakdown={
          new Map([
            ['leader', 1],
            ['officer', 4],
            ['member', 20]
          ])
        }
        rosterCount={25}
        claimedProfiles={20}
        veteranCount={10}
      />
    )

    const bar = screen.getByTestId('filter-bar')
    expect(within(bar).getByLabelText('Search Members')).toHaveValue('Alpha')
    expect(within(bar).getByLabelText('Role Filter')).toHaveValue('officer')

    await user.click(within(bar).getByRole('button', { name: 'Reset' }))
    expect(onSearchChange).toHaveBeenCalledWith('')
    expect(onRoleFilterChange).toHaveBeenCalledWith('all')
  })
})
