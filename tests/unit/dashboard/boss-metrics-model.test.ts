import { describe, expect, it } from 'vitest'

import {
  buildBossOverview,
  calculateAverageDamagePerHour,
  calculateBossCombatMetrics
} from '@/app/lib/dashboard/boss-metrics-model'

describe('boss metrics model', () => {
  it('normalizes snapshot fields into a display overview', () => {
    expect(
      buildBossOverview({
        boss_name: 'Mortarion',
        rarity: 'Mythic',
        set: 2,
        max_hp: 1_000,
        hp_remaining: 250,
        encounter_id: 7
      })
    ).toMatchObject({
      name: 'Mortarion',
      displayName: 'M3 Mortarion',
      rarity: 'Mythic',
      levelCode: 'M3',
      remainingHp: 250,
      hpPercentage: 25,
      encounterId: 7
    })
  })

  it('calculates current and previous loop combat metrics deterministically', () => {
    const metrics = calculateBossCombatMetrics(
      [
        {
          set: 0,
          loopIndex: 0,
          damageDealt: 60,
          maxHp: 100,
          remainingHp: 40,
          startedOn: '2026-01-01T00:00:00.000Z',
          completedOn: '2026-01-01T00:10:00.000Z'
        },
        {
          set: 0,
          loopIndex: 0,
          damageDealt: 40,
          maxHp: 100,
          remainingHp: 0,
          startedOn: '2026-01-01T00:20:00.000Z',
          completedOn: '2026-01-01T00:30:00.000Z'
        },
        {
          set: 0,
          loopIndex: 1,
          damageDealt: 25,
          maxHp: 100,
          remainingHp: 75,
          startedOn: '2026-01-01T01:00:00.000Z',
          completedOn: '2026-01-01T01:10:00.000Z'
        }
      ],
      Date.parse('2026-01-01T01:12:00.000Z')
    )

    expect(metrics).toMatchObject({
      currentLoopIndex: 1,
      currentBattleCount: 1,
      currentElapsedMs: 12 * 60 * 1000,
      previousLoopDurationMs: 30 * 60 * 1000,
      previousLoopTokens: 2,
      averageTokensToKill: 2,
      averageDamagePerHit: 125 / 3
    })
  })

  it('averages only defeated loops with measurable durations', () => {
    expect(
      calculateAverageDamagePerHour([
        {
          Name: 'Boss',
          rarity: 'Legendary',
          set: 0,
          encounterId: 0,
          loopIndex: 0,
          damageDealt: 100,
          maxHp: 100,
          remainingHp: 0,
          startedOn: '2026-01-01T00:00:00.000Z',
          completedOn: '2026-01-01T00:30:00.000Z'
        },
        {
          Name: 'Boss',
          rarity: 'Legendary',
          set: 0,
          encounterId: 0,
          loopIndex: 1,
          damageDealt: 50,
          maxHp: 100,
          remainingHp: 50,
          startedOn: '2026-01-01T01:00:00.000Z',
          completedOn: '2026-01-01T01:30:00.000Z'
        }
      ])
    ).toBe(200)
  })
})
