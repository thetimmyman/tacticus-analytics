import { parseTeamComposition } from '@/app/lib/meta/team-coverage'

export interface TeamNode {
  id: number
  composition: string
  heroes: string[]
  mow: string | null
  damageP90: number
  attackCount: number
  metaTeam: string | null
}

export interface TeamEdge {
  from: number
  to: number
  swappedOut: string
  swappedIn: string
}

export interface TeamDAG {
  nodes: Map<number, TeamNode>
  edges: TeamEdge[]
  metadata: {
    numNodes: number
    numEdges: number
    isDAG: boolean
    season?: string
    raritySet?: string
  }
}

export interface SubDAG extends TeamDAG {
  startNode: number
}

export interface UpgradePath {
  from: TeamNode
  to: TeamNode
  swappedOut: string
  swappedIn: string
  damageIncrease: number
  percentIncrease: number
}

function getTeamMembers(composition: string): Set<string> {
  const { heroes, mow } = parseTeamComposition(composition)
  const members = new Set(heroes.map((h) => h.toLowerCase()))
  if (mow) {
    members.add(mow.toLowerCase())
  }
  return members
}

export function calculateCommonMembers(team1: string, team2: string): number {
  const members1 = getTeamMembers(team1)
  const members2 = getTeamMembers(team2)

  const symmetricDiff = new Set(
    [...members1, ...members2].filter(
      (m) => !members1.has(m) || !members2.has(m)
    )
  )

  const unionSize = new Set([...members1, ...members2]).size
  const intersectionSize = unionSize - symmetricDiff.size

  return intersectionSize
}

export function calculateSimilarityScore(team1: string, team2: string): number {
  const members1 = getTeamMembers(team1)
  const members2 = getTeamMembers(team2)

  const symmetricDiffSize = [...members1, ...members2].filter(
    (m) => !(members1.has(m) && members2.has(m))
  ).length

  return 6 - symmetricDiffSize / 2
}

export function buildCommonMembersMatrix(teams: string[]): number[][] {
  const n = teams.length
  const matrix: number[][] = Array(n)
    .fill(null)
    .map(() => Array(n).fill(0))

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const teamA = teams[i]
      const teamB = teams[j]
      if (!teamA || !teamB) {
        continue
      }
      const row = matrix[i]
      if (!row) continue
      row[j] = calculateCommonMembers(teamA, teamB)
    }
  }

  return matrix
}

export function findSwappedMember(
  team1: string,
  team2: string
): { swappedOut: string; swappedIn: string } | null {
  const members1 = getTeamMembers(team1)
  const members2 = getTeamMembers(team2)

  const removed = [...members1].filter((m) => !members2.has(m))
  const added = [...members2].filter((m) => !members1.has(m))

  if (removed.length === 1 && added.length === 1) {
    const swappedOut = removed[0]
    const swappedIn = added[0]
    if (!swappedOut || !swappedIn) {
      return null
    }
    return {
      swappedOut,
      swappedIn
    }
  }

  return null
}

export interface TeamData {
  team_composition: string
  damage_p90: number
  attack_count: number
  meta_team?: string | null
}

export function createTeamDAG(
  teams: TeamData[],
  options: {
    minCommonMembers?: number
    season?: string
    raritySet?: string
  } = {}
): TeamDAG {
  const { minCommonMembers = 5, season, raritySet } = options

  const sortedTeams = [...teams].sort((a, b) => b.damage_p90 - a.damage_p90)

  const nodes = new Map<number, TeamNode>()
  const edges: TeamEdge[] = []

  sortedTeams.forEach((team, idx) => {
    const id = idx + 1
    const { heroes, mow } = parseTeamComposition(team.team_composition)
    nodes.set(id, {
      id,
      composition: team.team_composition,
      heroes,
      mow,
      damageP90: team.damage_p90,
      attackCount: team.attack_count,
      metaTeam: team.meta_team || null
    })
  })

  const compositions = sortedTeams.map((t) => t.team_composition)
  const matrix = buildCommonMembersMatrix(compositions)

  for (let i = 0; i < matrix.length; i++) {
    for (let j = 0; j < i; j++) {
      const row = matrix[i]
      const leftComposition = compositions[i]
      const rightComposition = compositions[j]
      if (!row || !leftComposition || !rightComposition) {
        continue
      }
      if ((row[j] ?? 0) >= minCommonMembers) {
        const swap = findSwappedMember(leftComposition, rightComposition)
        if (swap) {
          edges.push({
            from: i + 1,
            to: j + 1,
            swappedOut: swap.swappedOut,
            swappedIn: swap.swappedIn
          })
        }
        break
      }
    }
  }

  return {
    nodes,
    edges,
    metadata: {
      numNodes: nodes.size,
      numEdges: edges.length,
      isDAG: true,
      season,
      raritySet
    }
  }
}

