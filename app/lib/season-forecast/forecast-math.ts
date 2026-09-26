// Mirrors the `get_guild_season_forecast` RPC for client re-projection; change formulas in both places.

import {
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'

export const TOKEN_REGEN_SECONDS = TWELVE_HOURS_IN_SECONDS
export const SEASON_ACTIVE_SECONDS = 1_123_200 // 13 days

export interface PerPlayerComputeInput {
  tokensNow: number
  nextTokenSeconds: number
  /** Gates `will_cap` to players who have historically sat at the cap. */
  timeOverCapSeconds: number
}

export interface PerPlayerCompute {
  tokensWillRegen: number
  tokensAtSeasonEnd: number
  willCap: boolean
  estimatedCapWaste: number
}

export interface ForecastTokenContractInput {
  tokensAvailableNow: number
  tokensExpectedToRegenerate: number
  tokensSpentCurrentLap: number
}

export interface ForecastTokenContract {
  tokens_available_now: number
  tokens_expected_to_regenerate: number
  tokens_remaining_from_now: number
  tokens_spent_current_lap: number
  /** Inclusive lap-projection basis: already spent on this lap + future budget. */
  season_capacity_including_past_spend: number
}

const nonNegativeInteger = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

/** Names each "capacity" quantity so current-lap spend is never double-subtracted. */
export function computeForecastTokenContract(
  input: ForecastTokenContractInput
): ForecastTokenContract {
  const tokens_available_now = nonNegativeInteger(input.tokensAvailableNow)
  const tokens_expected_to_regenerate = nonNegativeInteger(
    input.tokensExpectedToRegenerate
  )
  const tokens_spent_current_lap = nonNegativeInteger(
    input.tokensSpentCurrentLap
  )
  const tokens_remaining_from_now =
    tokens_available_now + tokens_expected_to_regenerate

  return {
    tokens_available_now,
    tokens_expected_to_regenerate,
    tokens_remaining_from_now,
    tokens_spent_current_lap,
    season_capacity_including_past_spend:
      tokens_spent_current_lap + tokens_remaining_from_now
  }
}

/** tokensWillRegen = 1 + INT((countdown - timeToNext) / regen), clamped to headroom. */
export function computePerPlayer(
  input: PerPlayerComputeInput,
  secondsRemaining: number,
  maxTokens = MAX_TOKENS,
  regenSeconds = TOKEN_REGEN_SECONDS
): PerPlayerCompute {
  const tokensNow = Math.max(0, Math.floor(input.tokensNow))
  const nextTokenSeconds = Math.max(0, Math.floor(input.nextTokenSeconds))
  const headroom = Math.max(0, maxTokens - tokensNow)

  let tokensWillRegen: number
  if (secondsRemaining > nextTokenSeconds) {
    const additional = Math.floor(
      (secondsRemaining - nextTokenSeconds) / regenSeconds
    )
    tokensWillRegen = Math.min(headroom, additional + 1)
  } else {
    tokensWillRegen = 0
  }
  tokensWillRegen = Math.max(0, tokensWillRegen)

  const theoreticalRegen = Math.floor(secondsRemaining / regenSeconds)
  const tokensAtSeasonEnd = Math.min(maxTokens, tokensNow + tokensWillRegen)
  const willCap =
    tokensNow + tokensWillRegen >= maxTokens && input.timeOverCapSeconds > 0
  const estimatedCapWaste = Math.max(0, theoreticalRegen - tokensWillRegen)

  return { tokensWillRegen, tokensAtSeasonEnd, willCap, estimatedCapWaste }
}

export interface LapProjectionInput {
  tokensCapacity: number
  tokensIntoCurrentLap: number
  projectedLapCost: number
  /** 0-based; display as currentLap + 1. */
  currentLap: number
  completedLapCount: number
  solverDataAvailable: boolean
}

export interface LapProjectionResult {
  currentLap: number
  tokensIntoCurrentLap: number
  projectedLapCost: number
  basis: 'wi737_solver' | 'last_n_laps' | 'manual'
  n: number
  projectedFinishLap: number
  projectedFinishPct: number
  confidence: 'low' | 'medium' | 'high'
}

/** Null without completed laps, so callers hide the panel instead of NaN bars. */
export function computeLapProjection(
  input: LapProjectionInput
): LapProjectionResult | null {
  if (
    input.completedLapCount <= 0 ||
    !Number.isFinite(input.projectedLapCost) ||
    input.projectedLapCost <= 0
  ) {
    return null
  }

  const tokensToFinishCurrentLap = Math.max(
    input.projectedLapCost - input.tokensIntoCurrentLap,
    0
  )
  const postCurrentLapTokens = input.tokensCapacity - tokensToFinishCurrentLap

  let projectedFinishLap: number
  let projectedFinishPct: number

  if (postCurrentLapTokens >= 0) {
    // Cap below 1 to avoid rendering "Lap 6 + 100%".
    projectedFinishLap = input.currentLap
    projectedFinishPct = Math.min(
      postCurrentLapTokens / input.projectedLapCost,
      0.999
    )
  } else {
    projectedFinishLap = Math.max(0, input.currentLap - 1)
    projectedFinishPct = Math.min(
      (input.tokensIntoCurrentLap + input.tokensCapacity) /
        input.projectedLapCost,
      0.999
    )
  }

  const confidence: LapProjectionResult['confidence'] =
    input.completedLapCount >= 4
      ? 'high'
      : input.completedLapCount >= 2
        ? 'medium'
        : 'low'

  const basis: LapProjectionResult['basis'] = input.solverDataAvailable
    ? 'wi737_solver'
    : 'last_n_laps'

  return {
    currentLap: input.currentLap,
    tokensIntoCurrentLap: input.tokensIntoCurrentLap,
    projectedLapCost: input.projectedLapCost,
    basis,
    n: input.completedLapCount,
    projectedFinishLap,
    projectedFinishPct,
    confidence
  }
}
