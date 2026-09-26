'use client'

import { useMemo, useState } from 'react'
import { useMetaTeams } from '@/app/hooks/useMetaTeams'
import { useMetaTeamHeroes } from '@/app/hooks/useMetaTeamHeroes'
import type { HeroMapping, RosterUnit } from '../utils/roster-helpers'
import type { SortDirection, SortField } from './roster-constants'
import { filterAndSortUnits } from './roster-filtering'

const EMPTY_HERO_NAMES: ReadonlySet<string> = new Set()

export type RosterFiltersApi = ReturnType<typeof useRosterFilters>

export function useRosterFilters(
  units: RosterUnit[],
  heroMappings: Map<string, HeroMapping>
) {
  const [searchTerm, setSearchTerm] = useState('')
  const [factionFilter, setFactionFilter] = useState('')
  const [allianceFilter, setAllianceFilter] = useState('')
  const [rarityFilter, setRarityFilter] = useState('')
  const [rankTierFilter, setRankTierFilter] = useState('')
  const [abilityMinFilter, setAbilityMinFilter] = useState('')
  const [abilityMaxFilter, setAbilityMaxFilter] = useState('')
  const [metaTeamFilter, setMetaTeamFilter] = useState<string[]>([])
  const [sortField, setSortField] = useState<SortField>('rank')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')

  const { metaTeams, loading: metaTeamsLoading } = useMetaTeams()
  const {
    expandedHeroNames,
    loading: metaHeroesLoading,
    teamCount
  } = useMetaTeamHeroes(metaTeamFilter, metaTeams)

  const filteredAndSortedUnits = useMemo(
    () =>
      filterAndSortUnits(
        units,
        {
          searchTerm,
          factionId: factionFilter,
          alliance: allianceFilter,
          rarity: rarityFilter,
          rankTier: rankTierFilter,
          abilityMin: abilityMinFilter,
          abilityMax: abilityMaxFilter,
          sortField,
          sortDirection
        },
        {
          heroMappings,
          // Inactive until chips are selected and hero names have resolved.
          metaTeamHeroNames:
            metaTeamFilter.length > 0 ? expandedHeroNames : EMPTY_HERO_NAMES
        }
      ),
    [
      units,
      searchTerm,
      factionFilter,
      allianceFilter,
      rarityFilter,
      rankTierFilter,
      abilityMinFilter,
      abilityMaxFilter,
      metaTeamFilter,
      expandedHeroNames,
      heroMappings,
      sortField,
      sortDirection
    ]
  )

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection(field === 'name' ? 'asc' : 'desc')
    }
  }

  const toggleSortDirection = () => {
    setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'))
  }

  const changeSortField = (field: SortField) => {
    setSortField(field)
    setSortDirection(field === 'name' ? 'asc' : 'desc')
  }

  return {
    filteredAndSortedUnits,
    searchTerm,
    setSearchTerm,
    factionFilter,
    setFactionFilter,
    allianceFilter,
    setAllianceFilter,
    rarityFilter,
    setRarityFilter,
    rankTierFilter,
    setRankTierFilter,
    abilityMinFilter,
    setAbilityMinFilter,
    abilityMaxFilter,
    setAbilityMaxFilter,
    metaTeamFilter,
    setMetaTeamFilter,
    sortField,
    sortDirection,
    handleSort,
    toggleSortDirection,
    changeSortField,
    metaTeams,
    metaTeamsLoading,
    metaHeroesLoading,
    expandedHeroNames,
    teamCount
  }
}
