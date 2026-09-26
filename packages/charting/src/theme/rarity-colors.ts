export type Rarity =
  'Common' | 'Uncommon' | 'Rare' | 'Epic' | 'Legendary' | 'Mythic'

export const RARITY_COLORS: Record<Lowercase<Rarity>, string> = {
  common: '#94a3b8',
  uncommon: '#22c55e',
  rare: '#3b82f6',
  epic: '#a855f7',
  legendary: '#fbbf24',
  mythic: '#ef4444'
} as const

export function getRarityColors(): Record<string, string> {
  return { ...RARITY_COLORS }
}
