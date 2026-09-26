import { describe, expect, it } from 'vitest'
import {
  aggregateByPlayer,
  summarizeGuild
} from '@/app/lib/boss-assignments/performance-leaderboard-aggregate'
import {
  getGuildTokenPerformance,
  type DamageRow
} from '@/app/lib/data/guild-token-performance'
import type { TokenPerformanceData } from '@/app/(dashboard)/guild-management/upcoming-assignments/types'

function entry(
  overrides: Partial<{
    playerId: string
    displayName: string
    score: number | null
    tier: string
    tokensSpent: number
    expectedTokens: number | null
    actualDamage: number
    expectedDamage: number | null
  }> = {}
) {
  const base = {
    score: null as number | null,
    tier: 'per_boss' as const,
    tokensSpent: 1,
    expectedTokens: 5,
    actualDamage: 0,
    expectedDamage: 0 as number | null,
    ...overrides
  }
  if (
    base.score === null &&
    base.expectedDamage !== null &&
    base.expectedDamage > 0
  ) {
    base.score = base.actualDamage / base.expectedDamage
  }
  return base as unknown as TokenPerformanceData[string][string]
}

describe('aggregateByPlayer — tokens-weighted mean (matches Battle-Weighted pattern)', () => {
  it('returns weightedScore = 1.0 when actual == expected on every boss', () => {
    const data: TokenPerformanceData = {
      alice: {
        BossA: entry({
          tokensSpent: 2,
          actualDamage: 200,
          expectedTokens: 5,
          expectedDamage: 200
        }),
        BossB: entry({
          tokensSpent: 3,
          actualDamage: 600,
          expectedTokens: 10,
          expectedDamage: 600
        })
      }
    }
    const [row] = aggregateByPlayer(data)
    expect(row.weightedScore).toBe(1)
    expect(row.tokensSpent).toBe(5)
    expect(row.bossCount).toBe(2)
    expect(row.expectedTokens).toBe(15)
  })

  it('weights per-boss scores by tokens-on-that-boss (Steps 3+4 of the battle-weighted pattern)', () => {
    const data: TokenPerformanceData = {
      alice: {
        Boss1: entry({
          tokensSpent: 3,
          actualDamage: 360,
          expectedDamage: 300
        }), // score 1.20
        Boss2: entry({ tokensSpent: 2, actualDamage: 220, expectedDamage: 200 }) // score 1.10
      }
    }
    const [row] = aggregateByPlayer(data)
    expect(row.weightedScore).toBeCloseTo(1.16)
  })

  it('does NOT use pure ratio-of-totals (would drown out small bosses)', () => {
    // Tokens-weighted mean 1.75, not ratio-of-totals ≈ 1.333.
    const data: TokenPerformanceData = {
      alice: {
        BossA: entry({
          tokensSpent: 1,
          actualDamage: 100,
          expectedDamage: 200
        }),
        BossB: entry({ tokensSpent: 1, actualDamage: 300, expectedDamage: 100 })
      }
    }
    const [row] = aggregateByPlayer(data)
    expect(row.weightedScore).toBeCloseTo(1.75)
    expect(row.weightedScore).not.toBeCloseTo(400 / 300)
  })

  it('tiny prime contribution is preserved alongside big Mythic', () => {
    const data: TokenPerformanceData = {
      alice: {
        BigMythic: entry({
          tokensSpent: 3,
          actualDamage: 40_000_000,
          expectedDamage: 50_000_000
        }),
        TinyPrime: entry({
          tokensSpent: 1,
          actualDamage: 600_000,
          expectedDamage: 500_000
        })
      }
    }
    const [row] = aggregateByPlayer(data)
    expect(row.weightedScore).toBeCloseTo(0.9)
  })

  it('excludes null-expectedDamage bosses from the weighted mean but still counts tokens/bosses', () => {
    const data: TokenPerformanceData = {
      alice: {
        BossA: entry({
          tokensSpent: 2,
          actualDamage: 300,
          expectedDamage: 200
        }), // score 1.5
        BossB: entry({
          tokensSpent: 1,
          actualDamage: 50,
          expectedDamage: null,
          expectedTokens: null,
          tier: 'insufficient'
        })
      }
    }
    const [row] = aggregateByPlayer(data)
    expect(row.bossCount).toBe(2)
    expect(row.scoredBossCount).toBe(1) // BossA contributed, BossB dropped
    expect(row.tokensSpent).toBe(3)
    expect(row.weightedScore).toBeCloseTo(1.5) // (1.5×2)/2 = 1.5
  })

  it('scoredBossCount equals bossCount when every boss has valid expectedDamage', () => {
    const data: TokenPerformanceData = {
      alice: {
        BossA: entry({
          tokensSpent: 1,
          actualDamage: 100,
          expectedDamage: 100
        }),
        BossB: entry({
          tokensSpent: 2,
          actualDamage: 200,
          expectedDamage: 200
        }),
        BossC: entry({ tokensSpent: 3, actualDamage: 300, expectedDamage: 300 })
      }
    }
    const [row] = aggregateByPlayer(data)
    expect(row.bossCount).toBe(3)
    expect(row.scoredBossCount).toBe(3)
  })

  it('scoredBossCount is 0 when every boss lacks expectedDamage (all insufficient tier)', () => {
    const data: TokenPerformanceData = {
      alice: {
        BossA: entry({
          tokensSpent: 1,
          actualDamage: 100,
          expectedDamage: null,
          expectedTokens: null,
          tier: 'insufficient'
        }),
        BossB: entry({
          tokensSpent: 2,
          actualDamage: 200,
          expectedDamage: null,
          expectedTokens: null,
          tier: 'insufficient'
        })
      }
    }
    const [row] = aggregateByPlayer(data)
    expect(row.bossCount).toBe(2)
    expect(row.scoredBossCount).toBe(0)
    expect(row.weightedScore).toBeNull()
  })

  it('returns weightedScore = null when every boss has null expectedDamage', () => {
    const data: TokenPerformanceData = {
      alice: {
        BossA: entry({
          tokensSpent: 2,
          actualDamage: 300,
          expectedDamage: null,
          expectedTokens: null,
          tier: 'insufficient'
        })
      }
    }
    const [row] = aggregateByPlayer(data)
    expect(row.weightedScore).toBeNull()
    expect(row.bossCount).toBe(1)
  })

  it('skips entries with tokensSpent=0 entirely', () => {
    const data: TokenPerformanceData = {
      alice: {
        BossA: entry({ tokensSpent: 0, actualDamage: 0, expectedDamage: 200 }),
        BossB: entry({ tokensSpent: 2, actualDamage: 300, expectedDamage: 200 })
      }
    }
    const [row] = aggregateByPlayer(data)
    expect(row.bossCount).toBe(1)
    expect(row.weightedScore).toBeCloseTo(1.5)
  })

  it('tracks tierCounts per player', () => {
    const data: TokenPerformanceData = {
      alice: {
        BossA: entry({
          tokensSpent: 1,
          actualDamage: 100,
          expectedDamage: 100,
          tier: 'per_boss'
        }),
        BossB: entry({
          tokensSpent: 1,
          actualDamage: 100,
          expectedDamage: 100,
          tier: 'per_boss'
        }),
        BossC: entry({
          tokensSpent: 1,
          actualDamage: 100,
          expectedDamage: 100,
          tier: 'rarity_set_guild'
        })
      }
    }
    const [row] = aggregateByPlayer(data)
    expect(row.tierCounts).toEqual({ per_boss: 2, rarity_set_guild: 1 })
  })

  it('uses playerId metadata as the stable aggregate key while rendering displayName', () => {
    const data: TokenPerformanceData = {
      'player-1': {
        BossA: entry({
          playerId: 'player-1',
          displayName: 'LatestName',
          tokensSpent: 1,
          actualDamage: 100,
          expectedDamage: 100
        })
      }
    }

    const [row] = aggregateByPlayer(data)

    expect(row.playerKey).toBe('player-1')
    expect(row.playerId).toBe('player-1')
    expect(row.playerName).toBe('LatestName')
    expect(row.weightedScore).toBe(1)
  })

  it('does not merge duplicate display names that have different stable player IDs', () => {
    const data: TokenPerformanceData = {
      'player-a': {
        BossA: entry({
          playerId: 'player-a',
          displayName: 'Twin',
          tokensSpent: 1,
          actualDamage: 100,
          expectedDamage: 100
        })
      },
      'player-b': {
        BossA: entry({
          playerId: 'player-b',
          displayName: 'Twin',
          tokensSpent: 1,
          actualDamage: 150,
          expectedDamage: 100
        })
      }
    }

    const rows = aggregateByPlayer(data)

    expect(rows).toHaveLength(2)
    expect(rows.map((row) => row.playerKey).sort()).toEqual([
      'player-a',
      'player-b'
    ])
    expect(rows.map((row) => row.playerName)).toEqual(['Twin', 'Twin'])
  })
})

