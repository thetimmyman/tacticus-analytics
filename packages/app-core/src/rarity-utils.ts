/** Rarity detection so dashboard features work at any rarity a guild has data for. */

export type Rarity =
  'Mythic' | 'Legendary' | 'Epic' | 'Rare' | 'Uncommon' | 'Common'

export const RARITY_HIERARCHY: Rarity[] = [
  'Mythic',
  'Legendary',
  'Epic',
  'Rare',
  'Uncommon',
  'Common'
]

export interface RarityConfig {
  cssClass: string
  colorClass: string
  prefix: string
  color: string
  description: string
}

export const RARITY_CONFIGS: Record<Rarity, RarityConfig> = {
  Mythic: {
    cssClass: 'mythic-section',
    colorClass: 'orange',
    prefix: 'M',
    color: '#ff6b35',
    description: 'Molten/Fiery'
  },
  Legendary: {
    cssClass: 'diamond-section',
    colorClass: 'blue',
    prefix: 'L',
    color: '#93c5fd',
    description: 'Diamond/Shimmer'
  },
  Epic: {
    cssClass: 'epic-section',
    colorClass: 'yellow',
    prefix: 'E',
    color: '#ffd700',
    description: 'Gold/Sparkling'
  },
  Rare: {
    cssClass: 'rare-section',
    colorClass: 'blue',
    prefix: 'R',
    color: '#2196f3',
    description: 'Blue/Dazzling/Pulsing'
  },
  Uncommon: {
    cssClass: 'uncommon-section',
    colorClass: 'green',
    prefix: 'U',
    color: '#4caf50',
    description: 'Green/Glowing'
  },
  Common: {
    cssClass: 'common-section',
    colorClass: 'gray',
    prefix: 'C',
    color: '#9e9e9e',
    description: 'Grey/Solid'
  }
}

export interface BossHit {
  rarity: string
  damage: number
  encounterId?: number | null
  player?: string | null
  [key: string]: unknown
}

export function normalizeRarity(value: unknown): Rarity | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().toLowerCase()
  const match = RARITY_HIERARCHY.find(
    (rarity) => rarity.toLowerCase() === trimmed
  )
  return match ?? null
}

export function getTopRaritiesWithData(
  bossHits: BossHit[],
  topN: number = 2
): Rarity[] {
  if (!bossHits || bossHits.length === 0) return []

  const raritiesWithData = Array.from(
    new Set(
      bossHits
        .filter((hit) => hit.damage > 0)
        .map((hit) => normalizeRarity(hit.rarity))
        .filter((rarity): rarity is Rarity => Boolean(rarity))
    )
  )

  return RARITY_HIERARCHY.filter((rarity) =>
    raritiesWithData.includes(rarity)
  ).slice(0, topN)
}

export function getAllRaritiesWithData(bossHits: BossHit[]): Rarity[] {
  return getTopRaritiesWithData(bossHits, RARITY_HIERARCHY.length)
}

export function getRarityConfig(rarity: string): RarityConfig {
  return RARITY_CONFIGS[rarity as Rarity] || RARITY_CONFIGS.Common
}

export function getRarityPrefix(rarity: string): string {
  const normalized = normalizeRarity(rarity)
  if (!normalized) return ''
  return (
    RARITY_CONFIGS[normalized]?.prefix || normalized.charAt(0).toUpperCase()
  )
}

export function getRarityDisplayName(rarity: string): string {
  const normalized = normalizeRarity(rarity)
  return normalized ?? rarity ?? ''
}

export function sortRaritiesByHierarchy(
  items: Rarity[],
  direction?: 'asc' | 'desc'
): Rarity[]
export function sortRaritiesByHierarchy<T extends { rarity: string }>(
  items: T[],
  direction?: 'asc' | 'desc'
): T[]
export function sortRaritiesByHierarchy<T extends Rarity | { rarity: string }>(
  items: T[],
  direction: 'asc' | 'desc' = 'asc'
): T[] {
  const rank = (rarity: string) => {
    const normalized = normalizeRarity(rarity)
    const index = normalized
      ? RARITY_HIERARCHY.indexOf(normalized)
      : RARITY_HIERARCHY.length
    return index === -1 ? RARITY_HIERARCHY.length : index
  }

  const getValue = (item: T) =>
    typeof item === 'string' ? item : (item as { rarity: string }).rarity

  const multiplier = direction === 'asc' ? 1 : -1
  return [...items].sort(
    (a, b) => (rank(getValue(a)) - rank(getValue(b))) * multiplier
  )
}
