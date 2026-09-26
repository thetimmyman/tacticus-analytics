import { describe, expect, it } from 'vitest'
import {
  buildStageAssignmentTokenMap,
  normalizeAssignmentReasons,
  normalizeBossTargetId,
  normalizePlayerTokenAllocations,
  normalizeTokenAllocationRecord
} from '@/app/lib/boss-assignments/target-ids'

describe('normalizeBossTargetId', () => {
  it('converts solver stage ids into canonical encounter target ids', () => {
    expect(normalizeBossTargetId('L4_main')).toBe('L4')
    expect(normalizeBossTargetId('L4_prime1')).toBe('L4_Sub1')
    expect(normalizeBossTargetId('M2_prime2')).toBe('M2_Sub2')
  })

  it('leaves canonical ids unchanged', () => {
    expect(normalizeBossTargetId('L5')).toBe('L5')
    expect(normalizeBossTargetId('L5_Sub1')).toBe('L5_Sub1')
  })
})

describe('normalizeTokenAllocationRecord', () => {
  it('merges canonical and solver ids into one allocation map', () => {
    expect(
      normalizeTokenAllocationRecord({
        L4: 1,
        L4_main: 2,
        L4_prime1: 1,
        L4_Sub1: 1
      })
    ).toEqual({
      L4: 3,
      L4_Sub1: 2
    })
  })

  it('preserves reserved target ids as own serializable properties', () => {
    const normalized = normalizeTokenAllocationRecord(
      Object.fromEntries([
        ['__proto__', 2],
        ['constructor', 1]
      ])
    )

    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype)
    expect(Object.hasOwn(normalized, '__proto__')).toBe(true)
    expect(Object.hasOwn(normalized, 'constructor')).toBe(true)
    expect(normalized['__proto__']).toBe(2)
    expect(normalized['constructor']).toBe(1)
  })
})

describe('normalizePlayerTokenAllocations', () => {
  it('normalizes each player bucket independently', () => {
    expect(
      normalizePlayerTokenAllocations({
        OfficerOne: { M1_main: 3 },
        Roy: { M1_prime2: 1, M1_Sub2: 1 }
      })
    ).toEqual({
      OfficerOne: { M1: 3 },
      Roy: { M1_Sub2: 2 }
    })
  })

  it('preserves reserved player names without changing object prototypes', () => {
    const normalized = normalizePlayerTokenAllocations(
      Object.fromEntries([
        ['__proto__', { L4_main: 2 }],
        ['constructor', { L4_prime1: 1 }]
      ])
    )

    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype)
    expect(Object.hasOwn(normalized, '__proto__')).toBe(true)
    expect(Object.hasOwn(normalized, 'constructor')).toBe(true)
    expect(normalized['__proto__']).toEqual({ L4: 2 })
    expect(normalized['constructor']).toEqual({ L4_Sub1: 1 })
  })
})

describe('normalizeAssignmentReasons', () => {
  it('preserves reserved player names and target ids as own properties', () => {
    const normalized = normalizeAssignmentReasons(
      Object.fromEntries([
        [
          '__proto__',
          Object.fromEntries([
            ['__proto__', 'Hold for the final hit'],
            ['constructor', 'Use the cleanup token']
          ])
        ]
      ])
    )

    expect(Object.getPrototypeOf(normalized)).toBe(Object.prototype)
    expect(Object.hasOwn(normalized, '__proto__')).toBe(true)
    const reasons = normalized['__proto__']
    expect(Object.getPrototypeOf(reasons)).toBe(Object.prototype)
    expect(Object.hasOwn(reasons, '__proto__')).toBe(true)
    expect(Object.hasOwn(reasons, 'constructor')).toBe(true)
    expect(reasons['__proto__']).toBe('Hold for the final hit')
    expect(reasons['constructor']).toBe('Use the cleanup token')
  })
})

describe('buildStageAssignmentTokenMap', () => {
  it('aggregates only the matching stage and loop using canonical target ids', () => {
    const tokenMap = buildStageAssignmentTokenMap(
      [
        {
          stageCode: 'M1',
          loopIndex: 0,
          assignments: [
            { playerId: 'p1', bossId: 'M1_main', tokens: 2 },
            { playerId: 'p1', bossId: 'M1_prime1', tokens: 1 },
            { playerId: 'p2', bossId: 'M1_prime2', tokens: 1 }
          ]
        },
        {
          stageCode: 'M2',
          loopIndex: 0,
          assignments: [{ playerId: 'p1', bossId: 'M2_main', tokens: 3 }]
        }
      ],
      'M1',
      0
    )

    expect(Array.from(tokenMap.entries())).toEqual([
      ['p1:M1', 2],
      ['p1:M1_Sub1', 1],
      ['p2:M1_Sub2', 1]
    ])
  })
})