describe('getGuildTokenPerformance historical player identity', () => {
  const baseRow = {
    Name: 'BossA',
    set: 0,
    remainingHp: 1,
    maxHp: 1000,
    Season: '1',
    rarity: 'Legendary',
    loopIndex: 0
  } satisfies Partial<DamageRow>

  it('keeps departed season participants only when historical players are requested', async () => {
    const damageData = [
      {
        ...baseRow,
        displayName: 'Current',
        userId: 'current-id',
        damageDealt: 100
      },
      {
        ...baseRow,
        displayName: 'Departed',
        userId: 'departed-id',
        damageDealt: 200
      }
    ] as DamageRow[]

    const rosterOnly = await getGuildTokenPerformance('GUILD', {
      seasonOverride: '1',
      prefetched: {
        damageData,
        mostRecentSeasonPerBoss: { BossA: '1' },
        bossHpData: { byBossName: { BossA_L1: 1000 } },
        activeCurrentPlayers: new Set(['current']),
        officerTargetsByBossKey: {}
      }
    })

    expect(Object.keys(rosterOnly)).toEqual(['Current'])

    const historical = await getGuildTokenPerformance('GUILD', {
      seasonOverride: '1',
      includeHistoricalPlayers: true,
      prefetched: {
        damageData,
        mostRecentSeasonPerBoss: { BossA: '1' },
        bossHpData: { byBossName: { BossA_L1: 1000 } },
        officerTargetsByBossKey: {}
      }
    })

    expect(Object.keys(historical).sort()).toEqual([
      'current-id',
      'departed-id'
    ])
    expect(historical['departed-id']?.BossA_L1?.displayName).toBe('Departed')
    expect(historical['departed-id']?.BossA_L1?.playerId).toBe('departed-id')
  })

  it('collapses name changes by userId and keeps the latest scoped display name', async () => {
    const damageData = [
      {
        ...baseRow,
        displayName: 'NewName',
        userId: 'stable-id',
        damageDealt: 120
      },
      {
        ...baseRow,
        displayName: 'OldName',
        userId: 'stable-id',
        damageDealt: 180
      }
    ] as DamageRow[]

    const historical = await getGuildTokenPerformance('GUILD', {
      seasonOverride: '1',
      includeHistoricalPlayers: true,
      prefetched: {
        damageData,
        mostRecentSeasonPerBoss: { BossA: '1' },
        bossHpData: { byBossName: { BossA_L1: 1000 } },
        officerTargetsByBossKey: {}
      }
    })

    expect(Object.keys(historical)).toEqual(['stable-id'])
    expect(historical['stable-id']?.BossA_L1?.displayName).toBe('NewName')
    expect(historical['stable-id']?.BossA_L1?.tokensSpent).toBe(2)
  })

  it('does not merge duplicate display names when historical rows have different userIds', async () => {
    const damageData = [
      {
        ...baseRow,
        displayName: 'Twin',
        userId: 'player-a',
        damageDealt: 100
      },
      {
        ...baseRow,
        displayName: 'Twin',
        userId: 'player-b',
        damageDealt: 200
      }
    ] as DamageRow[]

    const historical = await getGuildTokenPerformance('GUILD', {
      seasonOverride: '1',
      includeHistoricalPlayers: true,
      prefetched: {
        damageData,
        mostRecentSeasonPerBoss: { BossA: '1' },
        bossHpData: { byBossName: { BossA_L1: 1000 } },
        officerTargetsByBossKey: {}
      }
    })

    expect(Object.keys(historical).sort()).toEqual(['player-a', 'player-b'])
    expect(historical['player-a']?.BossA_L1?.displayName).toBe('Twin')
    expect(historical['player-b']?.BossA_L1?.displayName).toBe('Twin')
  })

  it('preserves reserved display names without mutating Object.prototype', async () => {
    const bossKey = 'PrototypeBoss_L1'
    expect(Object.prototype).not.toHaveProperty(bossKey)

    const result = await getGuildTokenPerformance('GUILD', {
      seasonOverride: '1',
      prefetched: {
        damageData: [
          {
            ...baseRow,
            displayName: '__proto__',
            Name: 'PrototypeBoss',
            damageDealt: 200
          }
        ] as DamageRow[],
        mostRecentSeasonPerBoss: { PrototypeBoss: '1' },
        bossHpData: { byBossName: { [bossKey]: 1000 } },
        activeCurrentPlayers: new Set(['__proto__']),
        officerTargetsByBossKey: {}
      }
    })

    expect(Object.hasOwn(result, '__proto__')).toBe(true)
    expect(result.__proto__?.[bossKey]?.actualDamage).toBe(200)
    expect(Object.prototype).not.toHaveProperty(bossKey)
  })

  it('requires a sweep to clear both the guild and player non-sweep averages', async () => {
    const damageData = [
      {
        ...baseRow,
        displayName: 'Strong',
        Name: 'SweepBoss',
        damageDealt: 200
      },
      {
        ...baseRow,
        displayName: 'Weak',
        Name: 'SweepBoss',
        damageDealt: 100
      },
      {
        ...baseRow,
        displayName: 'Strong',
        Name: 'SweepBoss',
        damageDealt: 175,
        remainingHp: 0,
        maxHp: 1000,
        loopIndex: 1
      }
    ] as DamageRow[]

    const result = await getGuildTokenPerformance('GUILD', {
      seasonOverride: '1',
      includePerLoop: true,
      prefetched: {
        damageData,
        mostRecentSeasonPerBoss: { SweepBoss: '1' },
        bossHpData: { byBossName: { SweepBoss_L1: 1000 } },
        activeCurrentPlayers: new Set(['strong', 'weak']),
        officerTargetsByBossKey: {}
      }
    })

    expect(result.Strong?.SweepBoss_L1?.tokensSpent).toBe(1)
    expect(result.Strong?.SweepBoss_L1?.actualDamage).toBe(200)
    expect(result.Strong?.SweepBoss_L1?.perLoop).not.toHaveProperty('1')
  })

  it('treats a legacy null remainingHp row as non-sweep in both baseline and player totals', async () => {
    const damageData = [
      {
        ...baseRow,
        displayName: 'Legacy',
        Name: 'LegacyBoss',
        damageDealt: 100,
        remainingHp: null
      },
      {
        ...baseRow,
        displayName: 'Current',
        Name: 'LegacyBoss',
        damageDealt: 300
      }
    ] as DamageRow[]

    const result = await getGuildTokenPerformance('GUILD', {
      seasonOverride: '1',
      prefetched: {
        damageData,
        mostRecentSeasonPerBoss: { LegacyBoss: '1' },
        bossHpData: { byBossName: { LegacyBoss_L1: 1000 } },
        activeCurrentPlayers: new Set(['legacy', 'current']),
        officerTargetsByBossKey: {}
      }
    })

    expect(result.Legacy?.LegacyBoss_L1).toMatchObject({
      tokensSpent: 1,
      actualDamage: 100,
      expectedDamage: 200
    })
  })
})

