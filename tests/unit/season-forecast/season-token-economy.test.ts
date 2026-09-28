import { describe, it, expect } from 'vitest'
import {
  computeSeasonTokenAggregates,
  type PlayerTokenEconomyInput
} from '@/app/lib/season-forecast/season-token-economy'

const BASE = {
  regenToEnd: 20,
  daysRemaining: 10,
  rateWindowDays: 30,
  seasonMaxTokens: 28,
  regenPerDay: 2
}

describe('computeSeasonTokenAggregates', () => {
  it('caps each player at the season allowance and tallies the roster', () => {
    const players: PlayerTokenEconomyInput[] = [
      { bank: 2, usedThisSeason: 12, recentBattleCount: 90 }, // active (3/day)
      { bank: 3, usedThisSeason: 4, recentBattleCount: 0 }, // idle
      { bank: 1, usedThisSeason: 20, recentBattleCount: 15 } // slow (0.5/day)
    ]
    const out = computeSeasonTokenAggregates({ ...BASE, players })

    expect(out.memberCount).toBe(3)
    expect(out.tokensUsed).toBe(36) // 12 + 4 + 20
    expect(out.tokensRemaining).toBe(47)
    expect(out.projectedWaste).toBe(28)
    expect(out.playersAtCapRisk).toBe(2)
  })

  it('C1 regression: on-pace player measured over the REAL season window wastes ~0', () => {
    // Rate window = 6 days in; a 30-day denominator produced phantom waste.
    const out = computeSeasonTokenAggregates({
      players: [{ bank: 1, usedThisSeason: 12, recentBattleCount: 12 }],
      regenToEnd: 14,
      daysRemaining: 7,
      rateWindowDays: 6,
      seasonMaxTokens: 28,
      regenPerDay: 2
    })
    expect(out.projectedWaste).toBe(0)
    expect(out.playersAtCapRisk).toBe(0)
  })

  it('an active player (spend rate >= regen rate) wastes nothing', () => {
    const out = computeSeasonTokenAggregates({
      ...BASE,
      players: [{ bank: 3, usedThisSeason: 10, recentBattleCount: 60 }] // 2/day
    })
    expect(out.projectedWaste).toBe(0)
  })

  it('an idle player wastes all the regen they could still realize', () => {
    const out = computeSeasonTokenAggregates({
      ...BASE,
      players: [{ bank: 3, usedThisSeason: 0, recentBattleCount: 0 }]
    })
    expect(out.projectedWaste).toBe(20)
    expect(out.playersAtCapRisk).toBe(1)
  })

  it('a season-capped player contributes no remaining and no waste', () => {
    const out = computeSeasonTokenAggregates({
      ...BASE,
      players: [{ bank: 3, usedThisSeason: 28, recentBattleCount: 0 }]
    })
    expect(out.tokensRemaining).toBe(0)
    expect(out.projectedWaste).toBe(0)
  })

  it('used + remaining never exceeds the season budget (members × cap)', () => {
    const players: PlayerTokenEconomyInput[] = Array.from(
      { length: 30 },
      (_, i) => ({
        bank: 3,
        usedThisSeason: i % 28,
        recentBattleCount: i
      })
    )
    const out = computeSeasonTokenAggregates({ ...BASE, players })
    const budget = 30 * BASE.seasonMaxTokens
    expect(out.tokensUsed + out.tokensRemaining).toBeLessThanOrEqual(budget)
  })

  it('clamps junk inputs (negatives / NaN) to zero', () => {
    const out = computeSeasonTokenAggregates({
      ...BASE,
      players: [{ bank: -5, usedThisSeason: -3, recentBattleCount: Number.NaN }]
    })
    expect(out.tokensUsed).toBe(0)
    expect(out.tokensRemaining).toBeGreaterThanOrEqual(0)
    expect(out.projectedWaste).toBeGreaterThanOrEqual(0)
  })
})

