/**
 * Pins War Points output over a seeded corpus. To regenerate after an intended change, run
 * PARITY_OUT=tests/unit/war/__fixtures__/war-points-parity.json npx vitest run tests/unit/war/war-points-parity.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  buildWarPointsScore,
  type AttemptRow,
  type WarMember,
  type WarPointsSummary
} from '@/app/(dashboard)/wars/_components/_hooks/useWarAnalyticsData'

type ParityFixture = {
  attempts: AttemptRow[]
  members: WarMember[]
  result: WarPointsSummary
}

const FIXTURE_PATH = join(__dirname, '__fixtures__', 'war-points-parity.json')

const fixture: ParityFixture = JSON.parse(readFileSync(FIXTURE_PATH, 'utf8'))

function buildParityCorpus(): { attempts: AttemptRow[]; members: WarMember[] } {
  let seed = 0x6270
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff
    return seed / 0x7fffffff
  }
  const pick = <T>(arr: T[]): T => arr[Math.floor(rand() * arr.length)]!

  const unitAlive = () => ({
    unitId: 'u',
    remainingHPAfter: 100 + Math.floor(rand() * 900)
  })
  const unitDead = () => ({ unitId: 'u' })
  const defAlive = () => ({
    unitId: 'd',
    remainingHPBefore: 500,
    remainingHPAfter: 50 + Math.floor(rand() * 500)
  })
  const defDead = () => ({
    unitId: 'd',
    remainingHPBefore: 500,
    remainingHPAfter: 0
  })

  const attempts: AttemptRow[] = []
  const players = ['P1', 'P2', 'P3', 'P4', 'P5']
  const wars = ['w1', 'w2', 'w3']
  const zones = ['z1', 'z2', 'z3', 'z4']
  let t = 0

  const push = (over: Partial<AttemptRow>) => {
    t += 1
    attempts.push({
      war_id: pick(wars),
      player_id: pick(players),
      player_name: 'Name' + Math.floor(rand() * 3),
      is_guild_member: rand() < 0.85,
      zone_id: pick(zones),
      damage_dealt: Math.floor(rand() * 3_000_000),
      score_earned: Math.floor(rand() * 1600),
      attempt_result: 'win',
      attempt_status: 'completed',
      buffs: null,
      raw_loki_data: null,
      attacker_units_json: null,
      defender_units_json: null,
      attacker_units_lost: 0,
      attempt_end_time: `2026-01-01T00:${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}Z`,
      ...over
    })
  }

  const medicae = (n: number) =>
    Array.from({ length: n }, () => ({
      scope: 'Global',
      abilityId: 'EnvDefenderHealthBuff2'
    }))

  for (let i = 0; i < 400; i++) {
    const kind = rand()
    if (kind < 0.2) {
      push({
        attempt_result: pick(['win', 'loss']), // Loki lies: 'win' with survivor
        defender_units_json: [defAlive(), defDead(), defDead()],
        attacker_units_json:
          rand() < 0.5
            ? [unitDead(), unitDead(), unitDead(), unitDead(), unitDead()]
            : [unitAlive(), unitDead()],
        buffs: rand() < 0.5 ? medicae(1 + Math.floor(rand() * 2)) : null
      })
    } else if (kind < 0.3) {
      push({
        attempt_result: null,
        defender_units_json: null,
        attacker_units_json: null
      })
    } else if (kind < 0.4) {
      push({
        defender_units_json: null,
        attacker_units_json:
          rand() < 0.5
            ? [unitDead(), unitDead(), unitDead(), unitDead(), unitDead()]
            : [unitAlive(), unitAlive(), unitDead()]
      })
    } else if (kind < 0.5) {
      push({
        defender_units_json: [defDead(), defDead()],
        attacker_units_json: null,
        raw_loki_data: {
          log: {
            attacker: { units: [unitAlive(), unitAlive(), unitDead()] },
            buffs: medicae(2)
          }
        }
      })
    } else {
      const lost = Math.floor(rand() * 5)
      push({
        defender_units_json: [
          defDead(),
          defDead(),
          defDead(),
          defDead(),
          defDead()
        ],
        attacker_units_json: [
          ...Array.from({ length: 5 - lost }, unitAlive),
          ...Array.from({ length: lost }, unitDead)
        ],
        attacker_units_lost: rand() < 0.3 ? lost : 0,
        buffs: rand() < 0.4 ? medicae(1 + Math.floor(rand() * 2)) : null
      })
    }
  }

  const members: WarMember[] = [
    { playerId: 'P1', label: 'Alpha (g_01)' },
    { playerId: 'P2', label: 'Alpha (g_02)' },
    { playerId: 'P3', label: 'Bravo' },
    { playerId: 'P6', label: 'Absent Charlie' }
  ]

  return { attempts, members }
}

describe('War Points parity (WI-6270 Wave 2 extraction)', () => {
  it('covers a real population (positive control)', () => {
    expect(fixture.attempts.length).toBe(400)
    expect(fixture.result.players.some((p) => p.cln > 0)).toBe(true)
    expect(fixture.result.players.some((p) => p.failN > 0 || p.failM > 0)).toBe(
      true
    )
    for (const bucket of ['cnt16', 'cnt14', 'cnt12', 'cnt11'] as const) {
      expect(fixture.result.players.some((p) => p[bucket] > 0)).toBe(true)
    }
  })

  it('the committed generator reproduces the fixture inputs exactly', () => {
    const corpus = buildParityCorpus()
    expect(JSON.parse(JSON.stringify(corpus.attempts))).toEqual(
      fixture.attempts
    )
    expect(corpus.members).toEqual(fixture.members)
  })

  it('reproduces the pre-extraction output exactly', () => {
    const result = buildWarPointsScore(fixture.attempts, fixture.members)
    // JSON round-trip normalizes -0, which the token penalty yields for fully spent wars.
    expect(JSON.parse(JSON.stringify(result))).toEqual(fixture.result)
  })

  it.runIf(Boolean(process.env.PARITY_OUT))(
    'regenerates the fixture (PARITY_OUT set — deliberate act only)',
    () => {
      const corpus = buildParityCorpus()
      const result = buildWarPointsScore(corpus.attempts, corpus.members)
      writeFileSync(
        process.env.PARITY_OUT!,
        JSON.stringify({ ...corpus, result }, null, 2)
      )
    }
  )
})
