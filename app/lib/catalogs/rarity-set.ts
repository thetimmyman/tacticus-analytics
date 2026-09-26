export const RARITY_SET_LEGENDARY_VALUES = [
  'L1',
  'L2',
  'L3',
  'L4',
  'L5'
] as const
export const RARITY_SET_MYTHIC_VALUES = ['M1', 'M2', 'M3', 'M4', 'M5'] as const

export const RARITY_SET_VALUES = [
  ...RARITY_SET_LEGENDARY_VALUES,
  ...RARITY_SET_MYTHIC_VALUES
] as const

export type RaritySetValue = (typeof RARITY_SET_VALUES)[number]

export function parseLevelString(
  level: string
): { rarity: string; set: number } | null {
  if (!level || level.length < 2) return null

  const rarityChar = level.charAt(0).toUpperCase()
  const setNum = Number.parseInt(level.substring(1), 10) - 1
  if (Number.isNaN(setNum) || setNum < 0 || setNum > 4) return null

  const rarityMap: Record<string, string> = {
    L: 'Legendary',
    M: 'Mythic',
    E: 'Epic',
    R: 'Rare',
    U: 'Uncommon',
    C: 'Common'
  }
  const rarity = rarityMap[rarityChar]
  return rarity ? { rarity, set: setNum } : null
}

export function getBossLevelFromSetAndRarity(
  set: number | null | undefined,
  rarity: string = 'Common',
  tier?: number | null
): string {
  if (set === null || set === undefined) return `T${tier ?? '?'}`
  const prefix = rarity ? rarity.charAt(0).toUpperCase() : 'T'
  return `${prefix}${set + 1}`
}

const RARITY_SET_VALUES_SET: ReadonlySet<string> = new Set(RARITY_SET_VALUES)

export function isValidRaritySet(value: unknown): value is RaritySetValue {
  return typeof value === 'string' && RARITY_SET_VALUES_SET.has(value)
}

export function raritySetLabel(value: string): string {
  if (!isValidRaritySet(value)) return value
  const tier = value.slice(1)
  const rarity = value.startsWith('L') ? 'Legendary' : 'Mythic'
  return `${value} (${rarity} Set ${tier})`
}

/** Inverse of SQL `get_rarity_set`: "L4" → { rarity: 'Legendary', set: 3 }. */
export function raritySetToColumns(
  value: string | null | undefined
): { rarity: 'Legendary' | 'Mythic'; set: number } | null {
  if (!isValidRaritySet(value)) return null
  const rarity = value.startsWith('L') ? 'Legendary' : 'Mythic'
  const tier = Number.parseInt(value.slice(1), 10)
  if (!Number.isFinite(tier) || tier < 1) return null
  return { rarity, set: tier - 1 }
}

export function compareRaritySetsHighToLow(a: string, b: string): number {
  const aColumns = raritySetToColumns(a)
  const bColumns = raritySetToColumns(b)
  if (!aColumns || !bColumns) {
    if (aColumns) return -1
    if (bColumns) return 1
    return a.localeCompare(b)
  }

  const rarityOrder =
    (bColumns.rarity === 'Mythic' ? 1 : 0) -
    (aColumns.rarity === 'Mythic' ? 1 : 0)
  if (rarityOrder !== 0) return rarityOrder
  return bColumns.set - aColumns.set
}

/** Mirrors SQL `get_rarity_set`; `set` is 0-indexed. */
export function columnsToRaritySet(
  rarity: string | null | undefined,
  set: number | null | undefined
): RaritySetValue | null {
  if (set == null || !Number.isFinite(set) || set < 0) return null
  const tier = Math.trunc(set) + 1
  const lower = (rarity ?? '').toLowerCase()
  const value =
    lower === 'legendary' ? `L${tier}` : lower === 'mythic' ? `M${tier}` : null
  return isValidRaritySet(value) ? value : null
}

export const RARITY_SET_LEGENDARY_OPTIONS: ReadonlyArray<{
  value: RaritySetValue
  label: string
}> = RARITY_SET_LEGENDARY_VALUES.map((value) => ({
  value,
  label: raritySetLabel(value)
}))

export const RARITY_SET_MYTHIC_OPTIONS: ReadonlyArray<{
  value: RaritySetValue
  label: string
}> = RARITY_SET_MYTHIC_VALUES.map((value) => ({
  value,
  label: raritySetLabel(value)
}))

const TIER_KEYCAPS: Record<number, string> = {
  1: '1⃣',
  2: '2⃣',
  3: '3⃣',
  4: '4⃣',
  5: '5⃣',
  6: '6⃣',
  7: '7⃣',
  8: '8⃣',
  9: '9⃣',
  10: '🔟'
}

export function tierKeycap(tier: number | null): string {
  if (tier === null) return ''
  return TIER_KEYCAPS[tier] ?? `T${tier}`
}
