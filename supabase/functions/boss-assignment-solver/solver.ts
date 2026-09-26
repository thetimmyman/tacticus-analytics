// GENERATED FILE — do not edit. Source: packages/solver-core/src/solver.ts.
// Regenerate: npm run gen:edge-solver.
// The edge runtime can't resolve workspace packages, so this is a vendored copy.

export interface SolverPlayer {
  id: string
  name: string
  maxTokens: number
}

export interface SolverBoss {
  id: string
  name: string
  level: string
  isPrime: boolean
  requiredTokens: number
  minTokens: number
  maxTokens: number
  priorityRank: number
  /**
   * Per-(player, boss) edge cap; without it min-cost max-flow can spend one player's whole budget on
   * one boss. Tacticus uses 3, the in-game per-day cap.
   */
  maxTokensPerPlayer?: number
}

export interface SolverInputs {
  players: SolverPlayer[]
  bosses: SolverBoss[]
  /** Higher = preferred. A missing entry means ineligible (no edge); 0 is still eligible. */
  scores: Record<string, Record<string, number | null | undefined>>
}

export interface Assignment {
  playerId: string
  bossId: string
  tokens: number
  score: number
  reasoning?: string
}

export interface SolverCoverage {
  required: number
  assigned: number
  gap: number
  percentage: number
}

export interface SolverResult {
  assignments: Assignment[]
  totalTokensAssigned: number
  totalScore: number
  coverage: Record<string, SolverCoverage>
}

type Edge = {
  to: number
  rev: number
  cap: number
  cost: number
  originalCap: number
}

export class MinCostFlow {
  private graph: Edge[][]

  constructor(nodeCount: number) {
    this.graph = Array.from({ length: nodeCount }, () => [])
  }

  addEdge(from: number, to: number, cap: number, cost: number): number {
    const fromEdges = this.graph[from]
    const toEdges = this.graph[to]
    if (!fromEdges || !toEdges) {
      throw new RangeError(`Invalid min-cost-flow edge ${from}->${to}`)
    }

    const forward: Edge = {
      to,
      rev: toEdges.length,
      cap,
      cost,
      originalCap: cap
    }
    const backward: Edge = {
      to: from,
      rev: fromEdges.length,
      cap: 0,
      cost: -cost,
      originalCap: 0
    }
    fromEdges.push(forward)
    toEdges.push(backward)
    return fromEdges.length - 1
  }

  getGraph() {
    return this.graph
  }

  minCostMaxFlow(source: number, sink: number, maxFlow: number) {
    let flow = 0
    let cost = 0

    const nodeCount = this.graph.length

    while (flow < maxFlow) {
      const dist = Array(nodeCount).fill(Number.POSITIVE_INFINITY)
      const prevNode = Array(nodeCount).fill(-1)
      const prevEdge = Array(nodeCount).fill(-1)

      dist[source] = 0
      let updated = true

      for (let i = 0; i < nodeCount && updated; i += 1) {
        updated = false
        for (let v = 0; v < nodeCount; v += 1) {
          if (!Number.isFinite(dist[v])) continue
          const edges = this.graph[v]
          if (!edges) continue
          for (let e = 0; e < edges.length; e += 1) {
            const edge = edges[e]
            if (!edge) continue
            if (edge.cap <= 0) continue
            const nextDist = dist[v] + edge.cost
            if (nextDist + 1e-9 < dist[edge.to]) {
              dist[edge.to] = nextDist
              prevNode[edge.to] = v
              prevEdge[edge.to] = e
              updated = true
            }
          }
        }
      }

      if (!Number.isFinite(dist[sink])) break

      let addFlow = maxFlow - flow
      for (let v = sink; v !== source; v = prevNode[v]) {
        const edge = this.graph[prevNode[v]]?.[prevEdge[v]]
        if (!edge) {
          throw new Error('Min-cost-flow predecessor edge missing')
        }
        addFlow = Math.min(addFlow, edge.cap)
      }

      flow += addFlow
      cost += addFlow * dist[sink]

      for (let v = sink; v !== source; v = prevNode[v]) {
        const edge = this.graph[prevNode[v]]?.[prevEdge[v]]
        if (!edge) {
          throw new Error('Min-cost-flow predecessor edge missing')
        }
        edge.cap -= addFlow
        const reverseEdge = this.graph[v]?.[edge.rev]
        if (!reverseEdge) {
          throw new Error('Min-cost-flow reverse edge missing')
        }
        reverseEdge.cap += addFlow
      }
    }

    return { flow, cost, graph: this.graph }
  }
}

