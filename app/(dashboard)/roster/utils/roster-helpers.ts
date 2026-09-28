import { RANK_NAMES as CANONICAL_RANK_NAMES } from '@/app/lib/tacticus/ranks'

export type UnitRarity =
  'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic'

export interface RosterUnit {
  id: string
  name: string
  faction: string
  grandAlliance: string
  progressionIndex: number
  xp: number
  xpLevel: number
  rank: number
  shards: number
  mythicShards?: number
  abilities: Array<{
    id: string
    level: number
  }>
  items?: Array<{
    slotId: string
    name: string
    rarity: string
  }>
}

export type RosterUnitEntry = RosterUnit & {
  engineId?: string | null
}

export interface HeroMapping {
  unit_id: string
  display_name: string | null
  web_icon_url: string | null
}

// Names come from the canonical 0..23 table; do not keep a local copy.
const RANK_NAMES: Record<number, string> = { ...CANONICAL_RANK_NAMES }

export const getRankName = (rank: number): string => {
  return RANK_NAMES[rank] || `Rank ${rank}`
}

const RANK_NAME_TO_INDEX: Record<string, number> = Object.fromEntries(
  Object.entries(RANK_NAMES).map(([idx, name]) => [name, Number(idx)])
)

export const getRankIndexFromName = (rankName: string): number => {
  return RANK_NAME_TO_INDEX[rankName] ?? 0
}

// Rank icons are vendored under public/images/ranks and served same-origin.
const RANK_ICON_BASE = '/images/ranks'

// stone/diamond/mythic use "ui_icon_rank_", iron/bronze/silver/gold "ui_icons_rank_".
const RANK_ICON_FILES: Record<number, string> = {
  0: 'ui_icon_rank_stone_01', // Stone I
  1: 'ui_icon_rank_stone_02', // Stone II
  2: 'ui_icon_rank_stone_03', // Stone III
  3: 'ui_icons_rank_iron_01', // Iron I
  4: 'ui_icons_rank_iron_02', // Iron II
  5: 'ui_icons_rank_iron_03', // Iron III
  6: 'ui_icons_rank_bronze_01', // Bronze I
  7: 'ui_icons_rank_bronze_02', // Bronze II
  8: 'ui_icons_rank_bronze_03', // Bronze III
  9: 'ui_icons_rank_silver_01', // Silver I
  10: 'ui_icons_rank_silver_02', // Silver II
  11: 'ui_icons_rank_silver_03', // Silver III
  12: 'ui_icons_rank_gold_01', // Gold I
  13: 'ui_icons_rank_gold_02', // Gold II
  14: 'ui_icons_rank_gold_03', // Gold III
  15: 'ui_icon_rank_diamond_01', // Diamond I
  16: 'ui_icon_rank_diamond_02', // Diamond II
  17: 'ui_icon_rank_diamond_03', // Diamond III
  18: 'ui_icon_rank_mythic_01', // Adamantium I
  19: 'ui_icon_rank_mythic_02', // Adamantium II
  20: 'ui_icon_rank_mythic_03' // Adamantium III
}

export const getRankIconUrl = (rank: number): string | null => {
  const file = RANK_ICON_FILES[rank]
  if (!file) return null
  return `${RANK_ICON_BASE}/${file}.png`
}

export const getRankColor = (rank: number): string => {
  if (rank >= 18) return 'text-orange-500' // Adamantium
  if (rank >= 15) return 'text-cyan-300' // Diamond
  if (rank >= 12) return 'text-yellow-400' // Gold
  if (rank >= 9) return 'text-gray-300' // Silver
  if (rank >= 6) return 'text-orange-400' // Bronze
  if (rank >= 3) return 'text-gray-400' // Iron
  return 'text-stone-500' // Stone
}

export const getRankBgColor = (rank: number): string => {
  if (rank >= 18)
    return 'bg-linear-to-r from-orange-600/30 to-red-500/30 border-orange-500/50' // Adamantium
  if (rank >= 15)
    return 'bg-linear-to-r from-cyan-600/30 to-blue-500/30 border-cyan-500/50' // Diamond
  if (rank >= 12) return 'bg-yellow-500/20 border-yellow-500/50' // Gold
  if (rank >= 9) return 'bg-gray-400/20 border-gray-400/50' // Silver
  if (rank >= 6) return 'bg-orange-500/20 border-orange-500/50' // Bronze
  if (rank >= 3) return 'bg-gray-500/20 border-gray-500/50' // Iron
  return 'bg-stone-600/20 border-stone-500/50' // Stone
}

export const getRarityFromProgressionIndex = (
  progressionIndex: number
): UnitRarity => {
  if (progressionIndex >= 16) return 'Mythic'
  if (progressionIndex >= 12) return 'Legendary'
  if (progressionIndex >= 9) return 'Epic'
  if (progressionIndex >= 6) return 'Rare'
  if (progressionIndex >= 3) return 'Uncommon'
  return 'Common'
}

export const getRarityColor = (rarity: UnitRarity): string => {
  switch (rarity) {
    case 'Mythic':
      return 'text-red-400'
    case 'Legendary':
      return 'text-cyan-300'
    case 'Epic':
      return 'text-yellow-400'
    case 'Rare':
      return 'text-blue-400'
    case 'Uncommon':
      return 'text-green-400'
    default:
      return 'text-gray-400'
  }
}

export const getRarityBorderColor = (rarity: UnitRarity): string => {
  switch (rarity) {
    case 'Mythic':
      return 'border-red-500/60 shadow-red-500/20 shadow-xs'
    case 'Legendary':
      return 'border-cyan-400/60 shadow-cyan-400/20 shadow-xs'
    case 'Epic':
      return 'border-yellow-500/60 shadow-yellow-500/20 shadow-xs'
    case 'Rare':
      return 'border-blue-500/60 shadow-blue-500/20 shadow-xs'
    case 'Uncommon':
      return 'border-green-500/60'
    default:
      return 'border-gray-500/40'
  }
}

export const resolveHeroIconUrl = (
  heroMappings: Map<string, HeroMapping>,
  unitId: string,
  name: string
): string | null => {
  const mapping =
    heroMappings.get(unitId) || heroMappings.get(name.toLowerCase())
  return mapping?.web_icon_url || null
}

export const isMythicWinged = (unit: RosterUnit): boolean => {
  if (unit.progressionIndex < 16) return false
  if (!unit.abilities || unit.abilities.length === 0) return false
  return unit.abilities.every((a) => a.level >= 50)
}

export const mergeRosterUnits = (
  units: RosterUnitEntry[],
  mows: RosterUnitEntry[]
): RosterUnitEntry[] => {
  const merged: RosterUnitEntry[] = []
  const seen = new Set<string>()
  const addUnit = (unit: RosterUnitEntry) => {
    const key =
      typeof unit.engineId === 'string' && unit.engineId.trim().length > 0
        ? unit.engineId
        : unit.id
    if (!key || seen.has(key)) return
    seen.add(key)
    merged.push(unit)
  }
  units.forEach(addUnit)
  mows.forEach(addUnit)
  return merged
}
