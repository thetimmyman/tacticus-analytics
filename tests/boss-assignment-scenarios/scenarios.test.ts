import { describe, expect, it } from 'vitest'

import { orchestrateMultiStage } from '@/app/lib/boss-assignments/unified-orchestrator'
import {
  buildDamageModel,
  type DamageRecord
} from '@/app/lib/boss-assignments/season-planner/damage-model'
import { deriveRarityAndSetFromStageCode } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import type { ClassifiedPlayer } from '@/app/lib/boss-assignments/player-classifier'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'

import scenariosJson from '@/tests/boss-assignment-scenarios/scenarios.json'
import baselinesJson from '@/tests/boss-assignment-scenarios/baselines.json'

import guild25 from '@/tests/boss-assignment-scenarios/guild-fixtures/guild-25-members.json'
import guild26 from '@/tests/boss-assignment-scenarios/guild-fixtures/guild-26-members.json'
import guild27 from '@/tests/boss-assignment-scenarios/guild-fixtures/guild-27-members.json'
import guild28 from '@/tests/boss-assignment-scenarios/guild-fixtures/guild-28-members.json'
import guild29 from '@/tests/boss-assignment-scenarios/guild-fixtures/guild-29-members.json'
import guild30 from '@/tests/boss-assignment-scenarios/guild-fixtures/guild-30-members.json'

/** Baselines used another token-cap regime, so this checks flow invariants, not exact allocations. */

// MAX_TOKENS_PER_PLAYER_PER_BOSS; exceeding it is a regression.
const EXPECTED_EDGE_CAP = 3

const REFERENCE_AT = '2026-01-23T00:00:00.000Z'
const RECENT_BATTLE = '2026-01-20T00:00:00.000Z'

type FixtureMember = {
  playerId: string
  displayName: string
  availableTokens: number
  performanceData: Record<
    string,
    { average_damage: number; player_vs_guild_avg: number }
  >
}

type GuildFixture = {
  id: string
  guildSize: number
  members: FixtureMember[]
}

type ScenarioBoss = {
  id: string
  bossType: string
  level: string
  isPrime: boolean
  hp: number
  requiredTokens: number
  rarity?: string
}

type Scenario = {
  id: string
  name: string
  guildFixture: string
  bosses: ScenarioBoss[]
  constraints: { maxTokensPerPlayer: number }
}

type Baseline = {
  scenarioId: string
  expectedCoverage: Record<
    string,
    { allocated: number; required: number; percent: number }
  >
}

const fixtures: Record<string, GuildFixture> = {
  'guild-25-members': guild25 as unknown as GuildFixture,
  'guild-26-members': guild26 as unknown as GuildFixture,
  'guild-27-members': guild27 as unknown as GuildFixture,
  'guild-28-members': guild28 as unknown as GuildFixture,
  'guild-29-members': guild29 as unknown as GuildFixture,
  'guild-30-members': guild30 as unknown as GuildFixture
}

const allScenarios = (scenariosJson as { scenarios: Scenario[] }).scenarios
const baselines = baselinesJson as unknown as Record<string, Baseline>

function buildModelFromFixture(fixture: GuildFixture) {
  const records: DamageRecord[] = []
  for (const member of fixture.members) {
    for (const [bossId, perf] of Object.entries(member.performanceData)) {
      const spaceIdx = bossId.indexOf(' ')
      if (spaceIdx < 0) continue
      const level = bossId.slice(0, spaceIdx)
      const bossType = bossId.slice(spaceIdx + 1)
      const ras = deriveRarityAndSetFromStageCode(level)
      if (!ras) continue
      if (!(perf.average_damage > 0)) continue
      records.push({
        playerId: member.playerId,
        bossName: bossType,
        encounterId: 0,
        rarity: ras.rarity,
        set: ras.set,
        startedOn: RECENT_BATTLE,
        damageDealt: perf.average_damage
      })
    }
  }
  return buildDamageModel(records, { referenceAt: REFERENCE_AT })
}

function classifiedPlayersFromFixture(
  fixture: GuildFixture
): ClassifiedPlayer[] {
  return fixture.members.map((member) => ({
    playerId: member.playerId,
    displayName: member.displayName,
    tier: 'mid' as const,
    overallAvgDamage: 0,
    avgDamageByStage: {}
  }))
}

function playerTokensFromFixture(
  fixture: GuildFixture
): Record<string, number> {
  const tokens: Record<string, number> = {}
  for (const member of fixture.members) {
    tokens[member.playerId] = member.availableTokens
  }
  return tokens
}

