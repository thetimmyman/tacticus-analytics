import { describe, expect, it } from 'vitest'

import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'
import {
  planSeason,
  type DamageEstimator,
  type PlannerPlayer,
  type RaidState,
  type StageTemplate
} from '@/app/lib/boss-assignments/season-planner/planner-engine'

const SNAPSHOT_AT = Date.parse('2025-01-01T00:00:00.000Z')

const stamina = { max: 3, regenerationSeconds: 43_200, amountPerTick: 1 }

const PROGRESSION: ProgressionConfig = {
  firstPassSequence: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2'],
  loopSequence: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2'],
  loopStartStage: 'L1',
  gameVersion: 'test-fixture'
}

function mkRaid(stageCode: string, mainHp: number): RaidState {
  return {
    stageCode,
    loopIndex: 0,
    encounters: {
      0: {
        encounterId: 0,
        stageCode,
        loopIndex: 0,
        bossName: `Boss_${stageCode}`,
        maxHp: mainHp,
        remainingHp: mainHp
      },
      1: {
        encounterId: 1,
        stageCode,
        loopIndex: 0,
        bossName: `Prime1_${stageCode}`,
        maxHp: 0,
        remainingHp: 0
      },
      2: {
        encounterId: 2,
        stageCode,
        loopIndex: 0,
        bossName: `Prime2_${stageCode}`,
        maxHp: 0,
        remainingHp: 0
      }
    }
  }
}

function templatesFor(mainHp: number): StageTemplate[] {
  return PROGRESSION.firstPassSequence
    .concat(PROGRESSION.loopSequence)
    .filter((code, idx, arr) => arr.indexOf(code) === idx)
    .map((stageCode) => ({
      stageCode,
      encounters: {
        0: { bossName: `Boss_${stageCode}`, maxHp: mainHp },
        1: { bossName: `Prime1_${stageCode}`, maxHp: 0 },
        2: { bossName: `Prime2_${stageCode}`, maxHp: 0 }
      }
    }))
}

describe('planSeason — season-end with bosses still alive', () => {
  it('does not loop forever and reports the surviving main boss', () => {
    const seasonEndAt = SNAPSHOT_AT + 60_000 // 1 minute → no regen window
    const players: PlannerPlayer[] = [
      {
        playerId: 'p1',
        displayName: 'P1',
        sessionsAt: [SNAPSHOT_AT],
        tokenState: { available: 3, nextRegenAt: null }
      }
    ]
    const estimate: DamageEstimator = () => 1 // 1 damage/token vs huge HP

    const result = planSeason({
      players,
      initialRaidState: mkRaid('M1', 1_000_000_000),
      stageTemplates: templatesFor(1_000_000_000),
      options: {
        snapshotAt: SNAPSHOT_AT,
        seasonEndAt,
        stamina,
        optionalSpendMinHpMultiplier: 0
      },
      estimateDamage: estimate,
      progressionConfig: PROGRESSION
    })

    expect(result.finalRaidState.encounters[0].remainingHp).toBeGreaterThan(0)
    expect(result.metrics.bossesDefeated).toBe(0)
    expect(result.metrics.loopAdvances).toBe(0)
    expect(result.metrics.tokensSpent).toBeGreaterThan(0)
    expect(result.metrics.tokensSpent).toBeLessThanOrEqual(3)
    expect(result.finalRaidState.encounters[0].remainingHp).toBe(
      1_000_000_000 - result.metrics.tokensSpent
    )
  })
})

describe('planSeason — zero-token players', () => {
  it('spends nothing and defeats nothing when the only player has 0 tokens', () => {
    const seasonEndAt = SNAPSHOT_AT + 60_000
    const players: PlannerPlayer[] = [
      {
        playerId: 'p1',
        displayName: 'P1',
        sessionsAt: [SNAPSHOT_AT],
        tokenState: { available: 0, nextRegenAt: null }
      }
    ]

    const result = planSeason({
      players,
      initialRaidState: mkRaid('M1', 100),
      stageTemplates: templatesFor(100),
      options: {
        snapshotAt: SNAPSHOT_AT,
        seasonEndAt,
        stamina,
        optionalSpendMinHpMultiplier: 0
      },
      estimateDamage: () => 1000,
      progressionConfig: PROGRESSION
    })

    expect(result.metrics.tokensSpent).toBe(0)
    expect(result.metrics.bossesDefeated).toBe(0)
    expect(result.finalRaidState.encounters[0].remainingHp).toBe(100)
    const session = result.sessions.find((s) => s.playerId === 'p1')
    expect(session).toBeDefined()
    expect(session!.tokensSpent).toBe(0)
    expect(session!.actions).toHaveLength(0)
  })
})

describe('planSeason — optionalSpendMinHpMultiplier gates optional spend', () => {
  // One minute before season end all spend is optional, so the multiplier alone decides.
  const seasonEndAt = SNAPSHOT_AT + 60_000
  const players: PlannerPlayer[] = [
    {
      playerId: 'p1',
      displayName: 'P1',
      sessionsAt: [SNAPSHOT_AT],
      tokenState: { available: 3, nextRegenAt: null }
    }
  ]
  const estimate: DamageEstimator = () => 10_000

  const run = (mult: number) =>
    planSeason({
      players,
      initialRaidState: mkRaid('M1', 100_000),
      stageTemplates: templatesFor(100_000),
      options: {
        snapshotAt: SNAPSHOT_AT,
        seasonEndAt,
        stamina,
        optionalSpendMinHpMultiplier: mult
      },
      estimateDamage: estimate,
      progressionConfig: PROGRESSION
    })

  it('open gate (mult=0) spends every available token', () => {
    const result = run(0)
    expect(result.metrics.tokensSpent).toBe(3)
  })

  it('tight gate (mult=1000) holds all optional tokens', () => {
    const result = run(1000)
    expect(result.metrics.tokensSpent).toBe(0)
  })

  it('the gate is the discriminator (open spends strictly more than tight)', () => {
    const open = run(0).metrics.tokensSpent
    const tight = run(1000).metrics.tokensSpent
    expect(open).toBeGreaterThan(tight)
  })
})

describe('planSeason — multi-loop advancement', () => {
  it('advances past a full loop when bosses are cheap and tokens are ample', () => {
    const DAY = 86_400_000
    const seasonEndAt = SNAPSHOT_AT + 15 * DAY
    const sessionsAt = Array.from(
      { length: 12 },
      (_, i) => SNAPSHOT_AT + i * DAY
    )

    const players: PlannerPlayer[] = [
      {
        playerId: 'p1',
        displayName: 'P1',
        sessionsAt,
        tokenState: { available: 3, nextRegenAt: null }
      }
    ]

    const result = planSeason({
      players,
      initialRaidState: mkRaid('L1', 1),
      stageTemplates: templatesFor(1),
      options: {
        snapshotAt: SNAPSHOT_AT,
        seasonEndAt,
        stamina,
        optionalSpendMinHpMultiplier: 0,
        seasonMaxTokens: 60
      },
      estimateDamage: () => 1000, // one-shots a 1-HP boss
      progressionConfig: PROGRESSION
    })

    expect(result.metrics.tokensSpent).toBeGreaterThan(8)
    expect(result.metrics.bossesDefeated).toBeGreaterThan(0)
    expect(result.metrics.loopAdvances).toBeGreaterThan(0)
    expect(result.metrics.bossesDefeated).toBeLessThanOrEqual(
      result.metrics.tokensSpent
    )
  })
})
