import type {
  HeroMapping,
  RosterUnit,
  WarLineup
} from '../_hooks/useWarLineups'

export type LineupSortField = 'name' | 'rank' | 'faction'
export type LineupSortDirection = 'asc' | 'desc'

export interface EnrichedRosterUnit extends RosterUnit {
  heroMapping: HeroMapping | undefined
}

export function buildHeroMappingMap(heroMappings: HeroMapping[]) {
  return new Map(heroMappings.map((mapping) => [mapping.unit_id, mapping]))
}

export function enrichRoster(
  roster: RosterUnit[],
  heroMappingMap: Map<string, HeroMapping>
): EnrichedRosterUnit[] {
  return roster.map((unit) => ({
    ...unit,
    heroMapping: heroMappingMap.get(unit.id)
  }))
}

export function filterAndSortRoster(
  roster: EnrichedRosterUnit[],
  options: {
    search: string
    faction: string
    alliance: string
    sortField: LineupSortField
    sortDirection: LineupSortDirection
  }
) {
  const search = options.search.toLowerCase()
  return roster
    .filter(
      (unit) =>
        !search ||
        (unit.name ?? '').toLowerCase().includes(search) ||
        unit.heroMapping?.display_name?.toLowerCase().includes(search) ||
        unit.id.toLowerCase().includes(search)
    )
    .filter(
      (unit) => options.faction === 'all' || unit.faction === options.faction
    )
    .filter(
      (unit) =>
        options.alliance === 'all' || unit.grandAlliance === options.alliance
    )
    .sort((a, b) => {
      let comparison = 0
      switch (options.sortField) {
        case 'name':
          comparison = (a.name ?? '').localeCompare(b.name ?? '')
          break
        case 'rank':
          comparison = (a.rank ?? 0) - (b.rank ?? 0)
          break
        case 'faction':
          comparison = (a.faction ?? '').localeCompare(b.faction ?? '')
          break
      }
      return options.sortDirection === 'desc' ? -comparison : comparison
    })
}

export function filterMachinesOfWar(
  machines: HeroMapping[],
  searchTerm: string
) {
  const search = searchTerm.toLowerCase()
  if (!search) return machines
  return machines.filter(
    (machine) =>
      machine.display_name?.toLowerCase().includes(search) ||
      machine.unit_id.toLowerCase().includes(search)
  )
}

export function getStarTierFromProgressionIndex(progressionIndex: number) {
  if (progressionIndex >= 16) return 6
  if (progressionIndex >= 12) return 5
  if (progressionIndex >= 9) return 4
  if (progressionIndex >= 6) return 3
  if (progressionIndex >= 3) return 2
  return 1
}

export function getAbilityLevels(unit: RosterUnit | undefined) {
  const abilities = unit?.abilities
  if (!abilities || abilities.length === 0) return null
  const levels = abilities
    .filter((ability) => typeof ability?.level === 'number')
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
    .map((ability) => ability.level)
  return levels.length > 0 ? levels.join('/') : null
}

export function buildLineupSlots(lineups: WarLineup[], maxLineups: number) {
  const lineupMap = new Map(
    lineups.map((lineup) => [lineup.slot_number, lineup])
  )
  const maxSlot =
    lineups.length > 0
      ? Math.max(...lineups.map((lineup) => lineup.slot_number))
      : 0
  const count = Math.min(Math.max(maxSlot + 1, lineups.length + 1), maxLineups)
  return {
    lineupMap,
    slots: Array.from({ length: count }, (_, index) => index + 1)
  }
}
