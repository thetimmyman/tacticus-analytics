import { describe, expect, it } from 'vitest'
import {
  solveAssignments,
  type SolverPlayer,
  type SolverBoss
} from '@tacticus/solver-core'

// Absent or null score = no edge; zero score = a last-resort edge.
describe('solver null/undefined score absence semantics', () => {
  const bosses: SolverBoss[] = [
    {
      id: 'boss1',
      name: 'Test Boss',
      level: 'L1',
      isPrime: false,
      requiredTokens: 3,
      minTokens: 0,
      maxTokens: 3,
      priorityRank: 0
    }
  ]
  const players: SolverPlayer[] = [
    { id: 'hasData', name: 'HasData', maxTokens: 3 },
    { id: 'noData', name: 'NoData', maxTokens: 3 }
  ]

  it('absent score entry → player is not routed through', () => {
    const scores = {
      hasData: { boss1: 100 }
    }
    const result = solveAssignments({ players, bosses, scores })
    const assignedToNoData = result.assignments.filter(
      (a) => a.playerId === 'noData'
    )
    expect(assignedToNoData).toHaveLength(0)
  })

  it('explicit null score → player is not routed through', () => {
    const scores = {
      hasData: { boss1: 100 },
      noData: { boss1: null }
    }
    const result = solveAssignments({ players, bosses, scores })
    const assignedToNoData = result.assignments.filter(
      (a) => a.playerId === 'noData'
    )
    expect(assignedToNoData).toHaveLength(0)
  })

  it('explicit undefined score → player is not routed through', () => {
    const scores = {
      hasData: { boss1: 100 },
      noData: { boss1: undefined }
    }
    const result = solveAssignments({ players, bosses, scores })
    const assignedToNoData = result.assignments.filter(
      (a) => a.playerId === 'noData'
    )
    expect(assignedToNoData).toHaveLength(0)
  })

  it('zero score → player IS routed (last-resort eligibility preserved)', () => {
    // Demand exceeds one player's cap, so the zero-score edge must carry flow.
    const scores = {
      hasData: { boss1: 100 },
      noData: { boss1: 0 }
    }
    const bigBoss: SolverBoss[] = [
      {
        id: 'boss1',
        name: 'Test Boss',
        level: 'L1',
        isPrime: false,
        requiredTokens: 5,
        minTokens: 0,
        maxTokens: 5,
        priorityRank: 0
      }
    ]
    const result = solveAssignments({ players, bosses: bigBoss, scores })
    const assignedToNoData = result.assignments.filter(
      (a) => a.playerId === 'noData'
    )
    expect(assignedToNoData.length).toBeGreaterThan(0)
  })
})
