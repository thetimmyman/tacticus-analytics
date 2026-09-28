import { describe, expect, it } from 'vitest'
import {
  BOMB_CALCULATION_MODES,
  BOMB_DAMAGE_BY_GUILD_LEVEL,
  BOMB_DAMAGE_CEIL_DEFAULT,
  BOMB_DAMAGE_FLOOR_DEFAULT,
  bombDamagePerBomb,
  bombDamageRangeForGuildLevel,
  bombsNeededForKill,
  bombScenariosForHp,
  DEFAULT_BOMB_CALCULATION_MODE,
  isBombCalculationMode,
  MAX_KNOWN_GUILD_LEVEL,
  MIN_KNOWN_GUILD_LEVEL
} from '@/app/lib/tacticus/bomb-damage'

describe('bombDamageRangeForGuildLevel', () => {
  it('returns the wiki range for a known level', () => {
    expect(bombDamageRangeForGuildLevel(42)).toEqual({
      floor: 13110,
      ceil: 17330
    })
    expect(bombDamageRangeForGuildLevel(1)).toEqual({ floor: 80, ceil: 100 })
  })

  it('falls back to default when level is unknown', () => {
    expect(bombDamageRangeForGuildLevel(null)).toEqual({
      floor: BOMB_DAMAGE_FLOOR_DEFAULT,
      ceil: BOMB_DAMAGE_CEIL_DEFAULT
    })
    expect(bombDamageRangeForGuildLevel(undefined)).toEqual({
      floor: BOMB_DAMAGE_FLOOR_DEFAULT,
      ceil: BOMB_DAMAGE_CEIL_DEFAULT
    })
    expect(bombDamageRangeForGuildLevel(0)).toEqual({
      floor: BOMB_DAMAGE_FLOOR_DEFAULT,
      ceil: BOMB_DAMAGE_CEIL_DEFAULT
    })
  })

  it('clamps above MAX_KNOWN_GUILD_LEVEL to the top row', () => {
    expect(bombDamageRangeForGuildLevel(MAX_KNOWN_GUILD_LEVEL + 50)).toEqual(
      BOMB_DAMAGE_BY_GUILD_LEVEL[MAX_KNOWN_GUILD_LEVEL]
    )
  })

  it('every entry has floor < ceil (wiki typo flagged for L34 is corrected)', () => {
    for (let l = MIN_KNOWN_GUILD_LEVEL; l <= MAX_KNOWN_GUILD_LEVEL; l += 1) {
      const row = BOMB_DAMAGE_BY_GUILD_LEVEL[l]
      expect(row.floor, `L${l} floor < ceil`).toBeLessThan(row.ceil)
    }
  })
})

describe('bombDamagePerBomb', () => {
  it('picks floor / midpoint / ceil per mode', () => {
    expect(bombDamagePerBomb(42, 'worst_case')).toBe(13110)
    expect(bombDamagePerBomb(42, 'best_case')).toBe(17330)
    expect(bombDamagePerBomb(42, 'average')).toBe(
      Math.floor((13110 + 17330) / 2)
    )
  })
})

describe('bombsNeededForKill', () => {
  it('returns 0 for non-positive HP', () => {
    expect(bombsNeededForKill(0, 42, 'worst_case')).toBe(0)
    expect(bombsNeededForKill(-100, 42, 'worst_case')).toBe(0)
  })

  it('uses default level/mode when omitted (preserves legacy behavior)', () => {
    expect(bombsNeededForKill(52_440)).toBe(4)
    expect(bombsNeededForKill(52_441)).toBe(5)
  })

  it('scales fewer bombs needed in best-case mode at the same level', () => {
    const hp = 50_000
    const worst = bombsNeededForKill(hp, 42, 'worst_case')
    const best = bombsNeededForKill(hp, 42, 'best_case')
    expect(best).toBeLessThan(worst)
  })

  it('scales fewer bombs needed at a higher level (same HP, same mode)', () => {
    const hp = 100_000
    const lowLevel = bombsNeededForKill(hp, 30, 'worst_case')
    const highLevel = bombsNeededForKill(hp, 60, 'worst_case')
    expect(highLevel).toBeLessThan(lowLevel)
  })
})

describe('bombScenariosForHp', () => {
  it('returns all three scenarios with monotonic bomb counts', () => {
    const scenarios = bombScenariosForHp(50_000, 42)
    expect(scenarios.worst_case.damage_per_bomb).toBe(13110)
    expect(scenarios.best_case.damage_per_bomb).toBe(17330)
    expect(scenarios.worst_case.bombs_needed).toBeGreaterThanOrEqual(
      scenarios.average.bombs_needed
    )
    expect(scenarios.average.bombs_needed).toBeGreaterThanOrEqual(
      scenarios.best_case.bombs_needed
    )
  })
})

describe('isBombCalculationMode', () => {
  it('accepts all three mode names', () => {
    for (const mode of BOMB_CALCULATION_MODES) {
      expect(isBombCalculationMode(mode)).toBe(true)
    }
  })
  it('rejects unrelated values', () => {
    expect(isBombCalculationMode('')).toBe(false)
    expect(isBombCalculationMode('foo')).toBe(false)
    expect(isBombCalculationMode(null)).toBe(false)
    expect(isBombCalculationMode(42)).toBe(false)
  })
})

describe('module defaults', () => {
  it('default mode is worst_case (compatibility)', () => {
    expect(DEFAULT_BOMB_CALCULATION_MODE).toBe('worst_case')
  })
})