describe('summarizeGuild', () => {
  it('returns all null stats when no player has a score', () => {
    const summary = summarizeGuild([
      {
        playerName: 'a',
        bossCount: 1,
        scoredBossCount: 0,
        tokensSpent: 1,
        expectedTokens: 5,
        weightedScore: null,
        tierCounts: {}
      }
    ])
    expect(summary.playerCount).toBe(1)
    expect(summary.mean).toBeNull()
    expect(summary.median).toBeNull()
    expect(summary.pctAtOrAbove).toBeNull()
  })

  it('computes mean, median, and % at or above 1.0', () => {
    const summary = summarizeGuild([
      {
        playerName: 'a',
        bossCount: 1,
        scoredBossCount: 1,
        tokensSpent: 1,
        expectedTokens: 5,
        weightedScore: 0.5,
        tierCounts: {}
      },
      {
        playerName: 'b',
        bossCount: 1,
        scoredBossCount: 1,
        tokensSpent: 1,
        expectedTokens: 5,
        weightedScore: 1.0,
        tierCounts: {}
      },
      {
        playerName: 'c',
        bossCount: 1,
        scoredBossCount: 1,
        tokensSpent: 1,
        expectedTokens: 5,
        weightedScore: 1.5,
        tierCounts: {}
      }
    ])
    expect(summary.mean).toBeCloseTo(1.0)
    expect(summary.median).toBeCloseTo(1.0)
    expect(summary.pctAtOrAbove).toBeCloseTo((2 / 3) * 100)
  })

  it('computes median correctly for even-count lists', () => {
    const summary = summarizeGuild([
      {
        playerName: 'a',
        bossCount: 1,
        scoredBossCount: 1,
        tokensSpent: 1,
        expectedTokens: 5,
        weightedScore: 0.5,
        tierCounts: {}
      },
      {
        playerName: 'b',
        bossCount: 1,
        scoredBossCount: 1,
        tokensSpent: 1,
        expectedTokens: 5,
        weightedScore: 2.5,
        tierCounts: {}
      }
    ])
    expect(summary.median).toBeCloseTo(1.5)
  })

  it('skips null-scored players in mean/median but counts them in playerCount', () => {
    const summary = summarizeGuild([
      {
        playerName: 'a',
        bossCount: 1,
        scoredBossCount: 1,
        tokensSpent: 1,
        expectedTokens: 5,
        weightedScore: 2.0,
        tierCounts: {}
      },
      {
        playerName: 'b',
        bossCount: 1,
        scoredBossCount: 1,
        tokensSpent: 1,
        expectedTokens: 5,
        weightedScore: null,
        tierCounts: {}
      }
    ])
    expect(summary.playerCount).toBe(2)
    expect(summary.mean).toBeCloseTo(2.0)
  })
})
