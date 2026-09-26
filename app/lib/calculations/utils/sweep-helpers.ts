/**
 * A sweep is a killing blow on a pre-damaged boss. Baselines are sweep-free; player
 * averages re-include sweeps that clear the gate, so a sweep never drags them down.
 */

export interface SweepCheckRow {
  remainingHp: number | null
  maxHp: number | null
  damageDealt: number | null
}

export function isSweepRow(row: SweepCheckRow): boolean {
  return (
    row.remainingHp === 0 &&
    (row.maxHp ?? 0) > 0 &&
    (row.damageDealt ?? 0) < (row.maxHp ?? 0)
  )
}

/** Gate = GREATEST(playerNonSweepAvg, referenceAvg); a missing player avg degrades to the reference. */
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

  // Mirrors SQL GREATEST, which ignores NULLs.
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
