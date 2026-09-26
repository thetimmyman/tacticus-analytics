import { describe, expect, it } from 'vitest'
import {
  countDefendersAliveAtStart,
  countMedicaeForRow,
  inferAttackerUnitsLost,
  isAttemptWin,
  isFailedAttack,
  isNpcDefenderBattle
} from './battle-signals'

describe('isFailedAttack / isAttemptWin', () => {
  it('defender survival beats attempt_result=win', () => {
    const row = {
      attempt_result: 'win',
      defender_units_json: [{ remainingHPAfter: 10 }, { remainingHPAfter: 0 }]
    }
    expect(isFailedAttack(row)).toBe(true)
    expect(isAttemptWin(row)).toBe(false)
  })

  it('full defender wipe is a win', () => {
    const row = {
      attempt_result: 'win',
      defender_units_json: [{ remainingHPAfter: 0 }, {}]
    }
    expect(isFailedAttack(row)).toBe(false)
    expect(isAttemptWin(row)).toBe(true)
  })

  it('no-signal rows never count as wins', () => {
    expect(isAttemptWin({ attempt_result: null })).toBe(false)
  })
})

describe('countMedicaeForRow', () => {
  it('prefers the buffs column over raw_loki_data', () => {
    const row = {
      buffs: [
        { scope: 'Global', abilityId: 'EnvDefenderHealthBuff2' },
        { scope: 'Global', abilityId: 'EnvDefenderHealthBuff2' },
        { scope: 'Regional', abilityId: 'EnvArmourSupplies' }
      ],
      raw_loki_data: { log: { buffs: [] } }
    }
    expect(countMedicaeForRow(row)).toBe(2)
  })

  it('falls back to the raw Loki log when buffs is null', () => {
    const row = {
      buffs: null,
      raw_loki_data: {
        log: { buffs: [{ abilityId: 'EnvDefenderHealthBuff' }] }
      }
    }
    expect(countMedicaeForRow(row)).toBe(1)
  })
})

describe('inferAttackerUnitsLost', () => {
  it('re-derives losses from lineup HP omission (stored column lies as 0)', () => {
    const row = {
      attacker_units_lost: 0,
      attacker_units_json: [
        { remainingHPAfter: 100 },
        { unitId: 'dead1' },
        { unitId: 'dead2' }
      ]
    }
    expect(inferAttackerUnitsLost(row)).toBe(2)
  })

  it('returns stored 0 when the lineup has no after-HP data at all', () => {
    const row = {
      attacker_units_lost: 0,
      attacker_units_json: [{ unitId: 'a' }, { unitId: 'b' }]
    }
    expect(inferAttackerUnitsLost(row)).toBe(0)
  })
})

describe('countDefendersAliveAtStart (Bephus-table cleanup axis)', () => {
  it('counts defenders with positive before-HP', () => {
    const row = {
      defender_units_json: [
        { remainingHPBefore: 500 },
        { remainingHPBefore: 120 },
        { remainingHPBefore: 0 },
        { remainingHPBefore: 0 },
        { remainingHPBefore: 0 }
      ]
    }
    expect(countDefendersAliveAtStart(row)).toBe(2)
  })

  it('returns null when no before-HP data exists — callers must not guess', () => {
    expect(countDefendersAliveAtStart({ defender_units_json: [{}, {}] })).toBe(
      null
    )
    expect(countDefendersAliveAtStart({ defender_units_json: null })).toBe(null)
    expect(countDefendersAliveAtStart({})).toBe(null)
  })

  it('returns null on PARTIAL before-HP coverage — unknown defenders must not count as dead', () => {
    // 2 of 5 defenders with data must not yield a confident "2 alive".
    expect(
      countDefendersAliveAtStart({
        defender_units_json: [
          { remainingHPBefore: 500 },
          { remainingHPBefore: 300 },
          {},
          {},
          {}
        ]
      })
    ).toBe(null)
  })
})

describe('isNpcDefenderBattle (conjunctive rule, WI-6270)', () => {
  const npcLineup = [
    { unitId: 'templNpc1Initiate:1' },
    { unitId: 'templNpc1Initiate:2' }
  ]

  it('null defender + all-NPC lineup → NPC battle', () => {
    expect(
      isNpcDefenderBattle({
        defender_player_id: null,
        defender_units_json: npcLineup
      })
    ).toBe(true)
  })

  it('a PLAYER fielding NPC units stays player-classified', () => {
    expect(
      isNpcDefenderBattle({
        defender_player_id: 'player-1',
        defender_units_json: npcLineup
      })
    ).toBe(false)
  })

  it('null defender with a non-NPC lineup is NOT an NPC battle', () => {
    expect(
      isNpcDefenderBattle({
        defender_player_id: null,
        defender_units_json: [{ unitId: 'blackHaarken' }]
      })
    ).toBe(false)
  })

  it('null defender with no lineup data is NOT an NPC battle', () => {
    expect(isNpcDefenderBattle({ defender_player_id: null })).toBe(false)
  })
})
