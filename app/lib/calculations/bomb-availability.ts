import { EIGHTEEN_HOURS_IN_SECONDS } from '@/app/lib/calculations/token-calculation'

/** Shared so the Discord fast-path and Herald aggregate agree. */
export const MAX_BOMBS = 1
export const BOMB_COOLDOWN_SECONDS = EIGHTEEN_HOURS_IN_SECONDS
/** Full-season fallback: 1 + floor((312h - 15m) / 18h); prefer `seasonMaxForWindow`. */
export const SEASON_MAX_SPENDABLE_BOMBS = 18

export function computeBombAvailability(
  lastBombSec: number | null | undefined,
  nowSec: number
): { available: boolean; remainingSeconds: number } {
  if (lastBombSec === null || lastBombSec === undefined) {
    return { available: true, remainingSeconds: 0 }
  }
  const remainingSeconds = Math.max(
    0,
    BOMB_COOLDOWN_SECONDS - (nowSec - lastBombSec)
  )
  return { available: remainingSeconds === 0, remainingSeconds }
}
