import { describe, it, expect } from 'vitest'
import {
  calculateBurnedTokens,
  calculateTotalStats,
  computeGuildMaxPossibleTokens,
  createEmptyTokensByRarity,
  formatShortDuration,
  parseAvailabilityRow,
  parseRpcTokenRow,
  processBattleData,
  processHistoricalData
} from '@/app/components/token-usage/utils'

describe('Token usage utils', () => {
  it('formats short durations across ranges', () => {
    expect(formatShortDuration(null)).toBeNull()
    expect(formatShortDuration(undefined)).toBeNull()
    expect(formatShortDuration(0)).toBe('0m')
    expect(formatShortDuration(3600)).toBe('1h')
    expect(formatShortDuration(5400)).toBe('1h 30m')
    expect(formatShortDuration(90000)).toBe('1d 1h')
  })

  it('calculates burned tokens as maxPossible - capped(available) - used', () => {
    expect(calculateBurnedTokens(0, 2, 1)).toBeNull()
    expect(calculateBurnedTokens(10, undefined, 1)).toBeNull()
    expect(calculateBurnedTokens(10, 3, 7)).toBe(0)
    expect(calculateBurnedTokens(10, 2, 5)).toBe(3)
    expect(calculateBurnedTokens(15, 5, 10)).toBe(2)
    expect(calculateBurnedTokens(5, 3, 10)).toBe(0)
    expect(calculateBurnedTokens(10, -1, 5)).toBe(5)
  })

  it('gives non-capped players fractional regen credit so a mid-cycle player is not over-counted', () => {
    // One token behind, partway through a regen cycle, floors to 0 burned (matching /token-overview).
    const SIX_HOURS = 6 * 60 * 60
    expect(calculateBurnedTokens(12, 1, 10)).toBe(1)
    expect(calculateBurnedTokens(12, 1, 10, SIX_HOURS)).toBe(0)
    // Regen is paused at the cap, so a capped player gets no credit.
    expect(calculateBurnedTokens(12, 3, 6, SIX_HOURS)).toBe(3)
    expect(calculateBurnedTokens(12, 0, 9, SIX_HOURS)).toBe(2)
    expect(calculateBurnedTokens(12, 1, 10, null)).toBe(1)
    expect(calculateBurnedTokens(12, 1, 10, 0)).toBe(1)
  })

  it('computes guild max possible tokens with hard cap', () => {
    expect(computeGuildMaxPossibleTokens([])).toBe(0)
    expect(
      computeGuildMaxPossibleTokens([
        { totalTokens: 14, tokensAvailable: 1 },
        { totalTokens: 13, tokensAvailable: 2 },
        { totalTokens: 12, tokensAvailable: 0 }
      ])
    ).toBe(15)
    expect(
      computeGuildMaxPossibleTokens([{ totalTokens: 10, tokensAvailable: 9 }])
    ).toBe(13)
    expect(
      computeGuildMaxPossibleTokens([{ totalTokens: 50, tokensAvailable: 3 }])
    ).toBe(28)
    expect(computeGuildMaxPossibleTokens([{ totalTokens: 7 }])).toBe(7)
  })

  it('parses RPC token rows and availability rows', () => {
    const parsed = parseRpcTokenRow({
      display_name: 'Alpha',
      tokens_used: 4,
      boss_tokens: 2,
      prime_tokens: 1,
      max_possible: 10,
      tokens_available: 3,
      token_next_in_seconds: 3600,
      bombs_available_live: 2,
      bomb_next_in_seconds: 1200,
      burned_tokens: 1,
      time_over_cap_seconds: 300
    })

    expect(parsed?.nameKey).toBe('ALPHA')
    expect(parsed?.data.tokens).toBe(4)
    expect(parsed?.data.tokensAvailable).toBe(3)
    expect(parsed?.data.bombsAvailable).toBe(2)
    expect(parsed?.data.tokenNextSeconds).toBe(3600)

    const availability = parseAvailabilityRow({
      display_name: 'Bravo',
      tokens_available: 1,
      token_next_in_seconds: null,
      bombs_available: 0,
      bomb_next_in_seconds: null,
      burned_tokens: 2,
      time_over_cap_seconds: 0
    })

    expect(availability?.nameKey).toBe('BRAVO')
    expect(availability?.data.tokensAvailable).toBe(1)
    expect(availability?.data.bombNextSeconds).toBeNull()

    expect(
      parseRpcTokenRow({
        display_name: '  ',
        tokens_used: 0,
        boss_tokens: 0,
        prime_tokens: 0,
        max_possible: 0
      })
    ).toBeNull()
  })

  it('processes historical data for five-season players', () => {
    const data = [
      { userId: 'u1', Season: 'S1' },
      { userId: 'u1', Season: 'S2' },
      { userId: 'u1', Season: 'S3' },
      { userId: 'u1', Season: 'S4' },
      { userId: 'u1', Season: 'S5' },
      { userId: 'u2', Season: 'S1' },
      { userId: 'u2', Season: 'S2' }
    ] as any

    const result = processHistoricalData(data)
    expect(result.u1).toBe(1)
    expect(result.u2).toBeUndefined()
  })

  it('aggregates battle data by player and boss', () => {
    const battleData = [
      {
        userId: 'u1',
        displayName: 'Alpha',
        damageDealt: 1200,
        loopIndex: 1,
        rarity: 'Rare',
        encounterId: 0,
        Name: 'BossA'
      },
      {
        userId: 'u1',
        displayName: 'Alpha',
        damageDealt: 800,
        loopIndex: 2,
        rarity: 'Mythic',
        encounterId: 2,
        Name: 'BossA'
      },
      {
        userId: 'u2',
        displayName: '',
        damageDealt: 500,
        loopIndex: 1,
        rarity: 'Common',
        encounterId: 0,
        Name: 'BossB'
      }
    ] as any

    const { playerStats, bossTokens, totalTokensUsed } =
      processBattleData(battleData)

    expect(totalTokensUsed).toBe(2)
    expect(playerStats.u1.tokens).toBe(2)
    expect(playerStats.u1.bossTokens).toBe(1)
    expect(playerStats.u1.primeTokens).toBe(1)
    expect(playerStats.u1.totalDamage).toBe(2000)
    expect(playerStats.u1.loops).toEqual(new Set([1, 2]))
    expect(playerStats.u1.tokensByRarity.rare).toBe(1)
    expect(playerStats.u1.tokensByRarity.mythic).toBe(1)
    expect(bossTokens.BossA).toBe(1)
    expect(bossTokens.Primes).toBe(1)
  })

  it('creates empty rarity buckets and totals stats', () => {
    expect(createEmptyTokensByRarity()).toEqual({
      common: 0,
      uncommon: 0,
      rare: 0,
      epic: 0,
      legendary: 0,
      mythic: 0
    })

    const players = [
      { totalTokens: 5, tokensAvailable: 3, bombsAvailable: 1 },
      { totalTokens: 2, tokensAvailable: 1, bombsAvailable: 0 }
    ]

    const rpcTotals = new Map([
      ['a', { tokens: 4 }],
      ['b', { tokens: 3 }]
    ])

    const totalsWithRpc = calculateTotalStats(players, rpcTotals as any, 10)
    expect(totalsWithRpc.totalTokens).toBe(7)
    expect(totalsWithRpc.maxTokens).toBe(5)
    expect(totalsWithRpc.averageUsage).toBe(3.5)
    expect(totalsWithRpc.tokensAvailableAvg).toBe(2)
    expect(totalsWithRpc.bombsAvailableCount).toBe(1)

    const totalsWithoutRpc = calculateTotalStats(players, new Map(), 10)
    expect(totalsWithoutRpc.totalTokens).toBe(10)
  })
})
