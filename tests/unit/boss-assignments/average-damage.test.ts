import { describe, expect, it } from 'vitest'
import {
  buildBossAssignmentAverageDamageMap,
  type BossAssignmentDamageRow
} from '@/app/(dashboard)/boss-assignments/_lib/average-damage'

const row = (
  overrides: Partial<BossAssignmentDamageRow> = {}
): BossAssignmentDamageRow => ({
  displayName: 'Alice',
  Name: 'Magnus',
  set: 3,
  damageDealt: 400,
  remainingHp: 600,
  maxHp: 1000,
  Season: '85',
  rarity: 'Legendary',
  ...overrides
})

describe('buildBossAssignmentAverageDamageMap', () => {
  it('keeps full-HP one-shots in both the reference baseline and player numerator', () => {
    const averages = buildBossAssignmentAverageDamageMap(
      [
        row({
          displayName: 'Bob',
          damageDealt: 1000,
          remainingHp: 0,
          maxHp: 1000
        }),
        // Bob's one-shot forms the 1000 baseline, so Alice's lone sweep qualifies.
        row({ damageDealt: 1200, remainingHp: 0, maxHp: 2000 })
      ],
      '85'
    )

    expect(averages.Bob?.Magnus_L4).toEqual({
      total: 1000,
      count: 1,
      average: 1000
    })
    expect(averages.Alice?.Magnus_L4).toEqual({
      total: 1200,
      count: 1,
      average: 1200
    })
  })

  it('adds qualifying sweeps only to player numerators, never the reference baseline', () => {
    const averages = buildBossAssignmentAverageDamageMap(
      [
        row({ damageDealt: 400 }),
        row({ displayName: 'Bob', damageDealt: 200 }),
        row({ damageDealt: 350, remainingHp: 0, maxHp: 1000 }),
        row({ damageDealt: 500, remainingHp: 0, maxHp: 1000 })
      ],
      '85'
    )

    expect(averages.Alice?.Magnus_L4).toEqual({
      total: 900,
      count: 2,
      average: 450
    })
    expect(averages.Bob?.Magnus_L4.average).toBe(200)
  })

  it('drops only-ever-sweep rows that cannot clear a sweep-free reference', () => {
    const averages = buildBossAssignmentAverageDamageMap(
      [
        row({ displayName: 'Bob', damageDealt: 500 }),
        row({ damageDealt: 100, remainingHp: 0, maxHp: 1000 })
      ],
      '85'
    )

    expect(averages.Alice).toBeUndefined()
    expect(averages.Bob?.Magnus_L4.average).toBe(500)
  })

  it('keeps seasons and boss difficulty baselines isolated', () => {
    const averages = buildBossAssignmentAverageDamageMap(
      [
        row({ damageDealt: 400 }),
        row({ damageDealt: 900, Season: '84' }),
        row({ Name: 'Rogal Dorn', rarity: 'Mythic', set: 1, damageDealt: 800 })
      ],
      '85'
    )

    expect(averages.Alice?.Magnus_L4.average).toBe(400)
    expect(averages.Alice?.['Rogal Dorn_M2'].average).toBe(800)
  })

  it('materializes reserved player names without prototype pollution', () => {
    const bossKey = 'Magnus_L4'
    expect(Object.hasOwn(Object.prototype, bossKey)).toBe(false)

    const averages = buildBossAssignmentAverageDamageMap(
      [row({ displayName: '__proto__' })],
      '85'
    )

    expect(Object.hasOwn(averages, '__proto__')).toBe(true)
    expect(averages['__proto__']?.[bossKey]).toEqual({
      total: 400,
      count: 1,
      average: 400
    })
    expect(Object.hasOwn(Object.prototype, bossKey)).toBe(false)
    expect(({} as Record<string, unknown>)[bossKey]).toBeUndefined()
  })
})
