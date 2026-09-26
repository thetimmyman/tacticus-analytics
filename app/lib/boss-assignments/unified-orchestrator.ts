import {
  solveAssignments,
  type SolverBoss,
  type SolverPlayer,
  type SolverResult,
  type Assignment
} from '@tacticus/solver-core'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'
import type { ClassifiedPlayer } from '@/app/lib/boss-assignments/player-classifier'
import type { DamageModel } from '@/app/lib/boss-assignments/season-planner/damage-model'
import { estimateDamage } from '@/app/lib/boss-assignments/season-planner/damage-model'
import { tokensAt } from '@/app/lib/boss-assignments/stage-timing'
import {
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'

export interface PlayerBudget {
  playerId: string
  displayName: string
  totalTokens: number
  allocated: number
  reserved: number
  available: number
}

export interface StageEncounterProjection {
  bossName: string
  startingHp: number
  projectedRemainingHp: number
  projectedDamage: number
  tokensPlanned: number
  isPrime: boolean
}

export interface StageTargetCapNote {
  bossId: string
  encounter: 'main' | 'prime1' | 'prime2'
  capTokens: number
  modelTokensNeeded: number
  shortfallTokens: number
}

export interface StageAssignment {
  stageCode: string
  loopIndex: number
  solverResult: SolverResult
  assignments: Assignment[]
  projections: {
    main: StageEncounterProjection
    prime1: StageEncounterProjection | null
    prime2: StageEncounterProjection | null
  }
  targetCaps?: StageTargetCapNote[]
}

export interface OrchestratorResult {
  stageAssignments: StageAssignment[]
  playerBudgets: Record<string, PlayerBudget>
  sequence: BossStageEntry[]
  warnings: string[]
  metrics: {
    totalTokensPlanned: number
    projectedStages: number
    strongPlayerReservationRate: number
  }
}

export interface OrchestratorOptions {
  minTokensPerBoss: number
  /** Fraction of strong players' tokens reserved for hard bosses. */
  strongReservationFraction: number
}

const DEFAULT_OPTIONS: OrchestratorOptions = {
  minTokensPerBoss: 2,
  strongReservationFraction: 0.4
}

// avgDamage is a mean; scale down so the plan still kills when attackers under-perform.
const KILL_ESTIMATE_PESSIMISM = 0.7

const PRIORITY_RANK_PRIME = 0
const PRIORITY_RANK_MAIN = 1

// Matches the in-game daily cap; stops one strong player absorbing a boss's whole requirement.
const MAX_TOKENS_PER_PLAYER_PER_BOSS = 3

/**
 * Backward pass reserves strong players' tokens for hard stages; forward pass
 * solves each stage with min-cost max-flow and deducts used tokens.
 */
export function orchestrateMultiStage(args: {
  players: ClassifiedPlayer[]
  playerTokens: Record<string, number>
  bossSequence: BossStageEntry[]
  damageModel: DamageModel
  options?: Partial<OrchestratorOptions>
  currentTokensByPlayer?: Record<string, number>
  stageStartSecondsByIndex?: ReadonlyArray<number>
}): OrchestratorResult {
  const { players, playerTokens, bossSequence, damageModel } = args
  const options = { ...DEFAULT_OPTIONS, ...args.options }
  const warnings: string[] = []
  const currentTokensByPlayer = args.currentTokensByPlayer
  const stageStartSecondsByIndex = args.stageStartSecondsByIndex
  const physicalCapEnabled = Boolean(
    currentTokensByPlayer && stageStartSecondsByIndex
  )

  if (bossSequence.length === 0 || players.length === 0) {
    return {
      stageAssignments: [],
      playerBudgets: {},
      sequence: bossSequence,
      warnings: ['No stages or players available for planning'],
      metrics: {
        totalTokensPlanned: 0,
        projectedStages: 0,
        strongPlayerReservationRate: 0
      }
    }
  }

  const budgets: Record<string, PlayerBudget> = {}
  for (const player of players) {
    const total = playerTokens[player.playerId] ?? 0
    budgets[player.playerId] = {
      playerId: player.playerId,
      displayName: player.displayName,
      totalTokens: total,
      allocated: 0,
      reserved: 0,
      available: total
    }
  }

  const strongPlayers = players.filter((p) => p.tier === 'strong')
  const hardStages = bossSequence.filter((s) => s.difficulty === 'hard')

  if (strongPlayers.length > 0 && hardStages.length > 0) {
    const reservationPerStage = Math.ceil(
      (strongPlayers.length * options.strongReservationFraction) /
        hardStages.length
    )

    for (const stage of hardStages) {
      const rankedForStage = [...strongPlayers].sort((a, b) => {
        const aDmg = a.avgDamageByStage[stage.stageCode] ?? a.overallAvgDamage
        const bDmg = b.avgDamageByStage[stage.stageCode] ?? b.overallAvgDamage
        return bDmg - aDmg
      })

      let reserved = 0
      for (const player of rankedForStage) {
        if (reserved >= reservationPerStage) break
        const budget = budgets[player.playerId]
        if (!budget || budget.available <= 0) continue

        const toReserve = Math.min(
          Math.ceil(budget.totalTokens * options.strongReservationFraction),
          budget.available
        )
        if (toReserve <= 0) continue

        budget.reserved += toReserve
        budget.available -= toReserve
        reserved += 1
      }
    }
  }

  const stageAssignments: StageAssignment[] = []
  let totalTokensPlanned = 0

  for (let stageIdx = 0; stageIdx < bossSequence.length; stageIdx++) {
    const stage = bossSequence[stageIdx]!
    const mainHp = stage.encounters.main.remainingHp
    if (mainHp <= 0) continue

    const stageStartSeconds = physicalCapEnabled
      ? (stageStartSecondsByIndex![stageIdx] ?? 0)
      : 0

    const solverPlayers: SolverPlayer[] = players
      .map((player) => {
        const budget = budgets[player.playerId]
        const available = budget?.available ?? 0
        const isHardStage = stage.difficulty === 'hard'
        const effectiveTokens = isHardStage
          ? available + (budget?.reserved ?? 0)
          : available

        let maxTokens = Math.max(0, effectiveTokens)
        if (physicalCapEnabled) {
          const currentTokens = currentTokensByPlayer![player.playerId] ?? 0
          const allocatedBefore = budget?.allocated ?? 0
          const physicalCap = tokensAt({
            currentTokens,
            allocatedBefore,
            elapsedSeconds: stageStartSeconds,
            maxTokens: MAX_TOKENS,
            regenSeconds: TWELVE_HOURS_IN_SECONDS
          })
          maxTokens = Math.min(maxTokens, physicalCap)
        }

        return {
          id: player.playerId,
          name: player.displayName,
          maxTokens
        }
      })
      .filter((p) => p.maxTokens > 0)

    const solverBosses: SolverBoss[] = []
    const targetCaps: StageTargetCapNote[] = []
    const encounters: Array<{
      enc: BossStageEntry['encounters']['main']
      id: string
      slot: 'main' | 'prime1' | 'prime2'
      isPrime: boolean
    }> = [
      {
        enc: stage.encounters.main,
        id: `${stage.stageCode}_main`,
        slot: 'main',
        isPrime: false
      },
      ...(stage.encounters.prime1 && stage.encounters.prime1.remainingHp > 0
        ? [
            {
              enc: stage.encounters.prime1,
              id: `${stage.stageCode}_prime1`,
              slot: 'prime1' as const,
              isPrime: true
            }
          ]
        : []),
      ...(stage.encounters.prime2 && stage.encounters.prime2.remainingHp > 0
        ? [
            {
              enc: stage.encounters.prime2,
              id: `${stage.stageCode}_prime2`,
              slot: 'prime2' as const,
              isPrime: true
            }
          ]
        : [])
    ]

    for (const { enc, id, slot, isPrime } of encounters) {
      if (enc.remainingHp <= 0) continue
      // Counting no-history players as zero inflates requiredTokens.
      let damageSum = 0
      let damageCount = 0
      for (const p of players) {
        const est = estimateDamage(damageModel, {
          playerId: p.playerId,
          bossName: enc.bossName,
          stageCode: stage.stageCode,
          encounterId: isPrime ? 1 : 0
        })
        if (est.expectedDamage != null && est.expectedDamage > 0) {
          damageSum += est.expectedDamage
          damageCount += 1
        }
      }
      const avgDamage = damageCount > 0 ? damageSum / damageCount : 0

      const conservativeAvgDamage = avgDamage * KILL_ESTIMATE_PESSIMISM
      const tokensNeeded =
        conservativeAvgDamage > 0
          ? Math.ceil(enc.remainingHp / conservativeAvgDamage)
          : options.minTokensPerBoss

      const modelRequiredTokens = Math.max(
        options.minTokensPerBoss,
        tokensNeeded
      )

      // Only officer targets cap the solver; officer intent beats the minimum.
      const officerCap =
        enc.budgetSource === 'officer_target' &&
        typeof enc.budgetTokens === 'number' &&
        enc.budgetTokens > 0
          ? Math.max(1, Math.trunc(enc.budgetTokens))
          : null

      const requiredTokens =
        officerCap !== null
          ? Math.min(modelRequiredTokens, officerCap)
          : modelRequiredTokens
      const minTokens =
        officerCap !== null
          ? Math.min(options.minTokensPerBoss, officerCap)
          : options.minTokensPerBoss
      const uncappedMaxTokens = Math.max(
        options.minTokensPerBoss,
        tokensNeeded * 2
      )
      const maxTokens =
        officerCap !== null
          ? Math.min(uncappedMaxTokens, officerCap)
          : uncappedMaxTokens

      if (officerCap !== null && officerCap < modelRequiredTokens) {
        targetCaps.push({
          bossId: id,
          encounter: slot,
          capTokens: officerCap,
          modelTokensNeeded: modelRequiredTokens,
          shortfallTokens: modelRequiredTokens - officerCap
        })
      }

      solverBosses.push({
        id,
        name: enc.bossName,
        level: stage.stageCode,
        isPrime,
        requiredTokens,
        minTokens,
        maxTokens,
        priorityRank: isPrime ? PRIORITY_RANK_PRIME : PRIORITY_RANK_MAIN,
        maxTokensPerPlayer: MAX_TOKENS_PER_PLAYER_PER_BOSS
      })
    }

    // Null must be absent (not zero) so the solver skips the edge.
    const scores: Record<string, Record<string, number | null>> = {}
    for (const player of players) {
      scores[player.playerId] = {}
      for (const boss of solverBosses) {
        const estimate = estimateDamage(damageModel, {
          playerId: player.playerId,
          bossName: boss.name,
          stageCode: stage.stageCode,
          encounterId: boss.isPrime ? 1 : 0
        })
        if (estimate.expectedDamage != null) {
          const playerScores = scores[player.playerId]
          if (playerScores) {
            playerScores[boss.id] = estimate.expectedDamage
          }
        }
      }
    }

    if (solverPlayers.length === 0 || solverBosses.length === 0) {
      warnings.push(
        `No players or bosses for stage ${stage.stageCode} loop ${stage.loopIndex}`
      )
      continue
    }

    const solverResult = solveAssignments({
      players: solverPlayers,
      bosses: solverBosses,
      scores
    })

    for (const assignment of solverResult.assignments) {
      const budget = budgets[assignment.playerId]
      if (!budget) continue

      const isHardStage = stage.difficulty === 'hard'
      if (isHardStage && budget.reserved > 0) {
        const fromReserved = Math.min(assignment.tokens, budget.reserved)
        budget.reserved -= fromReserved
        budget.allocated += fromReserved
        const fromAvailable = assignment.tokens - fromReserved
        budget.available -= fromAvailable
        budget.allocated += fromAvailable
      } else {
        budget.available -= assignment.tokens
        budget.allocated += assignment.tokens
      }

      totalTokensPlanned += assignment.tokens
    }

    const projectEncounter = (
      enc: { bossName: string; remainingHp: number } | null,
      solverBossId: string,
      isPrime: boolean
    ): StageEncounterProjection | null => {
      if (!enc || enc.remainingHp <= 0) return null
      const encAssignments = solverResult.assignments.filter(
        (a) => a.bossId === solverBossId
      )
      const projectedDamage = encAssignments.reduce(
        (sum, a) => sum + a.tokens * a.score,
        0
      )
      const tokensPlanned = encAssignments.reduce((sum, a) => sum + a.tokens, 0)
      return {
        bossName: enc.bossName,
        startingHp: enc.remainingHp,
        projectedRemainingHp: Math.max(0, enc.remainingHp - projectedDamage),
        projectedDamage,
        tokensPlanned,
        isPrime
      }
    }

    const projections = {
      main: projectEncounter(
        stage.encounters.main,
        `${stage.stageCode}_main`,
        false
      ) ?? {
        bossName: stage.encounters.main.bossName,
        startingHp: stage.encounters.main.remainingHp,
        projectedRemainingHp: stage.encounters.main.remainingHp,
        projectedDamage: 0,
        tokensPlanned: 0,
        isPrime: false
      },
      prime1: projectEncounter(
        stage.encounters.prime1,
        `${stage.stageCode}_prime1`,
        true
      ),
      prime2: projectEncounter(
        stage.encounters.prime2,
        `${stage.stageCode}_prime2`,
        true
      )
    }

    stageAssignments.push({
      stageCode: stage.stageCode,
      loopIndex: stage.loopIndex,
      solverResult,
      assignments: solverResult.assignments,
      projections,
      ...(targetCaps.length > 0 ? { targetCaps } : {})
    })
  }

  for (const budget of Object.values(budgets)) {
    if (budget.reserved > 0) {
      budget.available += budget.reserved
      budget.reserved = 0
    }
  }

  const strongTokensReserved = strongPlayers.reduce(
    (sum, p) => sum + (budgets[p.playerId]?.allocated ?? 0),
    0
  )
  const strongTokensTotal = strongPlayers.reduce(
    (sum, p) => sum + (budgets[p.playerId]?.totalTokens ?? 0),
    0
  )
  const strongPlayerReservationRate =
    strongTokensTotal > 0 ? strongTokensReserved / strongTokensTotal : 0

  return {
    stageAssignments,
    playerBudgets: budgets,
    sequence: bossSequence,
    warnings,
    metrics: {
      totalTokensPlanned,
      projectedStages: stageAssignments.length,
      strongPlayerReservationRate
    }
  }
}