export function getSubDAG(
  dag: TeamDAG,
  startComposition: string
): SubDAG | null {
  let startNodeId: number | null = null

  for (const [id, node] of dag.nodes) {
    if (node.composition === startComposition) {
      startNodeId = id
      break
    }
  }

  if (startNodeId === null) {
    return null
  }

  const adjList = new Map<number, number[]>()
  for (const [id] of dag.nodes) {
    adjList.set(id, [])
  }
  for (const edge of dag.edges) {
    adjList.get(edge.from)?.push(edge.to)
  }

  const visited = new Set<number>()
  const reachable = new Set<number>()

  function dfs(nodeId: number) {
    if (visited.has(nodeId)) return
    visited.add(nodeId)
    reachable.add(nodeId)

    const neighbors = adjList.get(nodeId) || []
    for (const neighbor of neighbors) {
      dfs(neighbor)
    }
  }

  dfs(startNodeId)

  const subNodes = new Map<number, TeamNode>()
  for (const id of reachable) {
    const node = dag.nodes.get(id)
    if (node) {
      subNodes.set(id, node)
    }
  }

  const subEdges = dag.edges.filter(
    (edge) => reachable.has(edge.from) && reachable.has(edge.to)
  )

  return {
    nodes: subNodes,
    edges: subEdges,
    startNode: startNodeId,
    metadata: {
      numNodes: subNodes.size,
      numEdges: subEdges.length,
      isDAG: true,
      season: dag.metadata.season,
      raritySet: dag.metadata.raritySet
    }
  }
}

export function findUpgradePaths(
  dag: TeamDAG,
  currentTeam: string
): UpgradePath[] {
  const paths: UpgradePath[] = []
  const currentMembers = getTeamMembers(currentTeam)

  for (const [, node] of dag.nodes) {
    const commonCount = calculateCommonMembers(currentTeam, node.composition)

    if (commonCount === 5) {
      const swap = findSwappedMember(currentTeam, node.composition)
      if (swap) {
        const currentNode = [...dag.nodes.values()].find(
          (n) => n.composition === currentTeam
        )
        const currentDamage = currentNode?.damageP90 || 0

        if (node.damageP90 > currentDamage) {
          paths.push({
            from: currentNode || {
              id: 0,
              composition: currentTeam,
              heroes: [...currentMembers].filter((m) => m !== swap.swappedOut),
              mow: null,
              damageP90: currentDamage,
              attackCount: 0,
              metaTeam: null
            },
            to: node,
            swappedOut: swap.swappedOut,
            swappedIn: swap.swappedIn,
            damageIncrease: node.damageP90 - currentDamage,
            percentIncrease:
              currentDamage > 0
                ? ((node.damageP90 - currentDamage) / currentDamage) * 100
                : 0
          })
        }
      }
    }
  }

  return paths.sort((a, b) => b.damageIncrease - a.damageIncrease)
}

export function findProgressionPath(
  dag: TeamDAG,
  startTeam: string,
  roster: Set<string>
): UpgradePath[] {
  const path: UpgradePath[] = []
  let currentTeam = startTeam
  const usedHeroes = new Set(getTeamMembers(currentTeam))

  const MAX_ITERATIONS = 50
  let iterations = 0

  while (iterations < MAX_ITERATIONS) {
    iterations++

    const upgrades = findUpgradePaths(dag, currentTeam)

    const feasibleUpgrade = upgrades.find((upgrade) => {
      const newHeroLower = upgrade.swappedIn.toLowerCase()
      return roster.has(newHeroLower) && !usedHeroes.has(newHeroLower)
    })

    if (!feasibleUpgrade) break

    path.push(feasibleUpgrade)
    currentTeam = feasibleUpgrade.to.composition
    usedHeroes.add(feasibleUpgrade.swappedIn.toLowerCase())
  }

  return path
}

export function dagToMermaid(dag: TeamDAG): string {
  const lines = ['flowchart TD']

  for (const edge of dag.edges) {
    const fromNode = dag.nodes.get(edge.from)
    const toNode = dag.nodes.get(edge.to)

    if (fromNode && toNode) {
      const fromLabel = fromNode.metaTeam || `Team${edge.from}`
      const toLabel = toNode.metaTeam || `Team${edge.to}`
      lines.push(
        `    ${edge.from}["${fromLabel}"] --> |${edge.swappedOut} → ${edge.swappedIn}| ${edge.to}["${toLabel}"]`
      )
    }
  }

  return lines.join('\n')
}

export function dagToJSON(dag: TeamDAG): object {
  const nodesObj: Record<number, string> = {}
  for (const [id, node] of dag.nodes) {
    nodesObj[id] = node.composition
  }

  return {
    nodes: nodesObj,
    edges: dag.edges.map((e) => [e.from, e.to]),
    metadata: dag.metadata
  }
}
