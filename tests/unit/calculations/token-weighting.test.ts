import { describe, expect, it } from 'vitest'
import {
  buildTokenRatioMapsFromStats,
  computeRatio,
  extractTokensSpent
} from '@tacticus/app-core/token-weighting'
import type { SeasonTokenStats } from '@tacticus/app-core/tokens.types'

const GUILD_STATS: SeasonTokenStats = {
  context: 'guild',
  guild_code: 'ABCD',
  season: 70,
  players: [
    {
      player_id: 'p-a',
      display_name: 'Alpha',
      tokens_spent: 18,
      tokens_possible: 18
    },
    {
      player_id: 'p-b',
      display_name: 'Bravo',
      tokens_spent: 9,
      tokens_possible: 18
    },
    {
      player_id: 'p-c',
      display_name: 'Charlie',
      tokens_possible: 8,
      ratio_spent: 0.25
    }
  ]
}

describe('buildTokenRatioMapsFromStats', () => {
  it('builds max and average maps including a ratio_spent-only fallback row', () => {
    const { max, average } = buildTokenRatioMapsFromStats(
      [GUILD_STATS],
      ['guild']
    )

    expect(max.get('p-a')).toBe(1)
    expect(max.get('p-b')).toBe(0.5)
    expect(max.get('p-c')).toBe(0)
    expect(max.get('alpha')).toBe(1)
    expect(max.get('charlie')).toBe(0)

    const averageSpent = 29 / 3
    expect(average.get('p-a')).toBe(1) // 18/avg > 1 => clamped to 1
    expect(average.get('p-b')).toBeCloseTo(9 / averageSpent, 10)
    expect(average.get('p-c')).toBeCloseTo(2 / averageSpent, 10)
  })

  it('reconstructs the fallback spent value as ratio_spent * tokens_possible', () => {
    expect(extractTokensSpent({ ratio_spent: 0.25, tokens_possible: 8 })).toBe(
      2
    )
    expect(
      extractTokensSpent({
        tokens_spent: 5,
        ratio_spent: 0.25,
        tokens_possible: 8
      })
    ).toBe(5)
    expect(extractTokensSpent({ ratio_spent: 1.5, tokens_possible: 10 })).toBe(
      10
    )
    expect(extractTokensSpent({ tokens_possible: 8 })).toBe(0)
    expect(extractTokensSpent(undefined)).toBe(0)
  })

  it('computeRatio reconstructs ratio = spent / possible and guards bad inputs', () => {
    expect(computeRatio(9, 18)).toBe(0.5)
    expect(computeRatio(18, 18)).toBe(1)
    expect(computeRatio(40, 18)).toBe(1)
    expect(computeRatio(5, 0)).toBe(0)
    expect(computeRatio(5, null)).toBe(0)
    expect(computeRatio(null, 18)).toBe(0)
  })

  it('drops rows whose context is not in the allowed set', () => {
    const clusterStats: SeasonTokenStats = {
      context: 'cluster',
      guild_code: 'ABCD',
      cluster_code: 'CL-1',
      season: 70,
      players: [
        {
          player_id: 'cluster-only',
          display_name: 'Zeta',
          tokens_spent: 10,
          tokens_possible: 10
        }
      ]
    }

    const { max, average } = buildTokenRatioMapsFromStats(
      [clusterStats, GUILD_STATS],
      ['guild']
    )

    expect(max.has('cluster-only')).toBe(false)
    expect(max.has('zeta')).toBe(false)
    expect(max.get('p-a')).toBe(1)

    const allowBoth = buildTokenRatioMapsFromStats(
      [clusterStats, GUILD_STATS],
      ['guild', 'cluster']
    )
    expect(allowBoth.max.get('cluster-only')).toBe(1)
  })
})
