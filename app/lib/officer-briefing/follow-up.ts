// Compares a task's verdict snapshot with the member's later team; judged only after MIN_NEW_ATTACKS.

export type FollowUpOutcome =
  | 'swapped_improved'
  | 'swapped_no_change'
  | 'execution_improved'
  | 'execution_no_change'
  | 'not_swapped'
  | 'insufficient_new_evidence'

export interface FollowUpInput {
  expectedTeamSwap: boolean
  recommendedTeamHash: string
  originalActualAvg: number | null
  currentDominantTeamHash: string | null
  currentActualAvg: number | null
  currentBattleCount: number
}

export interface FollowUpResult {
  outcome: FollowUpOutcome
  swapped: boolean
  /** Set only once swapped and judgeable. */
  deltaAvg: number | null
  deltaPct: number | null
  newAttacksSinceAssignment: number
}

export const MIN_NEW_ATTACKS_FOR_FOLLOWUP = 3
/** Relative avg-damage gain that counts as a win. */
export const FOLLOWUP_IMPROVEMENT_MARGIN = 0.05

export function computeFollowUp(input: FollowUpInput): FollowUpResult {
  const newAttacksSinceAssignment = Math.max(0, input.currentBattleCount)

  if (
    input.currentDominantTeamHash == null ||
    newAttacksSinceAssignment < MIN_NEW_ATTACKS_FOR_FOLLOWUP
  ) {
    return {
      outcome: 'insufficient_new_evidence',
      swapped:
        input.expectedTeamSwap &&
        input.currentDominantTeamHash === input.recommendedTeamHash,
      deltaAvg: null,
      deltaPct: null,
      newAttacksSinceAssignment
    }
  }

  const swapped = input.currentDominantTeamHash === input.recommendedTeamHash
  if (!swapped) {
    return {
      outcome: 'not_swapped',
      swapped: false,
      deltaAvg: null,
      deltaPct: null,
      newAttacksSinceAssignment
    }
  }

  if (input.originalActualAvg == null || input.currentActualAvg == null) {
    return {
      outcome: 'insufficient_new_evidence',
      swapped: input.expectedTeamSwap,
      deltaAvg: null,
      deltaPct: null,
      newAttacksSinceAssignment
    }
  }

  const deltaAvg = input.currentActualAvg - input.originalActualAvg
  const deltaPct =
    input.originalActualAvg !== 0 ? deltaAvg / input.originalActualAvg : null
  const improved = deltaPct != null && deltaPct >= FOLLOWUP_IMPROVEMENT_MARGIN

  return {
    outcome: input.expectedTeamSwap
      ? improved
        ? 'swapped_improved'
        : 'swapped_no_change'
      : improved
        ? 'execution_improved'
        : 'execution_no_change',
    swapped: input.expectedTeamSwap,
    deltaAvg,
    deltaPct,
    newAttacksSinceAssignment
  }
}
