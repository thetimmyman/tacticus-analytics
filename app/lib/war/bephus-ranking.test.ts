import { describe, expect, it } from 'vitest'
import {
  buildPlayerRanking,
  scoreBattle,
  type RankingBattleRow
} from './bephus-ranking'

const defenders = (alive: number, dead: number) => [
  ...Array.from({ length: alive }, () => ({
    unitId: 'd',
    remainingHPBefore: 500,
    remainingHPAfter: 0
  })),
  ...Array.from({ length: dead }, () => ({
    unitId: 'd',
    remainingHPBefore: 0,
    remainingHPAfter: 0
  }))
]

const attackers = (survived: number, lost: number) => [
  ...Array.from({ length: survived }, () => ({
    unitId: 'a',
    remainingHPAfter: 100
  })),
  ...Array.from({ length: lost }, () => ({ unitId: 'a' }))
]

const medicae = (n: number) =>
  Array.from({ length: n }, () => ({
    scope: 'Global',
    abilityId: 'EnvDefenderHealthBuff2'
  }))

const win = (over: Partial<RankingBattleRow>): RankingBattleRow => ({
  war_id: 'w1',
  zone_id: 'z1',
  player_id: 'P1',
  player_name: 'Alpha',
  attempt_result: 'win',
  attempt_end_time: '2026-01-01T00:00:00Z',
  is_guild_member: true,
  score_earned: 1600,
  defender_units_json: defenders(5, 0),
  attacker_units_json: attackers(5, 0),
  attacker_units_lost: 0,
  buffs: medicae(2),
  ...over
})

const mult = (row: RankingBattleRow): number => {
  const s = scoreBattle(row)
  if (s.kind === 'excluded') throw new Error(`excluded: ${s.reason}`)
  return s.multiplier
}

describe('scoreBattle — exact against the stakeholder table', () => {
  it('one-shot rows (5 alive at start)', () => {
    expect(mult(win({}))).toBe(3.0) // 2 Medicae, 0 lost
    expect(mult(win({ attacker_units_json: attackers(1, 4) }))).toBe(2.8) // 2M, 4 lost
    expect(mult(win({ buffs: medicae(1) }))).toBe(2.75) // 1M, 0 lost
    expect(mult(win({ buffs: null }))).toBe(2.5) // 0M, 0 lost
    expect(
      mult(win({ buffs: null, attacker_units_json: attackers(3, 2) }))
    ).toBe(2.4) // 0M, 2 lost
  })

  it('cleanup rows (fewer defenders alive at start)', () => {
    expect(mult(win({ defender_units_json: defenders(4, 1) }))).toBe(2.75) // 2M, 4 alive, 0 lost
    expect(mult(win({ defender_units_json: defenders(2, 3) }))).toBe(2.25) // 2M, 2 alive, 0 lost — Bephus's example
    expect(
      mult(
        win({
          defender_units_json: defenders(1, 4),
          attacker_units_json: attackers(1, 4),
          buffs: null
        })
      )
    ).toBe(1.3) // 0M, 1 alive, 4 lost — the table's smallest winning cell
    expect(
      mult(win({ defender_units_json: defenders(3, 2), buffs: medicae(1) }))
    ).toBe(2.25) // 1M, 3 alive, 0 lost
  })

  it("the stakeholder's Q2 observation: 2-alive clean cleanup < one-shot with 4 losses", () => {
    const cleanup = mult(win({ defender_units_json: defenders(2, 3) })) // 2.25
    const sloppyOneshot = mult(win({ attacker_units_json: attackers(1, 4) })) // 2.80
    expect(cleanup).toBeLessThan(sloppyOneshot)
  })

  it('loss (used token) = 1.00 flat, medicae ignored', () => {
    const loss = scoreBattle(
      win({
        defender_units_json: [
          { unitId: 'd', remainingHPBefore: 500, remainingHPAfter: 200 }
        ]
      })
    )
    expect(loss).toEqual({ kind: 'loss', multiplier: 1.0 })
  })

  it('successful NPC hit = 1.25; a FAILED attack on NPCs pays the loss rate', () => {
    const npcWin = scoreBattle(
      win({
        defender_player_id: null,
        defender_units_json: [
          {
            unitId: 'templNpc1Initiate:3',
            remainingHPBefore: 500,
            remainingHPAfter: 0
          }
        ]
      })
    )
    expect(npcWin).toEqual({ kind: 'npc', multiplier: 1.25 })
    // Loss beats NPC: a wipe against the NPC defense must not outrank a hard loss.
    const npcFail = scoreBattle(
      win({
        defender_player_id: null,
        defender_units_json: [
          {
            unitId: 'templNpc1Initiate:3',
            remainingHPBefore: 500,
            remainingHPAfter: 100
          }
        ]
      })
    )
    expect(npcFail).toEqual({ kind: 'loss', multiplier: 1.0 })
  })

  it('a PLAYER fielding NPC units is scored as a normal win, not an NPC hit', () => {
    const s = scoreBattle(
      win({
        defender_player_id: 'player-9',
        defender_units_json: [
          {
            unitId: 'templNpc1Initiate:3',
            remainingHPBefore: 500,
            remainingHPAfter: 0
          }
        ]
      })
    )
    expect(s.kind).toBe('cleanup') // 1 alive at start
  })

  it('exclusions carry visible reasons', () => {
    expect(scoreBattle(win({ attempt_result: null }))).toEqual({
      kind: 'excluded',
      reason: 'no-result'
    })
    expect(
      scoreBattle(win({ defender_units_json: [{ remainingHPAfter: 0 }] }))
    ).toEqual({ kind: 'excluded', reason: 'no-before-hp' })
    expect(scoreBattle(win({ defender_units_json: defenders(0, 5) }))).toEqual({
      kind: 'excluded',
      reason: 'no-defenders-alive'
    })
  })
})

