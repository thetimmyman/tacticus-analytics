export const DAMAGE_TYPES = Object.freeze(['Battle', 'Bomb', 'Skip'] as const)
export const ENCOUNTER_TYPES = Object.freeze([
  'Standard',
  'Prime',
  'Legendary',
  'Mythic'
] as const)
export const RARITY_LEVELS = Object.freeze([
  'Common',
  'Uncommon',
  'Rare',
  'Epic',
  'Legendary'
] as const)
export const PLAYER_ROLES = Object.freeze([
  'leader',
  'officer',
  'member',
  'Leader',
  'Officer',
  'Member',
  'demo'
] as const)
export const TOKEN_STATES = Object.freeze([
  'available',
  'used',
  'reserved'
] as const)
export const BOSS_PREFERENCES = Object.freeze([
  'preferred',
  'available',
  'unavailable',
  'blocked'
] as const)