describe('computeSeasonTokenAggregates per-player emission', () => {
  const ARGS = {
    regenToEnd: 20,
    daysRemaining: 10,
    rateWindowDays: 7,
    seasonMaxTokens: 28,
    regenPerDay: 2
  }

  const PLAYERS: PlayerTokenEconomyInput[] = [
    {
      playerId: 'p-idle',
      displayName: 'Idle',
      bank: 3,
      usedThisSeason: 4,
      recentBattleCount: 0
    },
    {
      playerId: 'p-pace',
      displayName: 'OnPace',
      bank: 1,
      usedThisSeason: 20,
      recentBattleCount: 25
    },
    {
      playerId: 'p-slow',
      displayName: 'Slow',
      bank: 2,
      usedThisSeason: 6,
      recentBattleCount: 5
    },
    {
      playerId: 'p-capped',
      displayName: 'Capped',
      bank: 3,
      usedThisSeason: 27,
      recentBattleCount: 1
    }
  ]

  const result = computeSeasonTokenAggregates({ players: PLAYERS, ...ARGS })

  it('emits one row per input player, in input order, with identity', () => {
    expect(result.players.map((row) => row.playerId)).toEqual([
      'p-idle',
      'p-pace',
      'p-slow',
      'p-capped'
    ])
    expect(result.players.map((row) => row.displayName)).toEqual([
      'Idle',
      'OnPace',
      'Slow',
      'Capped'
    ])
    expect(result.players).toHaveLength(result.memberCount)
  })

  it('rows sum exactly to tokensUsed (integer terms)', () => {
    const sum = result.players.reduce((acc, row) => acc + row.tokensUsed, 0)
    expect(sum).toBe(result.tokensUsed)
  })

  it('rows sum to tokensRemaining under the same round-after-sum', () => {
    const sum = result.players.reduce(
      (acc, row) => acc + row.tokensRemaining,
      0
    )
    expect(Math.round(sum)).toBe(result.tokensRemaining)
  })

  it('rows sum to projectedWaste under the same round-after-sum', () => {
    const sum = result.players.reduce((acc, row) => acc + row.projectedWaste, 0)
    expect(Math.round(sum)).toBe(result.projectedWaste)
    // The slow player's waste is fractional, so this is real reconciliation.
    expect(
      result.players.some((row) => !Number.isInteger(row.projectedWaste))
    ).toBe(true)
  })

  it('atCapRisk flags count exactly to playersAtCapRisk (waste >= 1 threshold)', () => {
    const flagged = result.players.filter((row) => row.atCapRisk)
    expect(flagged).toHaveLength(result.playersAtCapRisk)
    for (const row of result.players) {
      expect(row.atCapRisk).toBe(row.projectedWaste >= 1)
    }
  })

  it('per-player terms match the model hand-computed for the idle player', () => {
    const idle = result.players[0]
    expect(idle.tokensUsed).toBe(4)
    expect(idle.tokensRemaining).toBe(23)
    expect(idle.projectedWaste).toBe(20)
    expect(idle.atCapRisk).toBe(true)
  })

  it('an on-pace player wastes nothing and is not flagged', () => {
    const onPace = result.players[1]
    expect(onPace.projectedWaste).toBe(0)
    expect(onPace.atCapRisk).toBe(false)
  })

  it('defaults identity to empty strings when the input carries none', () => {
    const anonymous = computeSeasonTokenAggregates({
      players: [{ bank: 1, usedThisSeason: 2, recentBattleCount: 3 }],
      ...ARGS
    })
    expect(anonymous.players).toEqual([
      expect.objectContaining({ playerId: '', displayName: '' })
    ])
  })

  it('emits no rows for an empty roster', () => {
    const empty = computeSeasonTokenAggregates({ players: [], ...ARGS })
    expect(empty.players).toEqual([])
    expect(empty.memberCount).toBe(0)
  })
})
