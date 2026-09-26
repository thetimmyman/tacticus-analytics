/**
 * Mirror of SQL `war_zone_captured`; keep in parity. Loki can report 'win' with a defender alive,
 * so capture means not a loss and no defender HP left.
 */
export function isWarZoneCaptured(
  attemptResult: string | null | undefined,
  defenderUnitsJson: Json | undefined
): boolean {
  if (attemptResult === 'loss') return false
  if (!Array.isArray(defenderUnitsJson) || defenderUnitsJson.length === 0) {
    return true
  }

  const hasSurvivingDefender = defenderUnitsJson.some((unit) => {
    if (!unit || typeof unit !== 'object') return false
    const raw = (unit as { remainingHPAfter?: Json }).remainingHPAfter
    if (typeof raw === 'number') return Number.isFinite(raw) && raw > 0
    if (typeof raw !== 'string' || raw.trim() === '') return false
    const parsed = Number(raw)
    return Number.isFinite(parsed) && parsed > 0
  })

  return !hasSurvivingDefender
}
import type { Json } from '@tacticus/app-core/database.generated'
