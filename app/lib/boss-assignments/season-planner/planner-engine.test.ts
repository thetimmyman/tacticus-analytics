import { describe, it, expect } from 'vitest'
import {
  planSeason,
  type EncounterId,
  type PlannedAction,
  type PlannerPlayer,
  type RaidState,
  type StageTemplate
} from '@/app/lib/boss-assignments/season-planner/planner-engine'
import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'
import {
  MS0,
  runFixturePlan,
  PER_TOKEN_DAMAGE
} from '@/app/lib/boss-assignments/season-planner/planner-fixtures'
import { computeRemainingBossSequence } from '@/app/lib/boss-assignments/season-sequence'
import type { SeasonBoss } from '@/app/lib/loki/season-configs'
import type { BossHpData } from '@/app/lib/boss-assignments/season-planner/boss-hp'

function collectActions(
  sessions: { actions: PlannedAction[] }[]
): PlannedAction[] {
  return sessions.flatMap((s) => s.actions)
}

describe('planSeason — main-only regression guard', () => {
  it('matches the engine before the cap-boundary change on this main-only fixture (which does not straddle the cap boundary)', () => {
    const plan = runFixturePlan(false)

    // Main-only baseline; drift means prime allocation leaked in.
    expect(plan.metrics).toEqual({
      tokensSpent: 41,
      overkillDamage: 0,
      bossesDefeated: 6,
      loopAdvances: 2,
      wastedTokens: 0,
      wastedTicks: 0
    })
    expect(plan.finalRaidState.stageCode).toBe('L1')
    expect(plan.finalRaidState.loopIndex).toBe(2)
    expect(plan.finalRaidState.encounters[0].remainingHp).toBe(50)

    const actions = collectActions(plan.sessions)
    expect(actions.every((a) => a.encounterId === 0)).toBe(true)
  })
})

describe('planSeason — prime allocation', () => {
  it('books tokens into prime encounters', () => {
    const plan = runFixturePlan(true)
    const actions = collectActions(plan.sessions)

    const prime1Hits = actions.filter((a) => a.encounterId === 1)
    const prime2Hits = actions.filter((a) => a.encounterId === 2)

    expect(prime1Hits.length).toBeGreaterThan(0)
    expect(prime2Hits.length).toBeGreaterThan(0)
    expect(prime1Hits.every((a) => a.appliedDamage > 0)).toBe(true)
    expect(prime2Hits.every((a) => a.appliedDamage > 0)).toBe(true)
  })

  it('books MORE tokens than the main-only baseline for the same roster', () => {
    const mainOnly = runFixturePlan(false)
    const withPrimes = runFixturePlan(true)

    expect(withPrimes.metrics.tokensSpent).toBeGreaterThan(
      mainOnly.metrics.tokensSpent
    )
  })

  it('advances stages on combined main+prime HP, not main alone', () => {
    const mainOnly = runFixturePlan(false)
    const withPrimes = runFixturePlan(true)

    expect(withPrimes.metrics.bossesDefeated).toBeLessThan(
      mainOnly.metrics.bossesDefeated
    )
    expect(withPrimes.metrics.loopAdvances).toBeLessThan(
      mainOnly.metrics.loopAdvances
    )

    const actions = collectActions(withPrimes.sessions)
    const damagePerEncounter = new Map<string, number>()
    for (const a of actions) {
      const key = `${a.loopIndex}:${a.stageCode}:${a.encounterId}`
      damagePerEncounter.set(
        key,
        (damagePerEncounter.get(key) ?? 0) + a.appliedDamage
      )
    }
    const finalKeyPrefix = `${withPrimes.finalRaidState.loopIndex}:${withPrimes.finalRaidState.stageCode}:`
    const leftBehindMainKeys = [...damagePerEncounter.keys()].filter(
      (k) => k.endsWith(':0') && !k.startsWith(finalKeyPrefix)
    )
    expect(leftBehindMainKeys.length).toBeGreaterThan(0)
    for (const mainKey of leftBehindMainKeys) {
      const [loop, stage] = mainKey.split(':')
      expect(damagePerEncounter.get(`${loop}:${stage}:0`)).toBe(300)
      expect(damagePerEncounter.get(`${loop}:${stage}:1`)).toBe(150)
      expect(damagePerEncounter.get(`${loop}:${stage}:2`)).toBe(150)
    }
  })
})

