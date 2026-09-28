import { describe, expect, it } from 'vitest'
import type { TokenPerformanceData } from '@/app/lib/boss-assignments/token-performance-types'
import {
  materializeBossLevelTokenPerformance,
  qualifyBossLevelSweeps
} from './boss-level-token-performance'

describe('qualifyBossLevelSweeps', () => {
  it('drops an above-reference sweep that is below the player average', () => {
    const result = qualifyBossLevelSweeps({
      nonSweepDamage: 600,
      nonSweepCount: 1,
      sweepDamages: [400, 600, 700],
      referenceAvg: 300
    })

    expect(result).toEqual({
      adjustedDamage: 1900,
      adjustedCount: 3,
      qualifyingSweepIndices: [1, 2]
    })
  })

  it('keeps the reference average as the floor for a below-reference player', () => {
    expect(
      qualifyBossLevelSweeps({
        nonSweepDamage: 100,
        nonSweepCount: 1,
        sweepDamages: [150, 200],
        referenceAvg: 200
      })
    ).toEqual({
      adjustedDamage: 300,
      adjustedCount: 2,
      qualifyingSweepIndices: [1]
    })
  })

  it('cannot qualify sweeps without a positive reference baseline', () => {
    expect(
      qualifyBossLevelSweeps({
        nonSweepDamage: 0,
        nonSweepCount: 0,
        sweepDamages: [500],
        referenceAvg: 0
      })
    ).toEqual({
      adjustedDamage: 0,
      adjustedCount: 0,
      qualifyingSweepIndices: []
    })
  })
})

describe('materializeBossLevelTokenPerformance', () => {
  it('materializes reserved display names and encounter keys as own data properties', () => {
    const entry: TokenPerformanceData[string][string] = {
      score: 1,
      tier: 'per_boss',
      tokensSpent: 1,
      expectedTokens: 1,
      actualDamage: 100,
      expectedDamage: 100
    }
    const players = new Map<
      string,
      ReadonlyMap<string, TokenPerformanceData[string][string]>
    >([
      ['__proto__', new Map([['constructor', entry]])],
      ['constructor', new Map([['__proto__', entry]])]
    ])

    const result = materializeBossLevelTokenPerformance(players)

    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(Object.hasOwn(result, 'constructor')).toBe(true)
    expect(Object.hasOwn(result['__proto__']!, 'constructor')).toBe(true)
    expect(Object.hasOwn(result['constructor']!, '__proto__')).toBe(true)
    expect(({} as Record<string, unknown>)['tokensSpent']).toBeUndefined()
    expect(JSON.parse(JSON.stringify(result))).toEqual(result)
  })
})
