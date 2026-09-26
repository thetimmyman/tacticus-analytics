import {
  getRarityFromProgressionIndex,
  type HeroMapping,
  type RosterUnit
} from '../utils/roster-helpers'
import {
  FACTIONS,
  type SortDirection,
  type SortField
} from './roster-constants'
import { normalizeIdentifier } from '@/app/lib/utils/normalize'

/** Case/space/punctuation-insensitive: "T'au Empire" -> "tauempire". */
export const normalizeFactionKey = normalizeIdentifier

const FACTION_MATCH_KEYS = new Map<string, Set<string>>(
  FACTIONS.map((f) => [
    f.id,
    new Set(
      [f.id, f.label, ...(f.aliases ?? [])].map((v) => normalizeFactionKey(v))
    )
  ])
)

export function matchesFaction(
  unitFaction: string,
  selectedFactionId: string
): boolean {
  const keys = FACTION_MATCH_KEYS.get(selectedFactionId)
  if (!keys) return false
  return keys.has(normalizeFactionKey(unitFaction))
}

export interface RosterFilterCriteria {
  searchTerm: string
  factionId: string
  alliance: string
  rarity: string
  rankTier: string
  abilityMin: string
  abilityMax: string
  sortField: SortField
  sortDirection: SortDirection
}

export const DEFAULT_CRITERIA: RosterFilterCriteria = {
  searchTerm: '',
  factionId: '',
  alliance: '',
  rarity: '',
  rankTier: '',
  abilityMin: '',
  abilityMax: '',
  sortField: 'rank',
  sortDirection: 'desc'
}

function matchesRankTier(rank: number, tier: string): boolean {
  switch (tier) {
    case 'stone':
      return rank >= 0 && rank <= 2
    case 'iron':
      return rank >= 3 && rank <= 5
    case 'bronze':
      return rank >= 6 && rank <= 8
    case 'silver':
      return rank >= 9 && rank <= 11
    case 'gold':
      return rank >= 12 && rank <= 14
    case 'diamond':
      return rank >= 15 && rank <= 17
    case 'mythic':
      return rank >= 18
    default:
      return true
  }
}

/** Empty `metaTeamHeroNames` = meta-team filter off. */
export function filterAndSortUnits(
  units: RosterUnit[],
  criteria: RosterFilterCriteria,
  opts: {
    heroMappings: Map<string, HeroMapping>
    metaTeamHeroNames: ReadonlySet<string>
  }
): RosterUnit[] {
  let filtered = units

  if (criteria.searchTerm) {
    const term = criteria.searchTerm.toLowerCase()
    filtered = filtered.filter(
      (u) =>
        u.name.toLowerCase().includes(term) || u.id.toLowerCase().includes(term)
    )
  }

  if (criteria.factionId) {
    filtered = filtered.filter((u) =>
      matchesFaction(u.faction, criteria.factionId)
    )
  }

  if (criteria.alliance) {
    filtered = filtered.filter((u) => u.grandAlliance === criteria.alliance)
  }

  if (criteria.rarity) {
    filtered = filtered.filter(
      (u) =>
        getRarityFromProgressionIndex(u.progressionIndex) === criteria.rarity
    )
  }

  if (criteria.rankTier) {
    filtered = filtered.filter((u) =>
      matchesRankTier(u.rank, criteria.rankTier)
    )
  }

  if (criteria.abilityMin || criteria.abilityMax) {
    const minLevel = criteria.abilityMin ? parseInt(criteria.abilityMin) : 1
    const maxLevel = criteria.abilityMax ? parseInt(criteria.abilityMax) : 6
    filtered = filtered.filter((u) => {
      const avgLevel =
        u.abilities.length > 0
          ? u.abilities.reduce((sum, a) => sum + a.level, 0) /
            u.abilities.length
          : 0
      return avgLevel >= minLevel && avgLevel <= maxLevel
    })
  }

  if (opts.metaTeamHeroNames.size > 0) {
    filtered = filtered.filter((u) => {
      const unitName = u.name.toLowerCase()
      const unitId = u.id.toLowerCase()
      const mapping = opts.heroMappings.get(u.id)
      const displayName = mapping?.display_name?.toLowerCase() || ''

      for (const heroName of opts.metaTeamHeroNames) {
        // displayName may be ''; `heroName.includes('')` would match every unmapped unit.
        if (
          unitName.includes(heroName) ||
          heroName.includes(unitName) ||
          unitId.includes(heroName) ||
          heroName.includes(unitId) ||
          (displayName !== '' &&
            (displayName.includes(heroName) || heroName.includes(displayName)))
        ) {
          return true
        }
      }
      return false
    })
  }

  const sorted = [...filtered].sort((a, b) => {
    let comparison = 0

    switch (criteria.sortField) {
      case 'name':
        comparison = a.name.localeCompare(b.name)
        break
      case 'rank':
        comparison = a.rank - b.rank
        break
      case 'xpLevel':
        comparison = a.xpLevel - b.xpLevel
        break
      case 'faction':
        comparison = a.faction.localeCompare(b.faction)
        break
      case 'grandAlliance':
        comparison = a.grandAlliance.localeCompare(b.grandAlliance)
        break
    }

    return criteria.sortDirection === 'asc' ? comparison : -comparison
  })

  return sorted
}