function bossSequenceFromScenario(scenario: Scenario): BossStageEntry[] {
  const byStage = new Map<string, BossStageEntry>()
  const order: string[] = []

  for (const boss of scenario.bosses) {
    if (!byStage.has(boss.level)) {
      order.push(boss.level)
      byStage.set(boss.level, {
        stageCode: boss.level,
        loopIndex: 0,
        difficulty: 'medium',
        estimatedTokensNeeded: 0,
        isCurrentStage: order.length === 1,
        encounters: { main: null as never, prime1: null, prime2: null }
      })
    }
    const stage = byStage.get(boss.level)!
    const enc = {
      bossName: boss.bossType,
      bossType: boss.bossType,
      maxHp: boss.hp,
      remainingHp: boss.hp
    }
    if (boss.isPrime) {
      if (!stage.encounters.prime1) stage.encounters.prime1 = enc
      else stage.encounters.prime2 = enc
    } else {
      stage.encounters.main = enc
    }
  }

  return order
    .map((code) => byStage.get(code)!)
    .filter((stage) => stage.encounters.main != null)
}

function runScenario(scenario: Scenario) {
  const fixture = fixtures[scenario.guildFixture]
  if (!fixture) return null
  const damageModel = buildModelFromFixture(fixture)
  const players = classifiedPlayersFromFixture(fixture)
  const playerTokens = playerTokensFromFixture(fixture)
  const bossSequence = bossSequenceFromScenario(scenario)
  if (bossSequence.length === 0) return null
  const result = orchestrateMultiStage({
    players,
    playerTokens,
    bossSequence,
    damageModel
  })
  return { fixture, result, bossSequence }
}

const runnableScenarios = allScenarios.filter(
  (s) => fixtures[s.guildFixture] != null && s.bosses.some((b) => !b.isPrime)
)

describe('boss-assignment scenario corpus — real orchestrator', () => {
  it('has a non-trivial runnable corpus wired to the real orchestrator', () => {
    // Zero scenarios would make every invariant pass vacuously.
    expect(runnableScenarios.length).toBeGreaterThanOrEqual(5)
  })

  describe.each(runnableScenarios.map((s) => [s.id, s] as const))(
    'scenario %s',
    (_id, scenario) => {
      it('produces at least one stage assignment from real token supply', () => {
        const run = runScenario(scenario)
        expect(run).not.toBeNull()
        const { result } = run!
        const totalTokens = result.stageAssignments.reduce(
          (sum, sa) => sum + sa.assignments.reduce((s, a) => s + a.tokens, 0),
          0
        )
        expect(totalTokens).toBeGreaterThan(0)
        expect(result.metrics.totalTokensPlanned).toBe(totalTokens)
      })

      it('never routes more than the per-edge cap through one (player, boss)', () => {
        const run = runScenario(scenario)!
        const perEdge = new Map<string, number>()
        for (const sa of run.result.stageAssignments) {
          for (const a of sa.assignments) {
            const key = `${a.playerId}::${a.bossId}`
            perEdge.set(key, (perEdge.get(key) ?? 0) + a.tokens)
          }
        }
        expect(perEdge.size).toBeGreaterThan(0)
        for (const [, tokens] of perEdge) {
          expect(tokens).toBeLessThanOrEqual(EXPECTED_EDGE_CAP)
        }
      })

      it('never allocates a player more tokens than their bank across the season', () => {
        const run = runScenario(scenario)!
        const tokensByPlayer = playerTokensFromFixture(run.fixture)
        const allocated = new Map<string, number>()
        for (const sa of run.result.stageAssignments) {
          for (const a of sa.assignments) {
            allocated.set(
              a.playerId,
              (allocated.get(a.playerId) ?? 0) + a.tokens
            )
          }
        }
        expect(allocated.size).toBeGreaterThan(0)
        for (const [playerId, used] of allocated) {
          const bank = tokensByPlayer[playerId] ?? 0
          expect(
            used,
            `player ${playerId} over-spent (${used} > bank ${bank})`
          ).toBeLessThanOrEqual(bank)
        }
      })

      it('solves primes at or above main coverage within each stage (Tacticus rule)', () => {
        const run = runScenario(scenario)!
        let checkedAtLeastOnePrime = false
        for (const sa of run.result.stageAssignments) {
          const cov = sa.solverResult.coverage
          const main = cov[`${sa.stageCode}_main`]
          if (!main) continue
          for (const primeKey of [
            `${sa.stageCode}_prime1`,
            `${sa.stageCode}_prime2`
          ]) {
            const prime = cov[primeKey]
            if (!prime) continue
            checkedAtLeastOnePrime = true
            // Primes are rank 0 and pick first, so their coverage must be >= the main's.
            expect(
              prime.percentage,
              `${primeKey} below main coverage`
            ).toBeGreaterThanOrEqual(main.percentage - 1e-6)
          }
        }
        const hasPrime = run.bossSequence.some(
          (s) => s.encounters.prime1 != null || s.encounters.prime2 != null
        )
        if (hasPrime) expect(checkedAtLeastOnePrime).toBe(true)
      })

      it('coverage is internally consistent: assigned == Σ tokens, gap == required − assigned', () => {
        const run = runScenario(scenario)!
        let checked = 0
        for (const sa of run.result.stageAssignments) {
          for (const [bossId, cov] of Object.entries(
            sa.solverResult.coverage
          )) {
            const assignedFromEdges = sa.assignments
              .filter((a) => a.bossId === bossId)
              .reduce((sum, a) => sum + a.tokens, 0)
            expect(cov.assigned).toBe(assignedFromEdges)
            expect(cov.gap).toBe(Math.max(0, cov.required - cov.assigned))
            if (cov.required > 0) {
              expect(cov.percentage).toBeCloseTo(
                (cov.assigned / cov.required) * 100,
                4
              )
            }
            checked += 1
          }
        }
        expect(checked).toBeGreaterThan(0)
      })
    }
  )
})

