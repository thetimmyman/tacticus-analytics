import {
  getRarityPrefix,
  normalizeRarity
} from '@tacticus/app-core/rarity-utils'
import {
  getStageSequence,
  nextStage as nextStageFromConfig,
  type ProgressionConfig
} from '@/app/lib/boss-assignments/progression-config-shared'

export interface MainEncounterStageInput {
  rarity: string | null
  set: number | null
  loopIndex: number | null
  remainingHp: number | null
}

const toNonNegativeInt = (value: unknown, fallback = 0): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback
  }
  return Math.max(0, Math.trunc(value))
}

const toNonNegativeHp = (value: unknown, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return fallback
  }
  return value
}

export function deriveStageCodeFromSetAndRarity(
  set: number,
  rarity: string
): string {
  const normalized = normalizeRarity(rarity) ?? 'Legendary'
  const prefix = getRarityPrefix(normalized) ?? 'L'
  return `${prefix}${Math.max(0, Math.trunc(set)) + 1}`
}

export function deriveRarityAndSetFromStageCode(stageCode: string): {
  rarity: 'Legendary' | 'Mythic'
  set: number
} | null {
  if (!stageCode || stageCode.length < 2) return null
  const prefix = stageCode[0]?.toUpperCase()
  const stageNum = Number.parseInt(stageCode.slice(1), 10)
  if (!Number.isFinite(stageNum) || stageNum <= 0) return null

  if (prefix !== 'L' && prefix !== 'M') return null

  return {
    rarity: prefix === 'M' ? 'Mythic' : 'Legendary',
    set: stageNum - 1
  }
}

function nextStage(
  stageCode: string,
  loopIndex: number,
  config: ProgressionConfig
): { stageCode: string; wrapsLoop: boolean; loopIndex: number } {
  return nextStageFromConfig(config, stageCode, loopIndex)
}

export function computeStageFromMainEncounter(
  main: MainEncounterStageInput | null,
  config: ProgressionConfig
): { stageCode: string; loopIndex: number; advancedStage: boolean } {
  const baseLoopIndex = toNonNegativeInt(main?.loopIndex, 0)
  const sequence = getStageSequence(config, baseLoopIndex)
  const firstStage = sequence[0]
  if (!firstStage) {
    throw new Error(`Progression sequence is empty for loop ${baseLoopIndex}`)
  }

  let stageCode =
    main?.rarity && typeof main.set === 'number'
      ? deriveStageCodeFromSetAndRarity(main.set, main.rarity)
      : firstStage

  let loopIndex = baseLoopIndex
  let advancedStage = false

  const mainRemaining = toNonNegativeHp(main?.remainingHp, 0)
  if (main && mainRemaining === 0) {
    const advanced = nextStage(stageCode, loopIndex, config)
    stageCode = advanced.stageCode
    loopIndex = advanced.loopIndex
    advancedStage = true
  }

  return { stageCode, loopIndex, advancedStage }
}
