// No server-side imports: client code uses this.

export type BossAssignmentSolverWeights = {
  damage: number
  preference: number
  reliability: number
}

export const DEFAULT_PRIORITY_GROUPS: string[][] = [
  ['M1', 'L5'],
  ['M2', 'L4'],
  ['L1', 'L2', 'L3']
]

export const DEFAULT_SOLVER_WEIGHTS: BossAssignmentSolverWeights = {
  damage: 1.0,
  preference: 0.5,
  reliability: 0.2
}