describe('prime-before-main ordering on a real fixture (Tacticus rank rule)', () => {
  // The corpus has no co-located prime+main stages; flipping the PRIORITY_RANK_* constants must fail this.
  const fixture = fixtures['guild-30-members']!
  const damageModel = buildModelFromFixture(fixture)
  const players = classifiedPlayersFromFixture(fixture)
  const playerTokens = playerTokensFromFixture(fixture)

  const primeStageSequence: BossStageEntry[] = [
    {
      stageCode: 'M1',
      loopIndex: 0,
      difficulty: 'medium',
      estimatedTokensNeeded: 0,
      isCurrentStage: true,
      encounters: {
        main: {
          bossName: 'Mortarion',
          bossType: 'Mortarion',
          maxHp: 120_000_000,
          remainingHp: 120_000_000
        },
        prime1: {
          bossName: 'Rotbone',
          bossType: 'Rotbone',
          maxHp: 6_000_000,
          remainingHp: 6_000_000
        },
        prime2: {
          bossName: 'Corrodius',
          bossType: 'Corrodius',
          maxHp: 6_000_000,
          remainingHp: 6_000_000
        }
      }
    }
  ]

  it('lands both primes at or above main coverage with finite supply', () => {
    const result = orchestrateMultiStage({
      players,
      playerTokens,
      bossSequence: primeStageSequence,
      damageModel
    })

    expect(result.stageAssignments).toHaveLength(1)
    const stage = result.stageAssignments[0]!
    const main = stage.solverResult.coverage['M1_main']
    const prime1 = stage.solverResult.coverage['M1_prime1']
    const prime2 = stage.solverResult.coverage['M1_prime2']

    expect(main).toBeDefined()
    expect(prime1).toBeDefined()
    expect(prime2).toBeDefined()

    expect(main!.percentage).toBeLessThan(100)

    expect(prime1!.percentage).toBeGreaterThanOrEqual(main!.percentage - 1e-6)
    expect(prime2!.percentage).toBeGreaterThanOrEqual(main!.percentage - 1e-6)

    expect(prime1!.assigned + prime2!.assigned).toBeGreaterThan(0)
  })
})

describe('baseline demand-shape cross-check (real orchestrator vs captured baseline)', () => {
  // Qualitative only: an over-covered baseline boss must not come back fully starved.
  const mortarion30 = allScenarios.find((s) => s.id === 'mortarion-rotation-30')

  it('mortarion-rotation-30 baseline exists and is the cross-check anchor', () => {
    expect(mortarion30).toBeDefined()
    expect(baselines['mortarion-rotation-30']).toBeDefined()
  })

  it('does not fully starve a boss the baseline recorded as covered', () => {
    const scenario = mortarion30!
    const run = runScenario(scenario)!
    const baseline = baselines['mortarion-rotation-30']!

    let coveredAndChecked = 0
    for (const [baselineBossId, baseCov] of Object.entries(
      baseline.expectedCoverage
    )) {
      if (baseCov.allocated <= 0) continue
      const spaceIdx = baselineBossId.indexOf(' ')
      const level = baselineBossId.slice(0, spaceIdx)
      const stage = run.result.stageAssignments.find(
        (sa) => sa.stageCode === level
      )
      if (!stage) continue
      const cov = stage.solverResult.coverage[`${level}_main`]
      if (!cov) continue
      if (stage !== run.result.stageAssignments[0]) continue
      expect(
        cov.assigned,
        `${baselineBossId} fully starved by current engine`
      ).toBeGreaterThan(0)
      coveredAndChecked += 1
    }
    expect(coveredAndChecked).toBeGreaterThan(0)
  })
})
