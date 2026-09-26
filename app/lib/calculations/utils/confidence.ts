export type Confidence = 'low' | 'medium' | 'high'

/** 2, not 3, so twice-attacked bosses surface as `low` confidence while single flukes stay out. */
export const MIN_ATTACKS_FOR_VERDICT = 2

export const MED_CONF_ATTACKS = 3

export const HIGH_CONF_ATTACKS = 6

export function classifyConfidence(attacks: number): Confidence {
  if (attacks >= HIGH_CONF_ATTACKS) return 'high'
  if (attacks >= MED_CONF_ATTACKS) return 'medium'
  return 'low'
}

export function hasSufficientAttacks(
  attacks: number | null | undefined
): boolean {
  return (attacks ?? 0) >= MIN_ATTACKS_FOR_VERDICT
}