describe('planSeason — combined gating + skip behaviour (controlled)', () => {
  const PROGRESSION: ProgressionConfig = {
    firstPassSequence: ['L1', 'L2'],
    loopSequence: ['L1', 'L2'],
    loopStartStage: 'L1',
    gameVersion: 'test'
  }
  const DAMAGE = 100

  function stage(code: string, prime1: number, prime2: number): StageTemplate {
    return {
      stageCode: code,
      encounters: {
        0: { bossName: `${code}_main`, maxHp: 100 },
        1: { bossName: `${code}_prime1`, maxHp: prime1 },
        2: { bossName: `${code}_prime2`, maxHp: prime2 }
      }
    }
  }

  function enc(id: EncounterId, code: string, maxHp: number) {
    return {
      encounterId: id,
      stageCode: code,
      loopIndex: 0,
      bossName: `${code}_${id}`,
      maxHp,
      remainingHp: maxHp
    }
  }

  function run(tokens: number) {
    const stageTemplates = [stage('L1', 100, 0), stage('L2', 100, 100)]
    const initial: RaidState = {
      stageCode: 'L1',
      loopIndex: 0,
      encounters: {
        0: enc(0, 'L1', 100),
        1: enc(1, 'L1', 100),
        2: enc(2, 'L1', 0)
      }
    }
    const player: PlannerPlayer = {
      playerId: 'solo',
      displayName: 'Solo',
      sessionsAt: [MS0],
      tokenState: { available: tokens, nextRegenAt: null }
    }
    return planSeason({
      players: [player],
      initialRaidState: initial,
      stageTemplates,
      options: {
        snapshotAt: MS0,
        seasonEndAt: MS0 + 86_400_000,
        stamina: {
          max: tokens,
          regenerationSeconds: 10 ** 9,
          amountPerTick: 1
        },
        optionalSpendMinHpMultiplier: 0,
        seasonMaxTokens: 1000
      },
      estimateDamage: () => DAMAGE,
      progressionConfig: PROGRESSION
    })
  }

  it('does NOT advance when only the main is cleared (prime still alive)', () => {
    const plan = run(1) // one token → clears L1 main only
    expect(plan.finalRaidState.stageCode).toBe('L1')
    expect(plan.finalRaidState.encounters[0].remainingHp).toBe(0) // main down
    expect(plan.finalRaidState.encounters[1].remainingHp).toBe(100) // prime alive
    expect(plan.metrics.bossesDefeated).toBe(0) // no stage advance
  })

  it('spends the second token on the surviving prime, not the next stage main', () => {
    const plan = run(2)
    const actions0 = plan.sessions[0]!.actions
    const first = actions0[0]!
    const second = actions0[1]!
    expect(first.stageCode).toBe('L1')
    expect(first.encounterId).toBe(0) // main first
    expect(second.stageCode).toBe('L1')
    expect(second.encounterId).toBe(1) // then the same stage's prime — NOT L2
  })

  it('never books a token into a skipped side (prime maxHp 0)', () => {
    const plan = run(5)
    const actions = plan.sessions[0]!.actions
    const skippedHits = actions.filter(
      (a) => a.stageCode === 'L1' && a.encounterId === 2
    )
    expect(skippedHits.length).toBe(0)
    expect(actions.some((a) => a.stageCode === 'L2')).toBe(true)
    expect(plan.metrics.bossesDefeated).toBeGreaterThanOrEqual(1)
  })

  it('deals the modelled damage per token (sanity)', () => {
    const plan = run(1)
    expect(plan.sessions[0]!.actions[0]!.expectedDamage).toBe(DAMAGE)
    expect(PER_TOKEN_DAMAGE).toBe(50)
  })
})

