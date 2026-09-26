import { describe, it, expect } from 'vitest'
import {
  applyTokenWeightingPercent,
  clampTokenRatio
} from '@tacticus/app-core/token-weighting'
import {
  battleRowsToLong,
  applyTokenRatios,
  targetRowsToLong,
  buildResult,
  type GuildPlayerScoreRow,
  type SeasonTokenStatsBatchRow,
  type TargetScoreRow,
  type LongScoreRow,
  type PlayerNameStatus
} from '@/app/lib/calculations/experimental/player-season-rankings'

function battleRow(
  overrides: Partial<GuildPlayerScoreRow> = {}
): GuildPlayerScoreRow {
  return {
    season: '25',
    user_id: 'player-1',
    weighted_vs_guild: 10,
    battle_count: 5,
    ...overrides
  }
}

function tokenRow(
  overrides: Partial<SeasonTokenStatsBatchRow> = {}
): SeasonTokenStatsBatchRow {
  return {
    season: '25',
    user_id: 'player-1',
    display_name: 'Player One',
    tokens_spent: 7,
    tokens_possible: 14,
    ...overrides
  }
}

function targetRow(overrides: Partial<TargetScoreRow> = {}): TargetScoreRow {
  return {
    season: '25',
    user_id: 'player-1',
    weighted_score: 1.2,
    ...overrides
  }
}

describe('battleRowsToLong', () => {
  it('passes weighted_vs_guild straight through as vsGuild', () => {
    const out = battleRowsToLong([
      battleRow({ season: '25', user_id: 'p1', weighted_vs_guild: 42.5 })
    ])
    expect(out).toEqual<LongScoreRow[]>([
      { season: '25', userId: 'p1', vsGuild: 42.5 }
    ])
  })

  it('drops a null-weighted row and an empty-user_id row', () => {
    const out = battleRowsToLong([
      battleRow({ user_id: 'keep', weighted_vs_guild: 5 }),
      // null weighted_vs_guild -> dropped (cast: source allows null at runtime)
      battleRow({
        user_id: 'null-weight',
        weighted_vs_guild: null as unknown as number
      }),
      battleRow({ user_id: '', weighted_vs_guild: 99 })
    ])
    expect(out).toEqual<LongScoreRow[]>([
      { season: '25', userId: 'keep', vsGuild: 5 }
    ])
    expect(out.map((r) => r.userId)).not.toContain('null-weight')
    expect(out.map((r) => r.userId)).not.toContain('')
  })
})

describe('applyTokenRatios', () => {
  it('scales by ratio 0.5 when tokens_spent=7 / tokens_possible=14', () => {
    const battlePct = 10
    const battleLong: LongScoreRow[] = [
      { season: '25', userId: 'p1', vsGuild: battlePct }
    ]
    const out = applyTokenRatios(battleLong, [
      tokenRow({
        user_id: 'p1',
        tokens_spent: 7,
        tokens_possible: 14
      })
    ])

    const ratio = 0.5
    // Library algebra: ((1 + pct/100) * ratio - 1) * 100
    const expectedByAlgebra = ((1 + battlePct / 100) * ratio - 1) * 100
    expect(out).toHaveLength(1)
    expect(out[0].season).toBe('25')
    expect(out[0].userId).toBe('p1')
    expect(out[0].vsGuild).toBeCloseTo(expectedByAlgebra, 10)
    expect(out[0].vsGuild).toBeCloseTo(
      applyTokenWeightingPercent(battlePct, clampTokenRatio(7 / 14)),
      10
    )
    expect(out[0].vsGuild).toBeCloseTo(-45, 10)
  })

  it('defaults to ratio 1 (cell unchanged) when the player has NO token row', () => {
    const battleLong: LongScoreRow[] = [
      { season: '25', userId: 'no-token', vsGuild: 33.3 }
    ]
    const out = applyTokenRatios(battleLong, [
      tokenRow({
        user_id: 'someone-else',
        tokens_spent: 1,
        tokens_possible: 10
      })
    ])
    expect(out).toHaveLength(1)
    expect(out[0].vsGuild).toBeCloseTo(33.3, 10)
  })

  it('uses ratio 1 when tokens_possible=0 but tokens_spent>0', () => {
    const battlePct = 20
    const battleLong: LongScoreRow[] = [
      { season: '25', userId: 'p1', vsGuild: battlePct }
    ]
    const out = applyTokenRatios(battleLong, [
      tokenRow({ user_id: 'p1', tokens_spent: 3, tokens_possible: 0 })
    ])
    expect(out[0].vsGuild).toBeCloseTo(battlePct, 10)
  })

  it('uses ratio 0 when tokens_spent=0 (cell collapses to -100)', () => {
    const battlePct = 50
    const battleLong: LongScoreRow[] = [
      { season: '25', userId: 'p1', vsGuild: battlePct }
    ]
    const out = applyTokenRatios(battleLong, [
      tokenRow({ user_id: 'p1', tokens_spent: 0, tokens_possible: 14 })
    ])
    const expectedByAlgebra = ((1 + battlePct / 100) * 0 - 1) * 100
    expect(out[0].vsGuild).toBeCloseTo(expectedByAlgebra, 10)
    expect(out[0].vsGuild).toBeCloseTo(-100, 10)
  })
})

