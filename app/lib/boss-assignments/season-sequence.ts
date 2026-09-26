import type { ProgressionConfig } from '@/app/lib/boss-assignments/progression-config-shared'
import {
  getStageSequence,
  nextStage
} from '@/app/lib/boss-assignments/progression-config-shared'
import type { SeasonBoss } from '@/app/lib/loki/season-configs'
import { deriveStageCodeFromSetAndRarity } from '@/app/lib/boss-assignments/season-planner/snapshot-logic'
import {
  getMainBossMaxHp,
  getPrimeBossMaxHp,
  type BossHpData
} from '@/app/lib/boss-assignments/season-planner/boss-hp'

export interface BossEncounterEntry {
  bossName: string
  bossType: string
  maxHp: number
  remainingHp: number
  skipped?: boolean
  /** Officer target scaled to remaining HP, else the model estimate. */
  budgetTokens?: number
  budgetSource?: 'officer_target' | 'model_estimate'
  modelEstimateTokens?: number | null
}

export interface BossStageEntry {
  stageCode: string
  loopIndex: number
  encounters: {
    main: BossEncounterEntry
    prime1: BossEncounterEntry | null
    prime2: BossEncounterEntry | null
  }
  /** Model estimate, not the budget, so an aggressive officer target cannot soften difficulty. */
  estimatedTokensNeeded: number
  budgetTokensNeeded?: number
  /** Positive means the model expects more than the budget. */
  budgetVarianceTokens?: number
  difficulty: 'easy' | 'medium' | 'hard'
  isCurrentStage: boolean
}

function findBossForStage(
  bosses: SeasonBoss[],
  stageCode: string,
  encounterId: number
): SeasonBoss | undefined {
  return bosses.find(
    (boss) =>
      boss.encounter_id === encounterId &&
      deriveStageCodeFromSetAndRarity(
        boss.set ?? 0,
        boss.rarity ?? 'Legendary'
      ) === stageCode
  )
}

function resolveBossEncounter(
  bosses: SeasonBoss[],
  bossHpData: BossHpData,
  stageCode: string,
  encounterId: 0 | 1 | 2,
  remainingHpOverride?: number,
  skipped = false
): BossEncounterEntry | null {
  const boss = findBossForStage(bosses, stageCode, encounterId)
  if (!boss) return null

  const bossName = boss.canonical ?? boss.boss_name ?? `Unknown_${stageCode}`
  const bossType = boss.boss_type ?? bossName

  if (skipped) {
    return { bossName, bossType, maxHp: 0, remainingHp: 0, skipped: true }
  }

  let maxHp: number
  if (encounterId === 0) {
    maxHp = getMainBossMaxHp(bossHpData, bossName, stageCode) ?? 0
  } else {
    maxHp =
      getPrimeBossMaxHp(
        bossHpData,
        bossName,
        stageCode,
        encounterId as 1 | 2
      ) ?? 0
  }

  return {
    bossName,
    bossType,
    maxHp,
    remainingHp: remainingHpOverride ?? maxHp,
    skipped: false
  }
}

function classifyDifficulty(
  tokensEstimate: number,
  fullyEstimable: boolean
): 'easy' | 'medium' | 'hard' {
  if (!fullyEstimable) return 'hard'
  if (tokensEstimate <= 15) return 'easy'
  if (tokensEstimate <= 40) return 'medium'
  return 'hard'
}

export interface CurrentStageHp {
  mainRemainingHp: number
  prime1RemainingHp?: number
  prime2RemainingHp?: number
}

