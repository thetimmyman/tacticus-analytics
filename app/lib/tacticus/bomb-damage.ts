// Bomb damage for the Herald bomb-range alert. Bombs roll a flat range by guild
// level (source: tacticus.wiki.gg/wiki/Guild_Level). Modes assume every bomb rolls
// the floor (worst_case, guarantees a finish), midpoint (average) or ceil (best_case).

export type BombCalculationMode = 'worst_case' | 'average' | 'best_case'

export const BOMB_CALCULATION_MODES: BombCalculationMode[] = [
  'worst_case',
  'average',
  'best_case'
]

export const DEFAULT_BOMB_CALCULATION_MODE: BombCalculationMode = 'worst_case'

export const BOMB_DAMAGE_BY_GUILD_LEVEL: Record<
  number,
  { floor: number; ceil: number }
> = {
  1: { floor: 80, ceil: 100 },
  2: { floor: 90, ceil: 120 },
  3: { floor: 100, ceil: 140 },
  4: { floor: 120, ceil: 160 },
  5: { floor: 140, ceil: 180 },
  6: { floor: 160, ceil: 210 },
  7: { floor: 180, ceil: 240 },
  8: { floor: 210, ceil: 280 },
  9: { floor: 240, ceil: 320 },
  10: { floor: 280, ceil: 370 },
  11: { floor: 320, ceil: 430 },
  12: { floor: 370, ceil: 490 },
  13: { floor: 430, ceil: 560 },
  14: { floor: 490, ceil: 640 },
  15: { floor: 560, ceil: 740 },
  16: { floor: 640, ceil: 850 },
  17: { floor: 740, ceil: 980 },
  18: { floor: 850, ceil: 1130 },
  19: { floor: 980, ceil: 1300 },
  20: { floor: 1130, ceil: 1500 },
  21: { floor: 1300, ceil: 1730 },
  22: { floor: 1500, ceil: 1990 },
  23: { floor: 1730, ceil: 2290 },
  24: { floor: 1990, ceil: 2630 },
  25: { floor: 2290, ceil: 3020 },
  26: { floor: 2630, ceil: 3470 },
  27: { floor: 3020, ceil: 3990 },
  28: { floor: 3470, ceil: 4590 },
  29: { floor: 3990, ceil: 5280 },
  30: { floor: 4590, ceil: 6070 },
  31: { floor: 5050, ceil: 6680 },
  32: { floor: 5560, ceil: 7350 },
  33: { floor: 6120, ceil: 8090 },
  // Ceiling interpolated from L33/L35; the wiki's 5,900 looks like a typo.
  34: { floor: 6730, ceil: 8940 },
  35: { floor: 7400, ceil: 9790 },
  36: { floor: 8140, ceil: 10770 },
  37: { floor: 8950, ceil: 11850 },
  38: { floor: 9850, ceil: 13040 },
  39: { floor: 10840, ceil: 14340 },
  40: { floor: 11924, ceil: 15774 },
  41: { floor: 12510, ceil: 16540 },
  42: { floor: 13110, ceil: 17330 },
  43: { floor: 13720, ceil: 18140 },
  44: { floor: 14340, ceil: 18960 },
  45: { floor: 14980, ceil: 19800 },
  46: { floor: 15630, ceil: 20660 },
  47: { floor: 16300, ceil: 21540 },
  48: { floor: 16980, ceil: 22440 },
  49: { floor: 17670, ceil: 23360 },
  50: { floor: 18380, ceil: 24290 },
  51: { floor: 19100, ceil: 25240 },
  52: { floor: 19830, ceil: 26210 },
  53: { floor: 20580, ceil: 27200 },
  54: { floor: 21340, ceil: 28210 },
  55: { floor: 22120, ceil: 29240 },
  56: { floor: 22910, ceil: 30280 },
  57: { floor: 23710, ceil: 31340 },
  58: { floor: 24530, ceil: 32420 },
  59: { floor: 25360, ceil: 33520 },
  60: { floor: 26210, ceil: 34640 }
}

export const MIN_KNOWN_GUILD_LEVEL = 1
export const MAX_KNOWN_GUILD_LEVEL = 60

export const BOMB_DAMAGE_FLOOR_DEFAULT = 13110
export const BOMB_DAMAGE_CEIL_DEFAULT = 17330

const normalizeGuildLevel = (
  level: number | null | undefined
): number | null => {
  if (typeof level !== 'number' || !Number.isFinite(level)) return null
  const rounded = Math.trunc(level)
  if (rounded < MIN_KNOWN_GUILD_LEVEL) return null
  if (rounded > MAX_KNOWN_GUILD_LEVEL) return MAX_KNOWN_GUILD_LEVEL
  return rounded
}

export const bombDamageRangeForGuildLevel = (
  level: number | null | undefined
): { floor: number; ceil: number } => {
  const normalized = normalizeGuildLevel(level)
  if (normalized === null) {
    return {
      floor: BOMB_DAMAGE_FLOOR_DEFAULT,
      ceil: BOMB_DAMAGE_CEIL_DEFAULT
    }
  }
  return (
    BOMB_DAMAGE_BY_GUILD_LEVEL[normalized] ?? {
      floor: BOMB_DAMAGE_FLOOR_DEFAULT,
      ceil: BOMB_DAMAGE_CEIL_DEFAULT
    }
  )
}

export const bombDamagePerBomb = (
  level: number | null | undefined,
  mode: BombCalculationMode
): number => {
  const { floor, ceil } = bombDamageRangeForGuildLevel(level)
  switch (mode) {
    case 'worst_case':
      return floor
    case 'best_case':
      return ceil
    case 'average':
      return Math.floor((floor + ceil) / 2)
  }
}

export const bombsNeededForKill = (
  currentHp: number,
  level: number | null | undefined = null,
  mode: BombCalculationMode = DEFAULT_BOMB_CALCULATION_MODE
): number => {
  if (currentHp <= 0) return 0
  const dmg = bombDamagePerBomb(level, mode)
  return Math.ceil(currentHp / dmg)
}

export interface BombScenarioBreakdown {
  worst_case: { bombs_needed: number; damage_per_bomb: number }
  average: { bombs_needed: number; damage_per_bomb: number }
  best_case: { bombs_needed: number; damage_per_bomb: number }
}

export const bombScenariosForHp = (
  currentHp: number,
  level: number | null | undefined
): BombScenarioBreakdown => {
  const make = (mode: BombCalculationMode) => ({
    bombs_needed: bombsNeededForKill(currentHp, level, mode),
    damage_per_bomb: bombDamagePerBomb(level, mode)
  })
  return {
    worst_case: make('worst_case'),
    average: make('average'),
    best_case: make('best_case')
  }
}

export const isBombCalculationMode = (
  value: unknown
): value is BombCalculationMode =>
  typeof value === 'string' &&
  (BOMB_CALCULATION_MODES as readonly string[]).includes(value)
