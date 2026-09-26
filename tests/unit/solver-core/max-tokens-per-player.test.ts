import { describe, expect, it } from 'vitest'
import {
  solveAssignments,
  type SolverBoss,
  type SolverPlayer
} from '@tacticus/solver-core'

/** Without the per-edge cap, min-cost max-flow pushes every token through the top scorer. */

const players: SolverPlayer[] = [
  { id: 'p1', name: 'P1', maxTokens: 20 },
  { id: 'p2', name: 'P2', maxTokens: 20 },
  { id: 'p3', name: 'P3', maxTokens: 20 },
  { id: 'p4', name: 'P4', maxTokens: 20 },
  { id: 'p5', name: 'P5', maxTokens: 20 }
]

// Heavily weighted toward p1 so a naive solver would pick p1 for everything.
const scores: Record<string, Record<string, number>> = {
  p1: { boss1: 10_000_000 },
  p2: { boss1: 1_000_000 },
  p3: { boss1: 900_000 },
  p4: { boss1: 800_000 },
  p5: { boss1: 700_000 }
}

describe('solveAssignments — maxTokensPerPlayer per-edge cap', () => {
  it('without cap, concentrates full requiredTokens on the top scorer', () => {
    const boss: SolverBoss = {
      id: 'boss1',
      name: 'Boss1',
      level: 'L1',
      isPrime: false,
      requiredTokens: 9,
      minTokens: 0,
      maxTokens: 20,
      priorityRank: 0
    }

    const result = solveAssignments({ players, bosses: [boss], scores })

    const p1Tokens = result.assignments
      .filter((a) => a.playerId === 'p1')
      .reduce((sum, a) => sum + a.tokens, 0)
    expect(p1Tokens).toBe(9)
  })

  it('with cap=3, forces at least 3 distinct attackers on a 9-token boss', () => {
    const boss: SolverBoss = {
      id: 'boss1',
      name: 'Boss1',
      level: 'L1',
      isPrime: false,
      requiredTokens: 9,
      minTokens: 0,
      maxTokens: 20,
      priorityRank: 0,
      maxTokensPerPlayer: 3
    }

    const result = solveAssignments({ players, bosses: [boss], scores })

    const perPlayer = new Map<string, number>()
    for (const a of result.assignments) {
      perPlayer.set(a.playerId, (perPlayer.get(a.playerId) ?? 0) + a.tokens)
    }

    for (const [, tokens] of perPlayer) {
      expect(tokens).toBeLessThanOrEqual(3)
    }

    expect(perPlayer.get('p1')).toBe(3)
    expect(perPlayer.get('p2')).toBe(3)
    expect(perPlayer.get('p3')).toBe(3)

    expect(result.totalTokensAssigned).toBe(9)
  })

  it('with cap=1, forces full spread — 9 distinct attackers needed', () => {
    const boss: SolverBoss = {
      id: 'boss1',
      name: 'Boss1',
      level: 'L1',
      isPrime: false,
      requiredTokens: 9,
      minTokens: 0,
      maxTokens: 20,
      priorityRank: 0,
      maxTokensPerPlayer: 1
    }

    const result = solveAssignments({ players, bosses: [boss], scores })

    expect(result.totalTokensAssigned).toBe(5)

    const perPlayer = new Map<string, number>()
    for (const a of result.assignments) {
      perPlayer.set(a.playerId, (perPlayer.get(a.playerId) ?? 0) + a.tokens)
    }
    for (const [, tokens] of perPlayer) {
      expect(tokens).toBe(1)
    }
    expect(perPlayer.size).toBe(5)
  })

  it('cap does not exceed player or boss maxTokens', () => {
    const boss: SolverBoss = {
      id: 'boss1',
      name: 'Boss1',
      level: 'L1',
      isPrime: false,
      requiredTokens: 10,
      minTokens: 0,
      maxTokens: 20,
      priorityRank: 0,
      maxTokensPerPlayer: 5
    }

    const shortPlayers: SolverPlayer[] = [
      { id: 'p1', name: 'P1', maxTokens: 2 },
      { id: 'p2', name: 'P2', maxTokens: 2 },
      { id: 'p3', name: 'P3', maxTokens: 2 }
    ]

    const result = solveAssignments({
      players: shortPlayers,
      bosses: [boss],
      scores
    })

    const perPlayer = new Map<string, number>()
    for (const a of result.assignments) {
      perPlayer.set(a.playerId, (perPlayer.get(a.playerId) ?? 0) + a.tokens)
    }
    for (const [, tokens] of perPlayer) {
      expect(tokens).toBeLessThanOrEqual(2)
    }
  })
})
