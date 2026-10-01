import type { Boss, SeasonConfigInfo } from '../types'

export const canonicalizeBossId = (bossId: string): string => {
  const cleaned = bossId.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  if (cleaned.startsWith('tervigon')) return 'tervigon'
  if (cleaned.startsWith('hivetyrant')) return 'hive_tyrant'
  return cleaned
}

export const buildSeasonCanonicalMap = (
  allSeasons: SeasonConfigInfo[]
): Map<string, Set<string>> => {
  const map = new Map<string, Set<string>>()
  allSeasons.forEach((season) => {
    map.set(season.id, new Set(season.canonicals))
  })
  return map
}

export const filterBosses = ({
  bosses,
  seasonCanonicalMap,
  selectedSeason,
  searchQuery
}: {
  bosses: Boss[]
  seasonCanonicalMap: Map<string, Set<string>>
  selectedSeason: string
  searchQuery: string
}): Boss[] => {
  const normalizedQuery = searchQuery.toLowerCase()
  return bosses.filter((boss) => {
    const canonical = canonicalizeBossId(boss.id)

    if (selectedSeason !== 'all') {
      const seasonCanonicals = seasonCanonicalMap.get(selectedSeason)
      if (!seasonCanonicals?.has(canonical)) return false
    }

    const matchesSearch =
      boss.name.toLowerCase().includes(normalizedQuery) ||
      boss.faction.toLowerCase().includes(normalizedQuery) ||
      (boss.strain && boss.strain.toLowerCase().includes(normalizedQuery))

    return matchesSearch
  })
}

export const sortBossesByName = (bosses: Boss[]): Boss[] =>
  [...bosses].sort((a, b) => a.name.localeCompare(b.name))

export const RARITY_ORDER = [
  'Mythic',
  'Legendary',
  'Epic',
  'Rare',
  'Uncommon',
  'Common'
] as const
export type BossRarity = (typeof RARITY_ORDER)[number]

const RARITY_RANK: Record<string, number> = {
  Mythic: 0,
  Legendary: 1,
  Epic: 2,
  Rare: 3,
  Uncommon: 4,
  Common: 5
}

const FACTION_ORDER: Record<string, number> = {
  Tyranids: 0,
  Tau: 1,
  'Adeptus Mechanicus': 2,
  'Astra Militarum': 3,
  Aeldari: 4,
  Orks: 5,
  Necrons: 6,
  'Death Guard': 7,
  'Thousand Sons': 8
}

export const inferBossRarity = (boss: Boss): BossRarity => {
  const id = boss.id.toLowerCase()
  if (
    [
      'magnus',
      'mortarion',
      'silent-king',
      'ghazghkull',
      'avatar-of-khaine'
    ].includes(id)
  ) {
    return 'Mythic'
  }
  if (['riptide', 'belisarius'].includes(id)) {
    return 'Legendary'
  }
  if (['screamer-killer', 'rogal-dorn'].includes(id)) {
    return 'Epic'
  }
  if (id.includes('hive-tyrant')) {
    return 'Uncommon'
  }
  if (id.includes('tervigon')) {
    return 'Common'
  }
  return 'Rare'
}

export const sortBossesByRarity = (bosses: Boss[]): Boss[] =>
  [...bosses].sort((a, b) => {
    const rarityA = RARITY_RANK[inferBossRarity(a)] ?? 99
    const rarityB = RARITY_RANK[inferBossRarity(b)] ?? 99
    if (rarityA !== rarityB) return rarityA - rarityB

    const factionA = FACTION_ORDER[a.faction] ?? 99
    const factionB = FACTION_ORDER[b.faction] ?? 99
    if (factionA !== factionB) return factionA - factionB

    return a.name.localeCompare(b.name)
  })

/** en-US grouped integers; deliberately not number-format.ts#formatNumber (which rounds). */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat('en-US').format(value)
}
