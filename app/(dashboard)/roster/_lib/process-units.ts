import {
  getRarityColor,
  getRarityFromProgressionIndex,
  resolveHeroIconUrl,
  type HeroMapping,
  type RosterUnit,
  type UnitRarity
} from '../utils/roster-helpers'

export interface ProcessedRosterUnit extends RosterUnit {
  rarity: UnitRarity
  rarityColor: string
  iconUrl: string | null
}

export function processUnits(
  units: RosterUnit[],
  heroMappings: Map<string, HeroMapping>
): ProcessedRosterUnit[] {
  return units.map((unit) => {
    const rarity = getRarityFromProgressionIndex(unit.progressionIndex)
    return {
      ...unit,
      rarity,
      rarityColor: getRarityColor(rarity),
      iconUrl: resolveHeroIconUrl(heroMappings, unit.id, unit.name)
    }
  })
}
