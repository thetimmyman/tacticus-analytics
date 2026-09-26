// Deno-side raid damage-row classification with no Deno imports, so vitest can load it. Must match
// app/lib/calculations/utils/sweep-helpers.ts (parity tested); crash rows (damageDealt <= 0) are excluded.

export interface DamageRow {
  damageDealt: number | null
  remainingHp: number | null
  maxHp: number | null
  damageType?: string | null
}

/**
 * Killing blow on a pre-damaged boss; one-shots are not sweeps. Strict `=== 0` matches the app copy;
 * synced rows never have a NULL remainingHp, so it cannot diverge from SQL's COALESCE(...) = 0.
 */
export function isSweepRow(row: DamageRow): boolean {
  return (
    row.remainingHp === 0 &&
    (row.maxHp ?? 0) > 0 &&
    (row.damageDealt ?? 0) < (row.maxHp ?? 0)
  )
}

/** Full-HP (or more) kill in a single attack. Always a fair damage sample. */
export function isOneShotRow(row: DamageRow): boolean {
  return (
    (row.remainingHp ?? 0) === 0 &&
    (row.maxHp ?? 0) > 0 &&
    (row.damageDealt ?? 0) >= (row.maxHp ?? 0)
  )
}

/** Rows for a sweep-free damage average; totals and top-hit rankings include sweeps. */
export function isMeaningfulBattleRow(row: DamageRow): boolean {
  return (
    (row.damageType ?? 'Battle') === 'Battle' &&
    (row.damageDealt ?? 0) > 0 &&
    !isSweepRow(row)
  )
}

/**
 * A sweep counts toward a player's numerator iff its damage >= max(player's
 * non-sweep avg, reference avg). Mirrors the SQL qualifying_sweep_* helpers.
 */
export function applyQualifyingSweepException(
  nonSweepDamage: number,
  nonSweepCount: number,
  sweepDamages: number[],
  referenceAvg: number,
  playerNonSweepAvg?: number
): { adjustedDamage: number; adjustedCount: number } {
  if (referenceAvg <= 0 || sweepDamages.length === 0) {
    return { adjustedDamage: nonSweepDamage, adjustedCount: nonSweepCount }
  }

  const gate =
    playerNonSweepAvg && playerNonSweepAvg > referenceAvg
      ? playerNonSweepAvg
      : referenceAvg

  const qualifying = sweepDamages.filter((d) => d >= gate)
  const qualifyingSum = qualifying.reduce((sum, d) => sum + d, 0)

  return {
    adjustedDamage: nonSweepDamage + qualifyingSum,
    adjustedCount: nonSweepCount + qualifying.length
  }
}