describe('targetRowsToLong', () => {
  it('normalizes weighted_score 1.2 -> +20, 0.8 -> -20, 1.0 -> 0', () => {
    const out = targetRowsToLong([
      targetRow({ season: '25', user_id: 'up', weighted_score: 1.2 }),
      targetRow({ season: '25', user_id: 'down', weighted_score: 0.8 }),
      targetRow({ season: '25', user_id: 'even', weighted_score: 1.0 })
    ])
    const byUser = new Map(out.map((r) => [r.userId, r.vsGuild]))
    expect(byUser.get('up')).toBeCloseTo(20, 10)
    expect(byUser.get('down')).toBeCloseTo(-20, 10)
    expect(byUser.get('even')).toBeCloseTo(0, 10)
  })

  it('DROPS a null weighted_score row rather than coercing it to 0', () => {
    const out = targetRowsToLong([
      targetRow({ season: '25', user_id: 'keep', weighted_score: 1.5 }),
      targetRow({ season: '25', user_id: 'gone', weighted_score: null })
    ])
    const present = out.map((r) => `${r.season}::${r.userId}`)
    expect(present).toContain('25::keep')
    expect(present).not.toContain('25::gone')
    expect(out.find((r) => r.userId === 'gone')).toBeUndefined()
  })

  it('drops an empty-user_id row', () => {
    const out = targetRowsToLong([
      targetRow({ user_id: '', weighted_score: 1.3 })
    ])
    expect(out).toEqual([])
  })
})

describe('buildResult', () => {
  const seasons = ['27', '26', '25']

  it('pivots multiple seasons per player into cellsBySeason', () => {
    const long: LongScoreRow[] = [
      { season: '27', userId: 'p1', vsGuild: 30 },
      { season: '26', userId: 'p1', vsGuild: 10 },
      { season: '25', userId: 'p1', vsGuild: -5 }
    ]
    const result = buildResult(long, new Map(), seasons)
    expect(result.seasons).toEqual(seasons)
    expect(result.rows).toHaveLength(1)
    const row = result.rows[0]
    expect(row.playerId).toBe('p1')
    expect(row.cellsBySeason).toEqual({ '27': 30, '26': 10, '25': -5 })
    expect(row.seasonsPlayed).toBe(3)
    expect(row.avg).toBeCloseTo(35 / 3, 10)
  })

  it('computes avg as the SIMPLE mean of present cells; missing season is null', () => {
    const long: LongScoreRow[] = [
      { season: '27', userId: 'p1', vsGuild: 10 },
      { season: '25', userId: 'p1', vsGuild: 20 }
    ]
    const result = buildResult(long, new Map(), seasons)
    const row = result.rows[0]
    expect(row.cellsBySeason).toEqual({ '27': 10, '26': null, '25': 20 })
    expect(row.cellsBySeason['26']).toBeNull()
    expect(row.seasonsPlayed).toBe(2)
    expect(row.avg).toBeCloseTo(15, 10)
    expect(row.avg).not.toBeCloseTo(10, 5)
  })

  it('sorts by avg DESC and places null-avg (no cells) rows LAST', () => {
    const long: LongScoreRow[] = [
      { season: '27', userId: 'low', vsGuild: 1 },
      { season: '27', userId: 'high', vsGuild: 99 }
    ]
    const nameStatus = new Map<string, PlayerNameStatus>([
      ['empty', { displayName: 'Empty', isCurrent: true }]
    ])
    // Seed an out-of-window cell to get a row with avg === null.
    const longWithEmpty: LongScoreRow[] = [
      ...long,
      { season: 'OUT-OF-WINDOW', userId: 'empty', vsGuild: 5 }
    ]
    const result = buildResult(longWithEmpty, nameStatus, seasons)

    expect(result.rows.map((r) => r.playerId)).toEqual(['high', 'low', 'empty'])
    expect(result.rows[0].avg).toBeCloseTo(99, 10)
    expect(result.rows[1].avg).toBeCloseTo(1, 10)
    const emptyRow = result.rows[2]
    expect(emptyRow.playerId).toBe('empty')
    expect(emptyRow.avg).toBeNull()
    expect(emptyRow.seasonsPlayed).toBe(0)
  })

  it('falls back displayName to userId when nameStatus lacks the player and defaults isCurrent false', () => {
    const long: LongScoreRow[] = [
      { season: '27', userId: 'known', vsGuild: 5 },
      { season: '27', userId: 'unknown', vsGuild: 5 }
    ]
    const nameStatus = new Map<string, PlayerNameStatus>([
      ['known', { displayName: 'Known Player', isCurrent: true }]
    ])
    const result = buildResult(long, nameStatus, seasons)
    const byId = new Map(result.rows.map((r) => [r.playerId, r]))

    const known = byId.get('known')!
    expect(known.displayName).toBe('Known Player')
    expect(known.isCurrent).toBe(true)

    const unknown = byId.get('unknown')!
    expect(unknown.displayName).toBe('unknown')
    expect(unknown.isCurrent).toBe(false)
  })
})