export type FlowRunResult = {
  assignments: Assignment[]
  totalFlow: number
  totalCost: number
  playerUsage: number[]
  bossUsage: number[]
}

export const runFlow = (
  players: SolverPlayer[],
  bosses: SolverBoss[],
  scores: Record<string, Record<string, number | null | undefined>>,
  playerCaps: number[],
  bossCaps: number[]
): FlowRunResult => {
  const nodeCount = 2 + players.length + bosses.length
  const source = 0
  const playerOffset = 1
  const bossOffset = playerOffset + players.length
  const sink = bossOffset + bosses.length

  const flow = new MinCostFlow(nodeCount)
  const edgeRefs: Array<{
    playerIndex: number
    bossIndex: number
    edgeIndex: number
  }> = []

  players.forEach((_player, playerIndex) => {
    const cap = Math.max(0, Math.trunc(playerCaps[playerIndex] ?? 0))
    if (cap > 0) {
      flow.addEdge(source, playerOffset + playerIndex, cap, 0)
    }
  })

  bosses.forEach((_boss, bossIndex) => {
    const cap = Math.max(0, Math.trunc(bossCaps[bossIndex] ?? 0))
    if (cap > 0) {
      flow.addEdge(bossOffset + bossIndex, sink, cap, 0)
    }
  })

  players.forEach((player, playerIndex) => {
    const playerNode = playerOffset + playerIndex
    bosses.forEach((boss, bossIndex) => {
      const bossNode = bossOffset + bossIndex
      const rawScore = scores[player.id]?.[boss.id]
      if (rawScore === null || rawScore === undefined) return
      const score = Math.max(0, rawScore)
      let rawCap = Math.min(player.maxTokens, boss.maxTokens)
      if (
        typeof boss.maxTokensPerPlayer === 'number' &&
        boss.maxTokensPerPlayer > 0
      ) {
        rawCap = Math.min(rawCap, boss.maxTokensPerPlayer)
      }
      const capacity = Math.max(0, Math.trunc(rawCap))
      if (capacity <= 0) return
      const edgeIndex = flow.addEdge(playerNode, bossNode, capacity, -score)
      edgeRefs.push({ playerIndex, bossIndex, edgeIndex })
    })
  })

  const totalDemand = bossCaps.reduce((sum, cap) => sum + Math.max(0, cap), 0)
  const totalSupply = playerCaps.reduce((sum, cap) => sum + Math.max(0, cap), 0)
  const targetFlow = Math.min(totalDemand, totalSupply)

  const result = flow.minCostMaxFlow(source, sink, targetFlow)

  const assignments: Assignment[] = []
  const playerUsage = Array(players.length).fill(0)
  const bossUsage = Array(bosses.length).fill(0)

  edgeRefs.forEach((ref) => {
    const playerNode = playerOffset + ref.playerIndex
    const edge = result.graph[playerNode]?.[ref.edgeIndex]
    if (!edge) return
    const used = edge.originalCap - edge.cap
    if (used > 0) {
      const player = players[ref.playerIndex]
      const boss = bosses[ref.bossIndex]
      if (!player || !boss) return
      const rawScore = scores[player.id]?.[boss.id]
      const score =
        rawScore === null || rawScore === undefined ? 0 : Math.max(0, rawScore)
      assignments.push({
        playerId: player.id,
        bossId: boss.id,
        tokens: used,
        score
      })
      playerUsage[ref.playerIndex] = (playerUsage[ref.playerIndex] ?? 0) + used
      bossUsage[ref.bossIndex] = (bossUsage[ref.bossIndex] ?? 0) + used
    }
  })

  return {
    assignments,
    totalFlow: result.flow,
    totalCost: result.cost,
    playerUsage,
    bossUsage
  }
}