/** A stage cleared by the cap-hitting token still advances; a lazy advance under-counts. */
describe('planSeason — cap-boundary eager advance (intended divergence)', () => {
  const PROGRESSION: ProgressionConfig = {
    firstPassSequence: ['L1', 'L2'],
    loopSequence: ['L1', 'L2'],
    loopStartStage: 'L1',
    gameVersion: 'test'
  }

  function tmpl(code: string): StageTemplate {
    return {
      stageCode: code,
      encounters: {
        0: { bossName: `${code}_main`, maxHp: 100 },
        1: { bossName: `${code}_prime1`, maxHp: 0 },
        2: { bossName: `${code}_prime2`, maxHp: 0 }
      }
    }
  }

  it('advances past a stage cleared on the exact token that hits the season cap', () => {
    const initial: RaidState = {
      stageCode: 'L1',
      loopIndex: 0,
      encounters: {
        0: {
          encounterId: 0,
          stageCode: 'L1',
          loopIndex: 0,
          bossName: 'L1_main',
          maxHp: 100,
          remainingHp: 100
        },
        1: {
          encounterId: 1,
          stageCode: 'L1',
          loopIndex: 0,
          bossName: 'L1_prime1',
          maxHp: 0,
          remainingHp: 0
        },
        2: {
          encounterId: 2,
          stageCode: 'L1',
          loopIndex: 0,
          bossName: 'L1_prime2',
          maxHp: 0,
          remainingHp: 0
        }
      }
    }
    const plan = planSeason({
      players: [
        {
          playerId: 'solo',
          displayName: 'Solo',
          sessionsAt: [MS0],
          tokenState: { available: 2, nextRegenAt: null }
        }
      ],
      initialRaidState: initial,
      stageTemplates: [tmpl('L1'), tmpl('L2')],
      options: {
        snapshotAt: MS0,
        seasonEndAt: MS0 + 86_400_000,
        stamina: { max: 3, regenerationSeconds: 10 ** 9, amountPerTick: 1 },
        optionalSpendMinHpMultiplier: 0,
        seasonMaxTokens: 1 // cap hits exactly as L1's main clears
      },
      estimateDamage: () => 100,
      progressionConfig: PROGRESSION
    })

    expect(plan.metrics.tokensSpent).toBe(1)
    expect(plan.sessions[0]!.actions).toHaveLength(1)
    expect(plan.sessions[0]!.actions[0]!.stageCode).toBe('L1')
    expect(plan.metrics.bossesDefeated).toBe(1)
    expect(plan.finalRaidState.stageCode).toBe('L2')
    expect(plan.finalRaidState.encounters[0].remainingHp).toBe(100) // fresh L2 main
  })
})

