export interface ProgressionConfig {
  firstPassSequence: string[]
  loopSequence: string[]
  loopStartStage: string
  gameVersion: string | null
}

// Loop policy is per season (`loopFromTier`/`loopFromSet`), not global or date-based.

const LADDER_TIER_PREFIX: Readonly<Record<number, string>> = { 4: 'L', 5: 'M' }

export interface SeasonLoopPolicy {
  /** 4 = Legendary, 5 = Mythic. */
  loopFromTier: number
  loopFromSet: number
  /** Snapshot predates the fields, so the value was assumed rather than given. */
  defaulted: boolean
}

/** Seasons captured before the fields existed all looped the full ladder from L1. */
export const DEFAULT_SEASON_LOOP_POLICY: SeasonLoopPolicy = {
  loopFromTier: 4,
  loopFromSet: 0,
  defaulted: true
}

export function resolveSeasonLoopPolicy(
  raw?: {
    loopFromTier?: number | string | null
    loopFromSet?: number | string | null
  } | null
): SeasonLoopPolicy {
  // The game ships strings ("4"); a strict number check would default to L1.
  const tier = numeric(raw?.loopFromTier)
  const set = numeric(raw?.loopFromSet)
  if (tier === null && set === null) return DEFAULT_SEASON_LOOP_POLICY
  return {
    loopFromTier: tier ?? DEFAULT_SEASON_LOOP_POLICY.loopFromTier,
    loopFromSet: set ?? DEFAULT_SEASON_LOOP_POLICY.loopFromSet,
    defaulted: tier === null || set === null
  }
}

function numeric(value: number | string | null | undefined): number | null {
  if (typeof value === 'number')
    return Number.isFinite(value) ? Math.trunc(value) : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? Math.trunc(n) : null
  }
  return null
}

export function stageCodeFromTierAndSet(
  tierIndex: number,
  set: number
): string | null {
  const prefix = LADDER_TIER_PREFIX[tierIndex]
  if (!prefix || !Number.isFinite(set) || set < 0) return null
  return `${prefix}${Math.trunc(set) + 1}`
}

/** Only Legendary/Mythic sets with a main boss (encounterIndex 0) are stages. */
export function ladderStagesFromEncounters(
  encounters: ReadonlyArray<{
    rarityIndex?: number | null
    set?: number | null
    encounterIndex?: number | null
  }>
): string[] {
  const seen = new Map<string, { tier: number; set: number }>()
  for (const e of encounters) {
    if (e?.encounterIndex !== 0) continue
    const tier = e?.rarityIndex
    const set = e?.set
    if (typeof tier !== 'number' || typeof set !== 'number') continue
    const code = stageCodeFromTierAndSet(tier, set)
    if (!code || seen.has(code)) continue
    seen.set(code, { tier, set })
  }
  return Array.from(seen.entries())
    .sort(([, a], [, b]) =>
      a.tier !== b.tier ? a.tier - b.tier : a.set - b.set
    )
    .map(([code]) => code)
}

/** A missing ladder or loop-start stage is invalid: guessing would reinstate an older policy. */
export function deriveProgressionConfig(args: {
  stages: readonly string[]
  policy: SeasonLoopPolicy
  gameVersion?: string | null
}): ProgressionConfig {
  const { stages, policy, gameVersion = null } = args
  const ladder = [...stages]
  if (ladder.length === 0) {
    throw new Error('Cannot derive progression config from an empty ladder')
  }
  const loopStart = stageCodeFromTierAndSet(
    policy.loopFromTier,
    policy.loopFromSet
  )
  if (!loopStart) {
    throw new Error(
      'Progression loop policy does not name a valid ladder stage'
    )
  }
  const startIdx = ladder.indexOf(loopStart)
  if (startIdx < 0) {
    throw new Error(
      `Progression loop start ${loopStart} is absent from the season ladder`
    )
  }
  const loopSequence = ladder.slice(startIdx)
  return {
    firstPassSequence: ladder,
    loopSequence,
    loopStartStage: loopStart,
    gameVersion
  }
}

export function getStageSequence(
  config: ProgressionConfig,
  loopIndex: number
): readonly string[] {
  return loopIndex === 0 ? config.firstPassSequence : config.loopSequence
}

export function nextStage(
  config: ProgressionConfig,
  stageCode: string,
  loopIndex: number
): { stageCode: string; loopIndex: number; wrapsLoop: boolean } {
  const sequence = getStageSequence(config, loopIndex)
  if (sequence.length === 0) {
    throw new Error(`Progression sequence is empty for loop ${loopIndex}`)
  }
  const idx = sequence.indexOf(stageCode)

  if (idx < 0) {
    throw new Error(
      `Stage ${stageCode} is absent from the progression sequence for loop ${loopIndex}`
    )
  }

  const isLastInSequence = idx === sequence.length - 1

  if (isLastInSequence) {
    const nextLoopIndex = loopIndex + 1
    const nextSequence = getStageSequence(config, nextLoopIndex)
    if (nextSequence.length === 0) {
      throw new Error(`Progression sequence is empty for loop ${nextLoopIndex}`)
    }
    return {
      stageCode: nextSequence[0]!,
      loopIndex: nextLoopIndex,
      wrapsLoop: true
    }
  }

  return {
    stageCode: sequence[idx + 1]!,
    loopIndex,
    wrapsLoop: false
  }
}
