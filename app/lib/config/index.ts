// damageType values ('Battle' | 'Bomb') are raw EOT_GR_data column values; no canonical enum.
export const RARITIES = {
  MYTHIC: 'Mythic',
  LEGENDARY: 'Legendary',
  EPIC: 'Epic',
  RARE: 'Rare',
  UNCOMMON: 'Uncommon',
  COMMON: 'Common'
} as const

export const TIER_THRESHOLDS = {
  MIN_BOSS_TIER: 4,
  MIN_PRIME_TIER: 1
} as const

export const BOSS_HP_BY_LEVEL = {
  L1: 4888667,
  L2: 7333333,
  L3: 9777333,
  L4: 12220000,
  L5: 14666667
} as const

export const MYTHIC_BOSS_HP_BY_LEVEL = {
  M1: 29333333,
  M2: 36666667,
  M3: 44000000,
  M4: 51333333,
  M5: 63000000
} as const

export type Rarity = (typeof RARITIES)[keyof typeof RARITIES]

export const BOSS_LEVELS = [1, 2, 3, 4, 5] as const
export type BossLevel = (typeof BOSS_LEVELS)[number]

export function isMainBossEncounter(encounterId: number): boolean {
  return encounterId === 0
}

export function isPrimeEncounter(encounterId: number): boolean {
  return encounterId > 0
}

/** The single source; do not re-declare. */
export const RARITY_RANK: Record<string, number> = {
  [RARITIES.MYTHIC]: 6,
  [RARITIES.LEGENDARY]: 5,
  [RARITIES.EPIC]: 4,
  [RARITIES.RARE]: 3,
  [RARITIES.UNCOMMON]: 2,
  [RARITIES.COMMON]: 1
}

/** Unknown sorts below Common. */
export function rarityRank(rarity: string | null | undefined): number {
  if (!rarity) return 0
  return RARITY_RANK[rarity] ?? 0
}
