import { describe, expect, it } from 'vitest'

import {
  buildBossPerformanceSummaries,
  buildDashboardLoopAggregates,
  buildDamageLoopModel,
  buildLoopTokenData,
  buildLoopTokenDataBySet,
  buildPrimePerformanceSummaries
} from '@/app/components/dashboard-summary/model'

describe('dashboard summary model', () => {
  const performance = [
    {
      bossName: 'Boss',
      rarity: 'Legendary',
      set: 2,
      encounterId: 0,
      avgDamage: 100,
      maxDamage: 200,
      hitCount: 3
    },
    {
      primeName: 'Prime',
      rarity: 'Legendary',
      set: 2,
      encounterId: 1,
      avgDamage: 50,
      maxDamage: 75,
      hitCount: 2
    }
  ]

  it('separates main and prime encounters with cluster comparisons', () => {
    expect(
      buildBossPerformanceSummaries(performance, [
        {
          boss_name: 'Boss',
          rarity: 'Legendary',
          set: 2,
          encounter_type: 'Boss',
          vs_cluster_percent: 12
        }
      ])
    ).toEqual([
      expect.objectContaining({ boss: 'Boss', level: 3, vsClusterPercent: 12 })
    ])
    expect(
      buildPrimePerformanceSummaries(performance, [
        {
          prime_name: 'Prime',
          rarity: 'Legendary',
          set: 2,
          vs_cluster_percent: -4
        }
      ])
    ).toEqual([
      expect.objectContaining({
        prime: 'Prime',
        encounterId: 1,
        vsClusterPercent: -4
      })
    ])
  })

  it('normalizes sparse two-step and zero-based loop payloads', () => {
    const model = buildDamageLoopModel({
      data: [
        { loop: 0, Boss: 10 },
        { loop: 2, Boss: 20 },
        { loop: 4, Boss: 30 }
      ],
      bosses: ['Boss', null],
      detailedData: [{ bossName: 'Boss', isPrime: false }]
    })

    expect(model.processed.map((entry) => entry.loop)).toEqual([1, 2, 3])
    expect(model.bosses).toEqual(['Boss'])
    expect(model.primeStatus.get('Boss')).toBe(false)
  })

  it('returns a stable empty model for malformed payloads', () => {
    expect(buildDamageLoopModel(null)).toEqual({
      processed: [],
      bosses: [],
      detailed: [],
      primeStatus: new Map()
    })
  })

  it('normalizes token loops and joins them to damage aggregates', () => {
    const tokens = buildLoopTokenData(
      {
        0: { bosses: 2, primes: 1, rarities: ['Legendary'] },
        2: { bosses: 3, primes: 0, rarities: ['Mythic'] }
      },
      2
    )
    expect(tokens.map((row) => [row.loop, row.actualLoop])).toEqual([
      [1, 0],
      [2, 1]
    ])

    const aggregates = buildDashboardLoopAggregates(
      [{ loop: 0, Boss: 100 }],
      ['Boss'],
      new Map([['Boss', false]]),
      tokens
    )
    expect(aggregates[0]).toMatchObject({
      loopIndex: 0,
      totalTokens: 3,
      avgDamagePerBoss: 100,
      trend: 'stable'
    })
  })

  it('builds stacked token data with ordered Legendary and Mythic levels', () => {
    expect(
      buildLoopTokenDataBySet({ 0: { total: 4, M1: 1, L2: 2, L1: 1 } }, 0)
    ).toEqual({
      levelKeys: ['L1', 'L2', 'M1'],
      chartData: [{ lap: 1, actualLoop: 0, total: 4, L1: 1, L2: 2, M1: 1 }]
    })
  })
})