describe('buildPlayerRanking', () => {
  it('aggregates per player, skips opponents and excluded wars', () => {
    const rows: RankingBattleRow[] = [
      win({ player_id: 'P1' }), // 3.00
      win({ player_id: 'P1', defender_units_json: defenders(2, 3) }), // 2.25
      win({ player_id: 'P2', is_guild_member: false }), // opponent — ignored
      win({ player_id: 'P3', war_id: 'w-excluded' }) // excluded war — ignored
    ]
    const result = buildPlayerRanking(rows, [
      { warId: 'w-excluded', reason: 'zone-events-mismatch' }
    ])
    expect(result.players).toHaveLength(1)
    const p1 = result.players[0]!
    expect(p1.playerId).toBe('P1')
    expect(p1.oneshots).toBe(1)
    expect(p1.cleanups).toBe(1)
    expect(p1.totalMultiplier).toBe(5.25)
    expect(p1.avgMultiplier).toBe(2.63)
    expect(result.excludedWars).toEqual([
      { warId: 'w-excluded', reason: 'zone-events-mismatch' }
    ])
  })

  it('normalizes points with the per-war capture cap and counts exclusions', () => {
    const rows: RankingBattleRow[] = [
      win({ player_id: 'P1', score_earned: 42_000 }), // capture bonus → capped
      win({ player_id: 'P1', score_earned: 1600 }),
      win({ player_id: 'P1', attempt_result: null, score_earned: 100 })
    ]
    const result = buildPlayerRanking(rows, [], new Map([['w1', 1600]]))
    const p1 = result.players[0]!
    expect(p1.normalizedPoints).toBe(1600 + 1600 + 100)
    expect(p1.excluded).toBe(1)
    expect(result.excludedBattles['no-result']).toBe(1)
    expect(p1.battles).toBe(3)
    expect(p1.scored).toBe(2)
  })

  it('ranks by total multiplier, tie-broken by normalized points', () => {
    const rows: RankingBattleRow[] = [
      win({ player_id: 'A', score_earned: 100 }),
      win({ player_id: 'B', score_earned: 900 })
    ]
    const result = buildPlayerRanking(rows, [])
    expect(result.players.map((p) => p.playerId)).toEqual(['B', 'A'])
  })
})
