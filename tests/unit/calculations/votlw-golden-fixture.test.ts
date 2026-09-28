import { describe, it, expect } from 'vitest'
import { calculateVOTLWPoints } from '@/app/components/votlw/utils/votlwCalculations'
import type { BattleEntry } from '@tacticus/app-core/votlw.types'
import fixture from '../../fixtures/votlw-golden-season.json'

// Same fixture as supabase/tests/pgtap/votlw_set_winners_golden.sql.

type FixtureRow = (typeof fixture)['rows'][number]
type ExpectedSet = (typeof fixture)['expected'][number]
type Award = { player?: string; value?: number }

const base = new Date(fixture.baseTime).getTime()

const toEntry = (r: FixtureRow): BattleEntry => ({
  Guild: fixture.guild,
  Season: fixture.season,
  displayName: r.player,
  userId: r.player.toLowerCase(),
  Name: r.boss,
  damageType: 'Battle',
  damageDealt: r.dmg,
  remainingHp: r.remainingHp,
  maxHp: r.maxHp,
  tier: 5,
  set: r.set,
  loopIndex: 0,
  encounterId: r.encounterId,
  encounterIndex: r.encounterIndex,
  rarity: r.rarity as BattleEntry['rarity'],
  startedOn: new Date(base + r.minute * 60_000).toISOString(),
  completedOn: new Date(base + r.minute * 60_000 + 30_000).toISOString()
})

describe('VOTLW golden fixture (SQL↔TS parity)', () => {
  it('client calculation reproduces every expected award of the golden season', async () => {
    const { setWinners } = await calculateVOTLWPoints(
      fixture.rows.map(toEntry),
      [],
      new Set(),
      [],
      fixture.guild,
      fixture.season
    )

    // The client emits all sets while SQL returns only qualified ones, so parity is on content.
    const expectedKeys = new Set(
      (fixture.expected as ExpectedSet[]).map((e) => `${e.rarity}:${e.set}`)
    )
    for (const w of setWinners) {
      if (expectedKeys.has(`${w.rarity}:${w.set}`)) continue
      for (const field of [
        'gold',
        'silver',
        'bronze',
        'mostDamage',
        'sideBoss1',
        'sideBoss2',
        'biggestHit'
      ] as const) {
        expect(w[field], `${w.levelString} ${field} must be empty`).toBe('')
      }
    }

    for (const exp of fixture.expected as ExpectedSet[]) {
      const actual = setWinners.find(
        (w) => w.rarity === exp.rarity && w.set === exp.set
      )
      expect(actual, `${exp.levelString} present`).toBeDefined()
      if (!actual) continue

      expect(actual.levelString).toBe(exp.levelString)
      expect(actual.bossName).toBe(exp.bossName)

      const awards: Array<[keyof ExpectedSet, string, string]> = [
        ['gold', 'gold', 'goldValue'],
        ['silver', 'silver', 'silverValue'],
        ['bronze', 'bronze', 'bronzeValue'],
        ['mostDamage', 'mostDamage', 'mostDamageValue'],
        ['sideBoss1', 'sideBoss1', 'sideBoss1Value'],
        ['sideBoss2', 'sideBoss2', 'sideBoss2Value'],
        ['biggestHit', 'biggestHit', 'biggestHitValue']
      ]
      for (const [key, playerField, valueField] of awards) {
        const expected = exp[key] as Award
        const actualPlayer = actual[playerField as 'gold']
        const actualValue = actual[valueField as 'goldValue']
        const label = `${exp.levelString} ${String(key)}`
        if (expected.player !== undefined) {
          expect(actualPlayer, label).toBe(expected.player)
          expect(actualValue, `${label} value`).toBe(expected.value)
        } else {
          expect(actualPlayer, `${label} empty`).toBe('')
        }
      }
    }
  })
})
