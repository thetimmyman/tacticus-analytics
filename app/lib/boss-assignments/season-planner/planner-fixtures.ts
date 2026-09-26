import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'
import {
  planSeason,
  type EncounterId,
  type PlannerPlayer,
  type PlannerResult,
  type RaidState,
  type StageTemplate
} from '@/app/lib/boss-assignments/season-planner/planner-engine'
import type { StaminaSettings } from '@/app/lib/boss-assignments/season-planner/stamina-simulator'
import type { GeneratedSeasonPlanPayload } from '@/app/lib/boss-assignments/season-planner/generate-season-plan'
import type { BossStageEntry } from '@/app/lib/boss-assignments/season-sequence'

export const MS0 = Date.UTC(2026, 0, 1, 0, 0, 0)
const TWELVE_H_MS = 12 * 60 * 60 * 1000
const SEASON_DAYS = 10
const SEASON_END_AT = MS0 + SEASON_DAYS * 86_400_000

export const FIXTURE_STAMINA: StaminaSettings = {
  max: 3,
  regenerationSeconds: 12 * 60 * 60,
  amountPerTick: 1
}

/** Loops on itself so tokens, not template exhaustion, are the limit. */
export const FIXTURE_PROGRESSION: ProgressionConfig = {
  firstPassSequence: ['L1', 'L2', 'L3'],
  loopSequence: ['L1', 'L2', 'L3'],
  loopStartStage: 'L1',
  gameVersion: 'test'
}

const MAIN_HP = 300
const PRIME_HP = 150
/** main = 6 tokens, each prime = 3 tokens. */
export const PER_TOKEN_DAMAGE = 50

const makeSessions = (
  count: number,
  startMs: number,
  stepMs: number
): number[] => Array.from({ length: count }, (_, i) => startMs + i * stepMs)

export function buildPlayers(): PlannerPlayer[] {
  const sessionsAt = makeSessions(SEASON_DAYS * 2, MS0, TWELVE_H_MS)
  return [
    {
      playerId: 'p1',
      displayName: 'Player One',
      sessionsAt: [...sessionsAt],
      tokenState: { available: 3, nextRegenAt: MS0 + TWELVE_H_MS }
    },
    {
      playerId: 'p2',
      displayName: 'Player Two',
      sessionsAt: [...sessionsAt],
      tokenState: { available: 3, nextRegenAt: MS0 + TWELVE_H_MS }
    }
  ]
}

export function buildStageTemplates(withPrimes: boolean): StageTemplate[] {
  const mk = (code: string): StageTemplate => ({
    stageCode: code,
    encounters: {
      0: { bossName: `${code}_main`, maxHp: MAIN_HP },
      1: { bossName: `${code}_prime1`, maxHp: withPrimes ? PRIME_HP : 0 },
      2: { bossName: `${code}_prime2`, maxHp: withPrimes ? PRIME_HP : 0 }
    }
  })
  return ['L1', 'L2', 'L3'].map(mk)
}

export function buildInitialRaidState(withPrimes: boolean): RaidState {
  const enc = (encounterId: EncounterId, bossName: string, maxHp: number) => ({
    encounterId,
    stageCode: 'L1',
    loopIndex: 0,
    bossName,
    maxHp,
    remainingHp: maxHp
  })
  return {
    stageCode: 'L1',
    loopIndex: 0,
    encounters: {
      0: enc(0, 'L1_main', MAIN_HP),
      1: enc(1, 'L1_prime1', withPrimes ? PRIME_HP : 0),
      2: enc(2, 'L1_prime2', withPrimes ? PRIME_HP : 0)
    }
  }
}

export const constantDamage = () => PER_TOKEN_DAMAGE

export function runFixturePlan(withPrimes: boolean): PlannerResult {
  return planSeason({
    players: buildPlayers(),
    initialRaidState: buildInitialRaidState(withPrimes),
    stageTemplates: buildStageTemplates(withPrimes),
    options: {
      snapshotAt: MS0,
      seasonEndAt: SEASON_END_AT,
      stamina: FIXTURE_STAMINA,
      optionalSpendMinHpMultiplier: 1.25
    },
    estimateDamage: constantDamage,
    progressionConfig: FIXTURE_PROGRESSION
  })
}

export function buildOutlookPayload(
  plan: PlannerResult,
  overrides?: Partial<GeneratedSeasonPlanPayload>
): GeneratedSeasonPlanPayload {
  const remainingBossSequence: BossStageEntry[] = ['L1', 'L2', 'L3'].map(
    (stageCode, i) => ({
      stageCode,
      loopIndex: 0,
      encounters: {
        main: {
          bossName: `${stageCode}_main`,
          bossType: `${stageCode}_main`,
          maxHp: MAIN_HP,
          remainingHp: MAIN_HP
        },
        prime1: {
          bossName: `${stageCode}_prime1`,
          bossType: `${stageCode}_prime1`,
          maxHp: PRIME_HP,
          remainingHp: PRIME_HP
        },
        prime2: {
          bossName: `${stageCode}_prime2`,
          bossType: `${stageCode}_prime2`,
          maxHp: PRIME_HP,
          remainingHp: PRIME_HP
        }
      },
      estimatedTokensNeeded: 12,
      difficulty: 'medium',
      isCurrentStage: i === 0
    })
  )

  return {
    season: '99',
    season_id: 'test_config',
    season_start_at: new Date(MS0).toISOString(),
    season_end_at: new Date(SEASON_END_AT).toISOString(),
    snapshot_at: new Date(MS0).toISOString(),
    time_zone: 'UTC',
    lookback_days: 30,
    sessions_per_day: 2,
    snapshot: {
      snapshotAt: new Date(MS0).toISOString(),
      guildCode: 'TEST',
      season: '99',
      seasonId: 'test_config',
      stageCode: 'L1',
      loopIndex: 0,
      advancedStage: false,
      encounters: {
        main: {
          encounterId: 0,
          targetUid: 'main',
          targetLabel: 'L1 Main',
          stageCode: 'L1',
          loopIndex: 0,
          bossName: 'L1_main',
          maxHp: MAIN_HP,
          remainingHp: MAIN_HP,
          seededFromMax: false,
          confidence: 'high'
        },
        prime1: {
          encounterId: 1,
          targetUid: 'prime1',
          targetLabel: 'L1 Prime 1',
          stageCode: 'L1',
          loopIndex: 0,
          bossName: 'L1_prime1',
          maxHp: PRIME_HP,
          remainingHp: PRIME_HP,
          seededFromMax: false,
          confidence: 'high'
        },
        prime2: {
          encounterId: 2,
          targetUid: 'prime2',
          targetLabel: 'L1 Prime 2',
          stageCode: 'L1',
          loopIndex: 0,
          bossName: 'L1_prime2',
          maxHp: PRIME_HP,
          remainingHp: PRIME_HP,
          seededFromMax: false,
          confidence: 'high'
        }
      },
      warnings: []
    },
    plan,
    remainingBossSequence,
    tokens_used_this_season: 40,
    tokens_remaining_spendable: 56,
    tokens_projected_waste: 0,
    players_at_cap_risk: 0,
    member_count: 12,
    ...overrides
  }
}
