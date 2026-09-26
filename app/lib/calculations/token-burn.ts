/**
 * The only burned-token implementation, so Discord and web agree. Credits the
 * current regen cycle so only a certainly-lost token counts.
 */

import {
  MAX_TOKENS,
  TWELVE_HOURS_IN_SECONDS,
  SEASON_MAX_SPENDABLE_TOKENS
} from '@/app/lib/calculations/token-calculation'

export const TOKEN_AVAILABLE_CAP = MAX_TOKENS

export const TOKEN_REGEN_SECONDS = TWELVE_HOURS_IN_SECONDS

export const MAX_POSSIBLE_HARD_CAP = SEASON_MAX_SPENDABLE_TOKENS

function nonNegativeFinite(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0
}

export function cappedAvailable(
  tokensAvailable: number | null | undefined
): number {
  return Math.min(TOKEN_AVAILABLE_CAP, nonNegativeFinite(tokensAvailable))
}

/** 0 when capped or unknown; keeps a mid-cycle player from counting as having burned a token. */
export function tokenRegenProgress(
  tokensAvailable: number | null | undefined,
  tokenNextSeconds: number | null | undefined
): number {
  if (cappedAvailable(tokensAvailable) >= TOKEN_AVAILABLE_CAP) return 0
  if (
    typeof tokenNextSeconds !== 'number' ||
    !Number.isFinite(tokenNextSeconds) ||
    tokenNextSeconds <= 0
  ) {
    return 0
  }
  const cooldownClamped = Math.min(tokenNextSeconds, TOKEN_REGEN_SECONDS)
  return (TOKEN_REGEN_SECONDS - cooldownClamped) / TOKEN_REGEN_SECONDS
}

export function computeGuildMaxPossibleTokens(
  players: { totalTokens: number; tokensAvailable?: number | null }[]
): number {
  if (players.length === 0) return 0
  const candidate = Math.max(
    ...players.map(
      (p) =>
        nonNegativeFinite(p.totalTokens) + cappedAvailable(p.tokensAvailable)
    )
  )
  return Math.min(MAX_POSSIBLE_HARD_CAP, candidate)
}

/** null when availability is unknown, so callers render "no data" rather than 0. */
export function calculateBurnedTokens(
  maxPossible: number,
  tokensAvailable: number | null | undefined,
  tokensUsed: number,
  tokenNextSeconds?: number | null
): number | null {
  if (
    tokensAvailable === null ||
    tokensAvailable === undefined ||
    !Number.isFinite(tokensAvailable)
  ) {
    return null
  }
  if (!Number.isFinite(maxPossible) || maxPossible <= 0) return null
  if (!Number.isFinite(tokensUsed)) return null
  const effectiveAccrued =
    cappedAvailable(tokensAvailable) +
    nonNegativeFinite(tokensUsed) +
    tokenRegenProgress(tokensAvailable, tokenNextSeconds)
  return Math.max(0, Math.floor(maxPossible - effectiveAccrued))
}