describe('planSeason — officer-skipped prime from the sequence seam', () => {
  const PROGRESSION: ProgressionConfig = {
    firstPassSequence: ['L1', 'L2'],
    loopSequence: ['L1', 'L2'],
    loopStartStage: 'L1',
    gameVersion: 'test'
  }

  const seasonBosses: SeasonBoss[] = [
    {
      boss_type: 'TestBossL1',
      boss_name: 'TestBossL1',
      set: 0,
      encounter_id: 0,
      rarity: 'Legendary',
      canonical: 'TestBossL1'
    },
    {
      boss_type: 'Avatar',
      boss_name: 'Avatar',
      set: 0,
      encounter_id: 1,
      rarity: 'Legendary',
      canonical: 'Avatar'
    },
    {
      boss_type: 'Avatar',
      boss_name: 'Avatar',
      set: 0,
      encounter_id: 2,
      rarity: 'Legendary',
      canonical: 'Avatar'
    },
    {
      boss_type: 'TestBossL2',
      boss_name: 'TestBossL2',
      set: 1,
      encounter_id: 0,
      rarity: 'Legendary',
      canonical: 'TestBossL2'
    }
  ]
  const bossHpData: BossHpData = {
    legendary: { L1: 100, L2: 100 },
    mythic: {},
    primes: { Avatar_L1: 100, Avatar_prime2_L1: 100 },
    byBossName: {}
  }

  it('books zero tokens against the skipped prime and still advances the stage', () => {
    const sequence = computeRemainingBossSequence({
      progressionConfig: PROGRESSION,
      currentStageCode: 'L1',
      currentLoopIndex: 0,
      seasonBosses,
      bossHpData,
      guildAvgDamage: 100,
      maxStages: 2,
      skippedPrimes: new Map([['L1', new Set<1 | 2>([2])]])
    })

    expect(sequence[0]!.encounters.prime2).toMatchObject({
      maxHp: 0,
      remainingHp: 0,
      skipped: true
    })
    expect(sequence[0]!.encounters.prime1!.maxHp).toBe(100)

    const stageTemplates: StageTemplate[] = sequence.map((entry) => ({
      stageCode: entry.stageCode,
      encounters: {
        0: {
          bossName: entry.encounters.main.bossName,
          maxHp: entry.encounters.main.maxHp
        },
        1: {
          bossName:
            entry.encounters.prime1?.bossName ??
            `${entry.encounters.main.bossName}_Prime1`,
          maxHp: entry.encounters.prime1?.maxHp ?? 0
        },
        2: {
          bossName:
            entry.encounters.prime2?.bossName ??
            `${entry.encounters.main.bossName}_Prime2`,
          maxHp: entry.encounters.prime2?.maxHp ?? 0
        }
      }
    }))
    const current = sequence[0]!
    const initial: RaidState = {
      stageCode: current.stageCode,
      loopIndex: 0,
      encounters: {
        0: {
          encounterId: 0,
          stageCode: current.stageCode,
          loopIndex: 0,
          bossName: current.encounters.main.bossName,
          maxHp: current.encounters.main.maxHp,
          remainingHp: current.encounters.main.remainingHp
        },
        1: {
          encounterId: 1,
          stageCode: current.stageCode,
          loopIndex: 0,
          bossName: current.encounters.prime1!.bossName,
          maxHp: current.encounters.prime1!.maxHp,
          remainingHp: current.encounters.prime1!.remainingHp
        },
        2: {
          encounterId: 2,
          stageCode: current.stageCode,
          loopIndex: 0,
          bossName: current.encounters.prime2!.bossName,
          maxHp: current.encounters.prime2!.maxHp,
          remainingHp: current.encounters.prime2!.remainingHp
        }
      }
    }

    const plan = planSeason({
      players: [
        {
          playerId: 'solo',
          displayName: 'Solo',
          sessionsAt: [MS0],
          tokenState: { available: 4, nextRegenAt: null }
        }
      ],
      initialRaidState: initial,
      stageTemplates,
      options: {
        snapshotAt: MS0,
        seasonEndAt: MS0 + 86_400_000,
        stamina: { max: 4, regenerationSeconds: 10 ** 9, amountPerTick: 1 },
        optionalSpendMinHpMultiplier: 0,
        seasonMaxTokens: 1000
      },
      estimateDamage: () => 100,
      progressionConfig: PROGRESSION
    })

    const actions = plan.sessions.flatMap((s) => s.actions)
    expect(actions.filter((a) => a.encounterId === 2)).toHaveLength(0)
    expect(
      actions.some((a) => a.stageCode === 'L1' && a.encounterId === 1)
    ).toBe(true)
    expect(actions.some((a) => a.stageCode === 'L2')).toBe(true)
  })
})
