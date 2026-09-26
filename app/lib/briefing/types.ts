/**
 * `unknown` and `hold` must never be collapsed; missing or stale inputs degrade to
 * `unknown`, never "Attack now". Pure so server and client can import it.
 */

export type NextMoveState =
  'attack' | 'hold' | 'done' | 'unknown' | 'setup_required'

export type Confidence = 'high' | 'medium' | 'low'

/** Stable codes for telemetry; add codes, not free-text reasons. */
export type NextMoveReasonCode =
  | 'profile_unclaimed'
  | 'no_boss_data'
  | 'main_alive'
  | 'main_defeated'
  | 'main_warded'
  | 'clear_primes'
  | 'warding_unknown'
  | 'token_available'
  | 'no_token'
  | 'token_unknown'
  | 'bomb_range'
  | 'bomb_available'
  | 'no_bomb'
  | 'bomb_unknown'
  | 'best_target_now'
  | 'stronger_target_soon'
  | 'token_at_cap'
  | 'value_unknown'
  | 'pace_unknown'

export interface BossTargetRef {
  name: string
  displayName: string
  levelCode: string
  encounterId: number
  hpPercentage: number
}

export interface PrimeTarget {
  encounterId: 1 | 2
  name: string
  displayName: string
  levelCode: string
  hpPercentage: number
  remainingHp: number | null
  behaviour: 'kill' | 'threshold'
  thresholdHpPct: number | null
}

/** Competes only when both `value` and `etaSeconds` are known. */
export interface NextMoveAlternative {
  name: string
  displayName: string
  levelCode: string
  encounterId: number
  value: number | null
  etaSeconds: number | null
  etaSource: 'history' | 'estimate'
}

export interface MoveEconomy {
  currentValue: number | null
  waitFor?: {
    displayName: string
    levelCode: string
    upliftPct: number
    etaLabel: string
    etaSource: 'history' | 'estimate'
  } | null
  capLabel?: string | null
}

export interface NextMoveAction {
  label: string
  href: string
}

export interface NextMove {
  state: NextMoveState
  headline: string
  detail: string
  target?: BossTargetRef
  primeTargets?: PrimeTarget[]
  reasonCodes: NextMoveReasonCode[]
  confidence: Confidence
  primaryAction?: NextMoveAction
  /** The card adds relative freshness so derivation stays deterministic. */
  basis: string[]
  economy?: MoveEconomy
  sourceTimestamps: Record<string, string>
}

/** Stale inputs must be passed as `null` so the state degrades to `unknown`. */
export const FRESHNESS_LIMITS_MS = {
  bossStatus: 10 * 60_000,
  tokens: 10 * 60_000,
  assignment: 6 * 60 * 60_000,
  directive: 6 * 60 * 60_000
} as const

export function isStale(
  asOfIso: string | null | undefined,
  limitMs: number,
  nowMs: number
): boolean {
  if (!asOfIso) return true
  const t = Date.parse(asOfIso)
  if (Number.isNaN(t)) return true
  return nowMs - t > limitMs
}
