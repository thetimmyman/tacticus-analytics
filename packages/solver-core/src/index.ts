export { solveAssignments } from './solver'
export type {
  SolverPlayer,
  SolverBoss,
  SolverInputs,
  Assignment,
  SolverCoverage,
  SolverResult
} from './solver'

// white-box test surface (tests/unit/edge-functions/solver.test.ts)
export { MinCostFlow, runFlow, mergeAssignments } from './solver'
export type { FlowRunResult } from './solver'
