import type { UnitRarity } from '../utils/roster-helpers'

export type SortField =
  'name' | 'rank' | 'xpLevel' | 'faction' | 'grandAlliance'
export type SortDirection = 'asc' | 'desc'
export type RosterViewMode = 'grid' | 'table'

export const ROSTER_VIEW_MODE_STORAGE_KEY = 'roster-view-mode'

export interface FactionDef {
  /** Matches FactionIcon's camelCase keys. */
  id: string
  label: string
  /** Extra game-data spellings; matching is normalized, so only genuinely different names. */
  aliases?: string[]
}

// Game data mixes camelCase ids, spaced names and renames, hence alias matching.
export const FACTIONS: FactionDef[] = [
  { id: 'Ultramarines', label: 'Ultramarines' },
  { id: 'BlackLegion', label: 'Black Legion' },
  { id: 'Orks', label: 'Orks' },
  { id: 'AstraMilitarum', label: 'Astra Militarum' },
  { id: 'Necrons', label: 'Necrons' },
  { id: 'DeathGuard', label: 'Death Guard' },
  {
    id: 'Sisterhood',
    label: 'Adepta Sororitas',
    aliases: ['Sisters of Battle']
  },
  { id: 'BlackTemplars', label: 'Black Templars' },
  { id: 'DarkAngels', label: 'Dark Angels' },
  { id: 'SpaceWolves', label: 'Space Wolves' },
  { id: 'WorldEaters', label: 'World Eaters' },
  { id: 'ThousandSons', label: 'Thousand Sons' },
  { id: 'Tyranids', label: 'Tyranids' },
  { id: 'Tau', label: "T'au Empire", aliases: ['Tau Empire'] },
  { id: 'Aeldari', label: 'Aeldari', aliases: ['Eldar'] },
  { id: 'LeaguesOfVotann', label: 'Leagues of Votann', aliases: ['Votann'] },
  { id: 'AdeptusMechanicus', label: 'Adeptus Mechanicus', aliases: ['AdMech'] },
  { id: 'BloodAngels', label: 'Blood Angels' },
  { id: 'Genestealers', label: 'Genestealer Cults', aliases: ['GSC'] },
  { id: 'Custodes', label: 'Adeptus Custodes' },
  { id: 'EmperorsChildren', label: "Emperor's Children" }
]

export const GRAND_ALLIANCES = ['Imperial', 'Chaos', 'Xenos']

export const RARITIES: UnitRarity[] = [
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary',
  'Mythic'
]

export const RANK_TIERS = [
  { value: '', label: 'All Ranks' },
  { value: 'stone', label: 'Stone (0-2)' },
  { value: 'iron', label: 'Iron (3-5)' },
  { value: 'bronze', label: 'Bronze (6-8)' },
  { value: 'silver', label: 'Silver (9-11)' },
  { value: 'gold', label: 'Gold (12-14)' },
  { value: 'diamond', label: 'Diamond (15-17)' },
  { value: 'mythic', label: 'Adamantium (18+)' }
]

export const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'rank', label: 'Rank' },
  { value: 'name', label: 'Name' },
  { value: 'xpLevel', label: 'Level' },
  { value: 'faction', label: 'Faction' },
  { value: 'grandAlliance', label: 'Alliance' }
]
