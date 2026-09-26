import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
// Internals come from solver-core; the edge file is a generated copy.
import {
  solveAssignments as solveCoreAssignments,
  MinCostFlow,
  mergeAssignments,
  runFlow
} from '@tacticus/solver-core'
import {
  solveAssignments,
  type SolverPlayer,
  type SolverBoss,
  type Assignment
} from '../../../supabase/functions/boss-assignment-solver/solver.ts'

const EDGE_BANNER = [
  '// GENERATED FILE — do not edit. Source: packages/solver-core/src/solver.ts.',
  '// Regenerate: npm run gen:edge-solver.',
  "// The edge runtime can't resolve workspace packages, so this is a vendored copy.",
  '',
  ''
].join('\n')

const edgeSource = readFileSync(
  join(
    __dirname,
    '../../../supabase/functions/boss-assignment-solver/solver.ts'
  ),
  'utf8'
)
const coreSource = readFileSync(
  join(__dirname, '../../../packages/solver-core/src/solver.ts'),
  'utf8'
)

describe('Edge Function: boss-assignment-solver', () => {
  describe('MinCostFlow', () => {
    it('creates graph with correct node count', () => {
      const flow = new MinCostFlow(5)
      expect(flow.getGraph()).toHaveLength(5)
    })

    it('adds forward and backward edges', () => {
      const flow = new MinCostFlow(3)
      flow.addEdge(0, 1, 10, 5)
      const graph = flow.getGraph()
      expect(graph[0]).toHaveLength(1)
      expect(graph[1]).toHaveLength(1)
      expect(graph[0][0].cap).toBe(10)
      expect(graph[0][0].cost).toBe(5)
      expect(graph[1][0].cap).toBe(0)
      expect(graph[1][0].cost).toBe(-5)
    })

    it('finds min cost max flow in simple graph', () => {
      const flow = new MinCostFlow(4)
      flow.addEdge(0, 1, 5, 0)
      flow.addEdge(0, 2, 5, 0)
      flow.addEdge(1, 3, 5, 1)
      flow.addEdge(2, 3, 5, 2)

      const result = flow.minCostMaxFlow(0, 3, 10)
      expect(result.flow).toBe(10)
      expect(result.cost).toBe(15)
    })

    it('handles disconnected graph', () => {
      const flow = new MinCostFlow(4)
      flow.addEdge(0, 1, 5, 0)

      const result = flow.minCostMaxFlow(0, 3, 10)
      expect(result.flow).toBe(0)
    })

    it('respects capacity constraints', () => {
      const flow = new MinCostFlow(3)
      flow.addEdge(0, 1, 3, 0)
      flow.addEdge(1, 2, 5, 0)

      const result = flow.minCostMaxFlow(0, 2, 10)
      expect(result.flow).toBe(3)
    })
  })

  describe('mergeAssignments', () => {
    it('merges duplicate player-boss pairs', () => {
      const assignments: Assignment[] = [
        { playerId: 'p1', bossId: 'b1', tokens: 1, score: 10 },
        { playerId: 'p1', bossId: 'b1', tokens: 2, score: 10 }
      ]
      const result = mergeAssignments(assignments)
      expect(result).toHaveLength(1)
      expect(result[0].tokens).toBe(3)
    })

    it('keeps different pairs separate', () => {
      const assignments: Assignment[] = [
        { playerId: 'p1', bossId: 'b1', tokens: 1, score: 10 },
        { playerId: 'p1', bossId: 'b2', tokens: 2, score: 20 },
        { playerId: 'p2', bossId: 'b1', tokens: 1, score: 15 }
      ]
      const result = mergeAssignments(assignments)
      expect(result).toHaveLength(3)
    })

    it('returns empty array for empty input', () => {
      expect(mergeAssignments([])).toEqual([])
    })
  })

  describe('solveAssignments', () => {
    const createBoss = (
      id: string,
      overrides: Partial<SolverBoss> = {}
    ): SolverBoss => ({
      id,
      name: `Boss ${id}`,
      level: 'L1',
      isPrime: false,
      requiredTokens: 2,
      minTokens: 1,
      maxTokens: 3,
      priorityRank: 0,
      ...overrides
    })

    const createPlayer = (
      id: string,
      overrides: Partial<SolverPlayer> = {}
    ): SolverPlayer => ({
      id,
      name: `Player ${id}`,
      maxTokens: 3,
      ...overrides
    })

    it('returns empty result for no players', () => {
      const result = solveAssignments({
        players: [],
        bosses: [createBoss('b1')],
        scores: {}
      })
      expect(result.assignments).toEqual([])
      expect(result.totalTokensAssigned).toBe(0)
    })

    it('returns empty result for no bosses', () => {
      const result = solveAssignments({
        players: [createPlayer('p1')],
        bosses: [],
        scores: {}
      })
      expect(result.assignments).toEqual([])
      expect(result.totalTokensAssigned).toBe(0)
    })

    it('assigns tokens to bosses based on scores', () => {
      const players = [createPlayer('p1'), createPlayer('p2')]
      const bosses = [createBoss('b1'), createBoss('b2')]
      const scores = {
        p1: { b1: 100, b2: 50 },
        p2: { b1: 50, b2: 100 }
      }

      const result = solveAssignments({ players, bosses, scores })
      expect(result.totalTokensAssigned).toBeGreaterThan(0)
      expect(result.assignments.length).toBeGreaterThan(0)
    })

    it('respects player max token limits', () => {
      const players = [createPlayer('p1', { maxTokens: 2 })]
      const bosses = [createBoss('b1', { requiredTokens: 5, maxTokens: 5 })]
      const scores = { p1: { b1: 100 } }

      const result = solveAssignments({ players, bosses, scores })
      const p1Tokens = result.assignments
        .filter((a) => a.playerId === 'p1')
        .reduce((sum, a) => sum + a.tokens, 0)
      expect(p1Tokens).toBeLessThanOrEqual(2)
    })

    it('respects boss max token limits', () => {
      const players = [
        createPlayer('p1', { maxTokens: 5 }),
        createPlayer('p2', { maxTokens: 5 })
      ]
      const bosses = [createBoss('b1', { requiredTokens: 2, maxTokens: 2 })]
      const scores = { p1: { b1: 100 }, p2: { b1: 100 } }

      const result = solveAssignments({ players, bosses, scores })
      expect(result.coverage['b1'].assigned).toBeLessThanOrEqual(2)
    })

    it('respects per-player boss edge caps', () => {
      const players = [
        createPlayer('p1', { maxTokens: 20 }),
        createPlayer('p2', { maxTokens: 20 }),
        createPlayer('p3', { maxTokens: 20 })
      ]
      const bosses = [
        createBoss('b1', {
          requiredTokens: 9,
          maxTokens: 20,
          maxTokensPerPlayer: 3
        })
      ]
      const scores = {
        p1: { b1: 1000 },
        p2: { b1: 900 },
        p3: { b1: 800 }
      }

      const result = solveAssignments({ players, bosses, scores })
      const tokensByPlayer = new Map<string, number>()
      result.assignments.forEach((assignment) => {
        tokensByPlayer.set(
          assignment.playerId,
          (tokensByPlayer.get(assignment.playerId) ?? 0) + assignment.tokens
        )
      })

      expect(result.totalTokensAssigned).toBe(9)
      expect(tokensByPlayer.get('p1')).toBe(3)
      expect(tokensByPlayer.get('p2')).toBe(3)
      expect(tokensByPlayer.get('p3')).toBe(3)
      for (const tokens of tokensByPlayer.values()) {
        expect(tokens).toBeLessThanOrEqual(3)
      }
    })

    it('does not route players through absent or null score edges', () => {
      const players = [
        createPlayer('hasData', { maxTokens: 1 }),
        createPlayer('missingData', { maxTokens: 3 }),
        createPlayer('nullData', { maxTokens: 3 }),
        createPlayer('undefinedData', { maxTokens: 3 })
      ]
      const bosses = [createBoss('b1', { requiredTokens: 5, maxTokens: 5 })]
      const scores = {
        hasData: { b1: 100 },
        missingData: {},
        nullData: { b1: null },
        undefinedData: { b1: undefined }
      }

      const result = solveAssignments({ players, bosses, scores })
      expect(
        result.assignments.map((assignment) => assignment.playerId)
      ).toEqual(['hasData'])
      expect(result.totalTokensAssigned).toBe(1)
    })

    it('keeps explicit zero scores eligible as last-resort edges', () => {
      const players = [
        createPlayer('hasData', { maxTokens: 1 }),
        createPlayer('zeroData', { maxTokens: 3 })
      ]
      const bosses = [createBoss('b1', { requiredTokens: 4, maxTokens: 4 })]
      const scores = {
        hasData: { b1: 100 },
        zeroData: { b1: 0 }
      }

      const result = solveAssignments({ players, bosses, scores })
      const zeroAssignment = result.assignments.find(
        (assignment) => assignment.playerId === 'zeroData'
      )
      expect(zeroAssignment?.tokens).toBe(3)
      expect(zeroAssignment?.score).toBe(0)
      expect(result.totalTokensAssigned).toBe(4)
    })

    it('matches solver-core for cap and score-absence parity', () => {
      const players = [
        createPlayer('p1', { maxTokens: 10 }),
        createPlayer('p2', { maxTokens: 10 }),
        createPlayer('p3', { maxTokens: 10 }),
        createPlayer('p4', { maxTokens: 10 })
      ]
      const bosses = [
        createBoss('b1', {
          requiredTokens: 5,
          maxTokens: 5,
          maxTokensPerPlayer: 2
        })
      ]
      const scores = {
        p1: { b1: 100 },
        p2: { b1: 0 },
        p3: { b1: null },
        p4: {}
      }

      const edgeResult = solveAssignments({ players, bosses, scores })
      const coreResult = solveCoreAssignments({ players, bosses, scores })

      expect(edgeResult.assignments).toEqual(coreResult.assignments)
      expect(edgeResult.totalTokensAssigned).toBe(
        coreResult.totalTokensAssigned
      )
      expect(edgeResult.totalScore).toBe(coreResult.totalScore)
      expect(edgeResult.coverage).toEqual(coreResult.coverage)
    })

    it('calculates coverage correctly', () => {
      const players = [createPlayer('p1', { maxTokens: 3 })]
      const bosses = [createBoss('b1', { requiredTokens: 2, maxTokens: 3 })]
      const scores = { p1: { b1: 100 } }

      const result = solveAssignments({ players, bosses, scores })
      expect(result.coverage['b1']).toBeDefined()
      expect(result.coverage['b1'].required).toBe(2)
      expect(result.coverage['b1'].percentage).toBeGreaterThan(0)
    })

    it('handles priority ranks correctly', () => {
      const players = [createPlayer('p1', { maxTokens: 2 })]
      const bosses = [
        createBoss('b1', { priorityRank: 0, requiredTokens: 2 }),
        createBoss('b2', { priorityRank: 1, requiredTokens: 2 })
      ]
      const scores = { p1: { b1: 100, b2: 100 } }

      const result = solveAssignments({ players, bosses, scores })
      const b1Coverage = result.coverage['b1']
      const b2Coverage = result.coverage['b2']
      expect(b1Coverage.assigned).toBeGreaterThanOrEqual(b2Coverage.assigned)
    })

    it('prefers higher score assignments', () => {
      const players = [createPlayer('p1', { maxTokens: 2 })]
      const bosses = [
        createBoss('b1', { requiredTokens: 2 }),
        createBoss('b2', { requiredTokens: 2 })
      ]
      const scores = { p1: { b1: 1000, b2: 10 } }

      const result = solveAssignments({ players, bosses, scores })
      const b1Assigned = result.coverage['b1'].assigned
      const b2Assigned = result.coverage['b2'].assigned
      expect(b1Assigned).toBeGreaterThanOrEqual(b2Assigned)
    })

    it('handles missing scores gracefully', () => {
      const players = [createPlayer('p1')]
      const bosses = [createBoss('b1')]
      const scores = {}

      const result = solveAssignments({ players, bosses, scores })
      expect(result).toBeDefined()
      expect(result.totalTokensAssigned).toBeGreaterThanOrEqual(0)
    })

    it('handles zero token players', () => {
      const players = [createPlayer('p1', { maxTokens: 0 })]
      const bosses = [createBoss('b1')]
      const scores = { p1: { b1: 100 } }

      const result = solveAssignments({ players, bosses, scores })
      expect(result.totalTokensAssigned).toBe(0)
    })

    it('handles zero required tokens boss', () => {
      const players = [createPlayer('p1')]
      const bosses = [createBoss('b1', { requiredTokens: 0, minTokens: 0 })]
      const scores = { p1: { b1: 100 } }

      const result = solveAssignments({ players, bosses, scores })
      expect(result.coverage['b1'].required).toBe(0)
    })
  })

  describe('runFlow', () => {
    it('handles empty player list', () => {
      const result = runFlow([], [], {}, [], [])
      expect(result.assignments).toEqual([])
      expect(result.totalFlow).toBe(0)
    })

    it('respects capacity limits', () => {
      const players: SolverPlayer[] = [{ id: 'p1', name: 'P1', maxTokens: 2 }]
      const bosses: SolverBoss[] = [
        {
          id: 'b1',
          name: 'B1',
          level: 'L1',
          isPrime: false,
          requiredTokens: 5,
          minTokens: 1,
          maxTokens: 5,
          priorityRank: 0
        }
      ]
      const scores = { p1: { b1: 100 } }

      const result = runFlow(players, bosses, scores, [2], [5])
      expect(result.totalFlow).toBeLessThanOrEqual(2)
    })

    it('tracks player and boss usage', () => {
      const players: SolverPlayer[] = [
        { id: 'p1', name: 'P1', maxTokens: 2 },
        { id: 'p2', name: 'P2', maxTokens: 2 }
      ]
      const bosses: SolverBoss[] = [
        {
          id: 'b1',
          name: 'B1',
          level: 'L1',
          isPrime: false,
          requiredTokens: 4,
          minTokens: 1,
          maxTokens: 4,
          priorityRank: 0
        }
      ]
      const scores = { p1: { b1: 100 }, p2: { b1: 100 } }

      const result = runFlow(players, bosses, scores, [2, 2], [4])
      expect(result.playerUsage).toHaveLength(2)
      expect(result.bossUsage).toHaveLength(1)
      expect(result.playerUsage[0] + result.playerUsage[1]).toBe(
        result.totalFlow
      )
    })
  })

  describe('generated vendored copy', () => {
    it('carries the generator banner', () => {
      expect(edgeSource.startsWith(EDGE_BANNER)).toBe(true)
    })

    it('is byte-identical to solver-core below the banner', () => {
      expect(edgeSource.slice(EDGE_BANNER.length)).toBe(coreSource)
    })
  })
})
