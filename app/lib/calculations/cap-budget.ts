/**
 * How long a player can sit at the bank cap (regen pauses) before a regeneration
 * slips past the season deadline. Pure and Date-free.
 */

import {
  MAX_TOKENS,
  SEASON_END_LOCKOUT_SECONDS,
  SEASON_MAX_SPENDABLE_TOKENS,
  TWELVE_HOURS_IN_SECONDS
} from '@/app/lib/calculations/token-calculation'
import {
  BOMB_COOLDOWN_SECONDS,
  MAX_BOMBS,
  SEASON_MAX_SPENDABLE_BOMBS
} from '@/app/lib/calculations/bomb-availability'

export const TOKEN_REGEN_SECONDS = TWELVE_HOURS_IN_SECONDS
export const BOMB_REGEN_SECONDS = BOMB_COOLDOWN_SECONDS

export interface EconomyResource {
  maxBank: number
  regenSeconds: number
  seasonFallbackMax: number
}

export const TOKEN_RESOURCE: EconomyResource = {
  maxBank: MAX_TOKENS,
  regenSeconds: TOKEN_REGEN_SECONDS,
  seasonFallbackMax: SEASON_MAX_SPENDABLE_TOKENS
}

export const BOMB_RESOURCE: EconomyResource = {
  maxBank: MAX_BOMBS,
  regenSeconds: BOMB_REGEN_SECONDS,
  seasonFallbackMax: SEASON_MAX_SPENDABLE_BOMBS
}

export type TokenCapStatus = 'regenerating' | 'at_cap' | 'season_ended'

export interface CapBudgetInput {
  bankNow: number
  /** Null when there is no regeneration clock: unknowable, not zero. */
  nextRegenSeconds: number | null
  /** The last moment a battle can start. */
  secondsToDeadline: number
  used: number
  seasonMax?: number
  resource?: EconomyResource
}

export interface CapBudgetResult {
  status: TokenCapStatus
  regensBeforeDeadline: number | null
  /** 0 once nothing fits; null when unknowable. */
  capBudgetSeconds: number | null
  stillReachable: number | null
  seasonMax: number
  resource: EconomyResource
}

const clampBank = (value: number, maxBank: number): number => {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(maxBank, Math.floor(value)))
}

const nonNegative = (value: number): number =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0

export function computeCapBudget(input: CapBudgetInput): CapBudgetResult {
  const resource = input.resource ?? TOKEN_RESOURCE
  const seasonMax =
    input.seasonMax && input.seasonMax > 0
      ? Math.floor(input.seasonMax)
      : resource.seasonFallbackMax

  const bankNow = clampBank(input.bankNow, resource.maxBank)
  const used = nonNegative(input.used)
  const secondsToDeadline = Number.isFinite(input.secondsToDeadline)
    ? input.secondsToDeadline
    : 0

  if (secondsToDeadline <= 0) {
    return {
      status: 'season_ended',
      regensBeforeDeadline: 0,
      capBudgetSeconds: 0,
      stillReachable: Math.min(seasonMax, used + bankNow),
      seasonMax,
      resource
    }
  }

  const atCap = bankNow >= resource.maxBank
  const status: TokenCapStatus = atCap ? 'at_cap' : 'regenerating'

  const effectiveNext = atCap
    ? resource.regenSeconds
    : Number.isFinite(input.nextRegenSeconds as number) &&
        input.nextRegenSeconds !== null
      ? Math.max(0, input.nextRegenSeconds)
      : null

  if (effectiveNext === null) {
    return {
      status,
      regensBeforeDeadline: null,
      capBudgetSeconds: null,
      stillReachable: null,
      seasonMax,
      resource
    }
  }

  if (effectiveNext > secondsToDeadline) {
    return {
      status,
      regensBeforeDeadline: 0,
      capBudgetSeconds: 0,
      stillReachable: Math.min(seasonMax, used + bankNow),
      seasonMax,
      resource
    }
  }

  const slack = secondsToDeadline - effectiveNext
  const regensBeforeDeadline = Math.floor(slack / resource.regenSeconds) + 1
  const lastRegenAt =
    effectiveNext + (regensBeforeDeadline - 1) * resource.regenSeconds
  const capBudgetSeconds = Math.max(0, secondsToDeadline - lastRegenAt)

  return {
    status,
    regensBeforeDeadline,
    capBudgetSeconds,
    stillReachable: Math.min(seasonMax, used + bankNow + regensBeforeDeadline),
    seasonMax,
    resource
  }
}

export interface AgedResourceSnapshot {
  bankNow: number
  nextRegenSeconds: number | null
}

/** Both clocks must advance together, or a stale nextRegenSeconds drifts against the deadline. */
export function ageResourceSnapshot(
  bankAtFetch: number,
  nextRegenSecondsAtFetch: number | null,
  elapsedSeconds: number,
  resource: EconomyResource = TOKEN_RESOURCE
): AgedResourceSnapshot {
  let bank = clampBank(bankAtFetch, resource.maxBank)
  if (bank >= resource.maxBank) {
    return { bankNow: bank, nextRegenSeconds: null }
  }
  if (
    nextRegenSecondsAtFetch === null ||
    !Number.isFinite(nextRegenSecondsAtFetch)
  ) {
    return { bankNow: bank, nextRegenSeconds: null }
  }
  const elapsed =
    Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 ? elapsedSeconds : 0
  let next = Math.max(0, nextRegenSecondsAtFetch) - elapsed
  while (next <= 0 && bank < resource.maxBank) {
    bank += 1
    next += resource.regenSeconds
  }
  if (bank >= resource.maxBank) {
    return { bankNow: bank, nextRegenSeconds: null }
  }
  return { bankNow: bank, nextRegenSeconds: next }
}

/**
 * Without the lockout the opening bank and boundary regen are both credited. Use this,
 * not the RPC's `max_possible` (top spender so far), as the "Still Reachable" denominator.
 */
export function seasonMaxForWindow(
  seasonStartMs: number,
  seasonEndMs: number,
  resource: EconomyResource = TOKEN_RESOURCE
): number {
  const durationSeconds =
    Math.floor((seasonEndMs - seasonStartMs) / 1000) -
    SEASON_END_LOCKOUT_SECONDS
  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    return resource.seasonFallbackMax
  }
  return resource.maxBank + Math.floor(durationSeconds / resource.regenSeconds)
}

export function formatCapClock(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '--'
  }
  const total = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
}

export const CAP_STATUS_LABEL: Record<TokenCapStatus, string> = {
  regenerating: 'Regenerating',
  at_cap: 'At cap — burning',
  season_ended: 'Season ended'
}
