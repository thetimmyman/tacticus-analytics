import { describe, expect, it } from 'vitest'

import {
  solveAssignments,
  type SolverBoss,
  type SolverPlayer
} from '@/packages/solver-core/src/solver'

const boss = (over: Partial<SolverBoss> = {}): SolverBoss => ({
  id: 'b1',
  name: 'Boss',
  level: 'L1',
  isPrime: false,
  requiredTokens: 3,
  minTokens: 0,
  maxTokens: 5,
  priorityRank: 0,
  ...over
})

const player = (over: Partial<SolverPlayer> = {}): SolverPlayer => ({
  id: 'p1',
  name: 'P1',
  maxTokens: 3,
  ...over
})

describe('solveAssignments — empty-input early return', () => {
  it('returns an empty, zeroed result when there are no players', () => {
    const result = solveAssignments({
      players: [],
      bosses: [boss()],
      scores: {}
    })
    expect(result.assignments).toEqual([])
    expect(result.totalTokensAssigned).toBe(0)
    expect(result.totalScore).toBe(0)
    expect(result.coverage).toEqual({})
  })

  it('returns an empty, zeroed result when there are no bosses', () => {
    const result = solveAssignments({
      players: [player()],
      bosses: [],
      scores: { p1: {} }
    })
    expect(result.assignments).toEqual([])
    expect(result.totalTokensAssigned).toBe(0)
    expect(result.coverage).toEqual({})
  })

  it('returns empty when both players and bosses are empty', () => {
    const result = solveAssignments({ players: [], bosses: [], scores: {} })
    expect(result.assignments).toHaveLength(0)
    expect(result.coverage).toEqual({})
  })
})

describe('solveAssignments — all-null score matrix yields zero flow', () => {
  it('assigns nothing when every (player, boss) score is null', () => {
    const result = solveAssignments({
      players: [
        player({ id: 'p1', maxTokens: 3 }),
        player({ id: 'p2', maxTokens: 3 })
      ],
      bosses: [boss({ id: 'b1', requiredTokens: 4 })],
      scores: {
        p1: { b1: null },
        p2: { b1: undefined }
      }
    })

    expect(result.assignments).toHaveLength(0)
    expect(result.totalTokensAssigned).toBe(0)
    const cov = result.coverage['b1']
    expect(cov).toBeDefined()
    expect(cov!.required).toBe(4)
    expect(cov!.assigned).toBe(0)
    expect(cov!.gap).toBe(4)
    expect(cov!.percentage).toBe(0)
  })

  it('assigns nothing when the scores object omits the player key entirely', () => {
    const result = solveAssignments({
      players: [player({ id: 'p1', maxTokens: 3 })],
      bosses: [boss({ id: 'b1', requiredTokens: 2 })],
      scores: {} // p1 has no entry at all
    })
    expect(result.assignments).toHaveLength(0)
    expect(result.coverage['b1']?.assigned).toBe(0)
  })

  it('DOES assign when a 0 score is present (0 ≠ absent)', () => {
    // Contrast: a score of 0 is an eligible edge (zero preference), so flow routes through it.
    const result = solveAssignments({
      players: [player({ id: 'p1', maxTokens: 3 })],
      bosses: [boss({ id: 'b1', requiredTokens: 2, maxTokens: 5 })],
      scores: { p1: { b1: 0 } }
    })
    expect(result.assignments.length).toBeGreaterThan(0)
    expect(result.coverage['b1']?.assigned).toBeGreaterThan(0)
  })
})

describe('solveAssignments — requiredTokens = 0 (no demand)', () => {
  it('assigns nothing to a boss with zero required and zero min tokens', () => {
    const result = solveAssignments({
      players: [player({ id: 'p1', maxTokens: 3 })],
      bosses: [boss({ id: 'b1', requiredTokens: 0, minTokens: 0 })],
      scores: { p1: { b1: 100 } }
    })
    expect(result.assignments).toHaveLength(0)
    expect(result.totalTokensAssigned).toBe(0)
    const cov = result.coverage['b1']
    expect(cov).toBeDefined()
    expect(cov!.required).toBe(0)
    expect(cov!.assigned).toBe(0)
    expect(cov!.gap).toBe(0)
    expect(cov!.percentage).toBe(0)
  })

  it('honors minTokens as the demand floor when requiredTokens is 0', () => {
    const result = solveAssignments({
      players: [player({ id: 'p1', maxTokens: 3 })],
      bosses: [
        boss({ id: 'b1', requiredTokens: 0, minTokens: 2, maxTokens: 5 })
      ],
      scores: { p1: { b1: 100 } }
    })
    const assigned = result.coverage['b1']?.assigned ?? 0
    expect(assigned).toBeGreaterThan(0)
    expect(assigned).toBeLessThanOrEqual(2)
  })
})