export const mergeAssignments = (assignments: Assignment[]): Assignment[] => {
  const merged = new Map<string, Assignment>()

  assignments.forEach((entry) => {
    const key = `${entry.playerId}::${entry.bossId}`
    const existing = merged.get(key)
    if (existing) {
      existing.tokens += entry.tokens
    } else {
      merged.set(key, { ...entry })
    }
  })

  return Array.from(merged.values())
}

export const solveAssignments = ({
  players,
  bosses,
  scores
}: SolverInputs): SolverResult => {
  if (players.length === 0 || bosses.length === 0) {
    return {
      assignments: [],
      totalTokensAssigned: 0,
      totalScore: 0,
      coverage: {}
    }
  }

  const playerCaps = players.map((player) =>
    Math.max(0, Math.trunc(player.maxTokens))
  )

  const bossesByPriority = new Map<number, SolverBoss[]>()
  bosses.forEach((boss) => {
    const rank = Number.isFinite(boss.priorityRank) ? boss.priorityRank : 0
    const group = bossesByPriority.get(rank) ?? []
    group.push(boss)
    bossesByPriority.set(rank, group)
  })

  const priorityRanks = Array.from(bossesByPriority.keys()).sort(
    (a, b) => a - b
  )
  let remainingPlayerCaps = [...playerCaps]
  let assignments: Assignment[] = []

  priorityRanks.forEach((rank) => {
    const tierBosses = bossesByPriority.get(rank) ?? []
    if (tierBosses.length === 0) return

    const tierTargetCaps = tierBosses.map((boss) => {
      const desired = Math.max(boss.requiredTokens, boss.minTokens)
      return Math.max(0, desired)
    })

    const tierDemand = tierTargetCaps.reduce(
      (sum, cap) => sum + Math.max(0, cap),
      0
    )
    const tierSupply = remainingPlayerCaps.reduce(
      (sum, cap) => sum + Math.max(0, cap),
      0
    )
    if (tierDemand <= 0 || tierSupply <= 0) return

    const firstRun = runFlow(
      players,
      tierBosses,
      scores,
      remainingPlayerCaps,
      tierTargetCaps
    )
    assignments = assignments.concat(firstRun.assignments)
    remainingPlayerCaps = remainingPlayerCaps.map((cap, index) =>
      Math.max(0, cap - (firstRun.playerUsage[index] ?? 0))
    )
  })

  const mergedAssignments = mergeAssignments(assignments)

  const coverage: Record<string, SolverCoverage> = {}
  const totalScore = mergedAssignments.reduce(
    (sum, entry) => sum + entry.score * entry.tokens,
    0
  )
  const totalTokensAssigned = mergedAssignments.reduce(
    (sum, entry) => sum + entry.tokens,
    0
  )

  bosses.forEach((boss) => {
    const assigned = mergedAssignments
      .filter((entry) => entry.bossId === boss.id)
      .reduce((sum, entry) => sum + entry.tokens, 0)
    const required = Math.max(0, boss.requiredTokens)
    const gap = Math.max(0, required - assigned)
    const percentage = required > 0 ? (assigned / required) * 100 : 0
    coverage[boss.id] = { required, assigned, gap, percentage }
  })

  return {
    assignments: mergedAssignments,
    totalTokensAssigned,
    totalScore,
    coverage
  }
}