/** Per-encounter damage divisors avoid main/prime blended-mean bias. */
export function computeRemainingBossSequence(args: {
  progressionConfig: ProgressionConfig
  currentStageCode: string
  currentLoopIndex: number
  seasonBosses: SeasonBoss[]
  bossHpData: BossHpData
  guildAvgDamage: number
  currentStageHp?: CurrentStageHp
  maxStages?: number
  skippedPrimes?: ReadonlyMap<string, ReadonlySet<1 | 2>>
  encounterDamagePerToken?: (target: {
    stageCode: string
    encounterId: 0 | 1 | 2
    bossName: string
  }) => number | null
  officerTargets?: ReadonlyMap<string, ReadonlyMap<0 | 1 | 2, number>>
}): BossStageEntry[] {
  const {
    progressionConfig,
    currentStageCode,
    currentLoopIndex,
    seasonBosses,
    bossHpData,
    guildAvgDamage,
    currentStageHp,
    maxStages = 50,
    skippedPrimes,
    encounterDamagePerToken,
    officerTargets
  } = args

  const emitBudgets = officerTargets !== undefined && officerTargets.size > 0

  const result: BossStageEntry[] = []
  let stageCode = currentStageCode
  let loopIndex = currentLoopIndex

  for (let i = 0; i < maxStages; i++) {
    const isCurrentStage = i === 0

    const mainOverride = isCurrentStage
      ? currentStageHp?.mainRemainingHp
      : undefined
    const prime1Override = isCurrentStage
      ? currentStageHp?.prime1RemainingHp
      : undefined
    const prime2Override = isCurrentStage
      ? currentStageHp?.prime2RemainingHp
      : undefined

    const stageSkips = skippedPrimes?.get(stageCode)

    const main = resolveBossEncounter(
      seasonBosses,
      bossHpData,
      stageCode,
      0,
      mainOverride
    )
    if (!main) break // No boss data for this stage — stop

    const prime1 = resolveBossEncounter(
      seasonBosses,
      bossHpData,
      stageCode,
      1,
      prime1Override,
      stageSkips?.has(1) ?? false
    )
    const prime2 = resolveBossEncounter(
      seasonBosses,
      bossHpData,
      stageCode,
      2,
      prime2Override,
      stageSkips?.has(2) ?? false
    )

    const liveEncounters: Array<{
      encounter: BossEncounterEntry
      encounterId: 0 | 1 | 2
    }> = []
    for (const [encounter, encounterId] of [
      [main, 0],
      [prime1, 1],
      [prime2, 2]
    ] as Array<[BossEncounterEntry | null, 0 | 1 | 2]>) {
      if (encounter && encounter.maxHp > 0 && encounter.remainingHp > 0) {
        liveEncounters.push({ encounter, encounterId })
      }
    }

    const stageTargets = emitBudgets
      ? officerTargets?.get(stageCode)
      : undefined

    let estimatedTokensNeeded = 0
    let fullyEstimable = true
    let budgetTokensNeeded = 0
    let budgetVarianceTokens = 0
    let varianceObserved = false
    for (const { encounter, encounterId } of liveEncounters) {
      const rosterDamagePerToken = encounterDamagePerToken?.({
        stageCode,
        encounterId,
        bossName: encounter.bossName
      })
      const divisor =
        typeof rosterDamagePerToken === 'number' && rosterDamagePerToken > 0
          ? rosterDamagePerToken
          : guildAvgDamage
      const modelEstimate =
        divisor > 0 ? Math.ceil(encounter.remainingHp / divisor) : null
      if (modelEstimate !== null) {
        estimatedTokensNeeded += modelEstimate
      } else {
        fullyEstimable = false
      }

      if (!emitBudgets) continue

      const rawTarget = stageTargets?.get(encounterId)
      encounter.modelEstimateTokens = modelEstimate
      if (typeof rawTarget === 'number' && rawTarget > 0) {
        // Clamp so a glitched remainingHp > maxHp cannot exceed the target.
        const scaledTarget = Math.ceil(
          rawTarget * Math.min(1, encounter.remainingHp / encounter.maxHp)
        )
        encounter.budgetTokens = scaledTarget
        encounter.budgetSource = 'officer_target'
        budgetTokensNeeded += scaledTarget
        if (modelEstimate !== null) {
          budgetVarianceTokens += modelEstimate - scaledTarget
          varianceObserved = true
        }
      } else if (modelEstimate !== null) {
        encounter.budgetTokens = modelEstimate
        encounter.budgetSource = 'model_estimate'
        budgetTokensNeeded += modelEstimate
      }
    }

    result.push({
      stageCode,
      loopIndex,
      encounters: { main, prime1, prime2 },
      estimatedTokensNeeded,
      ...(emitBudgets
        ? {
            budgetTokensNeeded,
            ...(varianceObserved ? { budgetVarianceTokens } : {})
          }
        : {}),
      difficulty: classifyDifficulty(estimatedTokensNeeded, fullyEstimable),
      isCurrentStage
    })

    const next = nextStage(progressionConfig, stageCode, loopIndex)
    stageCode = next.stageCode
    loopIndex = next.loopIndex

    const sequence = getStageSequence(progressionConfig, loopIndex)
    if (!sequence.includes(stageCode)) break
  }

  return result
}