describe('solveAssignments — caps and per-player edge cap boundaries', () => {
  it('clamps a negative player maxTokens to zero (no flow, no crash)', () => {
    const result = solveAssignments({
      players: [player({ id: 'p1', maxTokens: -5 })],
      bosses: [boss({ id: 'b1', requiredTokens: 2 })],
      scores: { p1: { b1: 50 } }
    })
    expect(result.assignments).toHaveLength(0)
    expect(result.coverage['b1']?.assigned).toBe(0)
  })

  it('enforces maxTokensPerPlayer so one player cannot saturate the demand', () => {
    const result = solveAssignments({
      players: [player({ id: 'p1', maxTokens: 10 })],
      bosses: [
        boss({
          id: 'b1',
          requiredTokens: 6,
          maxTokens: 10,
          maxTokensPerPlayer: 2
        })
      ],
      scores: { p1: { b1: 100 } }
    })
    const cov = result.coverage['b1']!
    expect(cov.assigned).toBe(2)
    expect(cov.gap).toBe(4)
  })

  it('spreads demand across players under the per-player cap', () => {
    const result = solveAssignments({
      players: [
        player({ id: 'p1', maxTokens: 10 }),
        player({ id: 'p2', maxTokens: 10 }),
        player({ id: 'p3', maxTokens: 10 }),
        player({ id: 'p4', maxTokens: 10 })
      ],
      bosses: [
        boss({
          id: 'b1',
          requiredTokens: 6,
          maxTokens: 10,
          maxTokensPerPlayer: 2
        })
      ],
      scores: {
        p1: { b1: 100 },
        p2: { b1: 90 },
        p3: { b1: 80 },
        p4: { b1: 70 }
      }
    })
    const cov = result.coverage['b1']!
    expect(cov.assigned).toBe(6)
    const distinctAttackers = new Set(
      result.assignments.filter((a) => a.tokens > 0).map((a) => a.playerId)
    )
    expect(distinctAttackers.size).toBeGreaterThanOrEqual(3)
    for (const a of result.assignments) {
      expect(a.tokens).toBeLessThanOrEqual(2)
    }
  })

  it('prefers the higher-score player when supply is binding', () => {
    // Minimizing cost maximizes score; fails if the cost sign flips.
    const result = solveAssignments({
      players: [
        player({ id: 'p_hi', maxTokens: 5 }),
        player({ id: 'p_lo', maxTokens: 5 })
      ],
      bosses: [
        boss({
          id: 'b1',
          requiredTokens: 2,
          maxTokens: 5,
          maxTokensPerPlayer: 5
        })
      ],
      scores: {
        p_hi: { b1: 100 },
        p_lo: { b1: 10 }
      }
    })
    const hiTokens = result.assignments
      .filter((a) => a.playerId === 'p_hi')
      .reduce((s, a) => s + a.tokens, 0)
    const loTokens = result.assignments
      .filter((a) => a.playerId === 'p_lo')
      .reduce((s, a) => s + a.tokens, 0)
    expect(hiTokens).toBe(2)
    expect(loTokens).toBe(0)
  })
})

describe('solveAssignments — priority tiers route in rank order', () => {
  it('serves the lower priorityRank tier first when supply is scarce', () => {
    const result = solveAssignments({
      players: [player({ id: 'p1', maxTokens: 2 })],
      bosses: [
        boss({
          id: 'b_low_rank',
          requiredTokens: 2,
          priorityRank: 0,
          maxTokens: 5,
          maxTokensPerPlayer: 5
        }),
        boss({
          id: 'b_high_rank',
          requiredTokens: 2,
          priorityRank: 1,
          maxTokens: 5,
          maxTokensPerPlayer: 5
        })
      ],
      scores: {
        p1: { b_low_rank: 100, b_high_rank: 100 }
      }
    })
    const low = result.coverage['b_low_rank']!
    const high = result.coverage['b_high_rank']!
    expect(low.assigned).toBe(2)
    expect(high.assigned).toBe(0)
    expect(high.gap).toBe(2)
  })
})
