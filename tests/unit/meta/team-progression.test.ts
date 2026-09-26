import { describe, it, expect } from 'vitest'
import {
  calculateCommonMembers,
  calculateSimilarityScore,
  buildCommonMembersMatrix,
  findSwappedMember,
  createTeamDAG,
  getSubDAG,
  findUpgradePaths,
  findProgressionPath,
  dagToMermaid,
  dagToJSON,
  type TeamData,
  type TeamDAG
} from '@/app/lib/meta/team-progression'

describe('team-progression', () => {
  describe('calculateCommonMembers', () => {
    it('returns 6 for identical teams', () => {
      const team = 'Alpha, Beta, Charlie, Delta, Echo + Land Raider'

      expect(calculateCommonMembers(team, team)).toBe(6)
    })

    it('returns 5 for single hero swap', () => {
      const team1 = 'Alpha, Beta, Charlie, Delta, Echo + Land Raider'
      const team2 = 'Alpha, Beta, Charlie, Delta, Foxtrot + Land Raider'

      expect(calculateCommonMembers(team1, team2)).toBe(5)
    })

    it('returns 5 for MoW swap', () => {
      const team1 = 'Alpha, Beta, Charlie, Delta, Echo + Land Raider'
      const team2 = 'Alpha, Beta, Charlie, Delta, Echo + Rhino'

      expect(calculateCommonMembers(team1, team2)).toBe(5)
    })

    it('returns 0 for completely different teams', () => {
      const team1 = 'Alpha, Beta, Charlie, Delta, Echo + Land Raider'
      const team2 = 'Foxtrot, Golf, Hotel, India, Juliet + Rhino'

      expect(calculateCommonMembers(team1, team2)).toBe(0)
    })

    it('handles teams without MoW', () => {
      const team1 = 'Alpha, Beta, Charlie, Delta, Echo'
      const team2 = 'Alpha, Beta, Charlie, Delta, Foxtrot'

      expect(calculateCommonMembers(team1, team2)).toBe(4)
    })

    it('is case insensitive', () => {
      const team1 = 'Alpha, Beta, Charlie'
      const team2 = 'ALPHA, BETA, CHARLIE'

      expect(calculateCommonMembers(team1, team2)).toBe(3)
    })
  })

  describe('calculateSimilarityScore', () => {
    it('returns 6 for identical teams', () => {
      const team = 'Alpha, Beta, Charlie, Delta, Echo + Land Raider'

      expect(calculateSimilarityScore(team, team)).toBe(6)
    })

    it('returns 5 for single swap', () => {
      const team1 = 'Alpha, Beta, Charlie, Delta, Echo + Land Raider'
      const team2 = 'Alpha, Beta, Charlie, Delta, Foxtrot + Land Raider'

      expect(calculateSimilarityScore(team1, team2)).toBe(5)
    })

    it('returns lower score for more differences', () => {
      const team1 = 'Alpha, Beta, Charlie, Delta, Echo'
      const team2 = 'Alpha, Beta, Foxtrot, Golf, Hotel'

      expect(calculateSimilarityScore(team1, team2)).toBeLessThan(5)
    })
  })

  describe('buildCommonMembersMatrix', () => {
    it('returns empty matrix for empty input', () => {
      const matrix = buildCommonMembersMatrix([])

      expect(matrix).toEqual([])
    })

    it('builds correct matrix for single team', () => {
      const teams = ['Alpha, Beta, Charlie']
      const matrix = buildCommonMembersMatrix(teams)

      expect(matrix).toHaveLength(1)
      expect(matrix[0]).toHaveLength(1)
      expect(matrix[0][0]).toBe(3)
    })

    it('builds symmetric matrix', () => {
      const teams = ['Alpha, Beta, Charlie', 'Alpha, Beta, Delta']
      const matrix = buildCommonMembersMatrix(teams)

      expect(matrix[0][1]).toBe(matrix[1][0])
    })

    it('diagonal entries equal team size', () => {
      const teams = [
        'Alpha, Beta, Charlie, Delta, Echo + MoW',
        'Foxtrot, Golf, Hotel, India, Juliet + MoW2'
      ]
      const matrix = buildCommonMembersMatrix(teams)

      expect(matrix[0][0]).toBe(6)
      expect(matrix[1][1]).toBe(6)
    })
  })

  describe('findSwappedMember', () => {
    it('finds single hero swap', () => {
      const team1 = 'Alpha, Beta, Charlie, Delta, Echo'
      const team2 = 'Alpha, Beta, Charlie, Delta, Foxtrot'

      const result = findSwappedMember(team1, team2)

      expect(result).toEqual({
        swappedOut: 'echo',
        swappedIn: 'foxtrot'
      })
    })

    it('finds MoW swap', () => {
      const team1 = 'Alpha, Beta, Charlie, Delta, Echo + Land Raider'
      const team2 = 'Alpha, Beta, Charlie, Delta, Echo + Rhino'

      const result = findSwappedMember(team1, team2)

      expect(result).toEqual({
        swappedOut: 'land raider',
        swappedIn: 'rhino'
      })
    })

    it('returns null for identical teams', () => {
      const team = 'Alpha, Beta, Charlie, Delta, Echo'

      const result = findSwappedMember(team, team)

      expect(result).toBeNull()
    })

    it('returns null for multiple swaps', () => {
      const team1 = 'Alpha, Beta, Charlie, Delta, Echo'
      const team2 = 'Alpha, Beta, Foxtrot, Golf, Hotel'

      const result = findSwappedMember(team1, team2)

      expect(result).toBeNull()
    })
  })

  describe('createTeamDAG', () => {
    it('returns empty DAG for empty input', () => {
      const dag = createTeamDAG([])

      expect(dag.nodes.size).toBe(0)
      expect(dag.edges).toHaveLength(0)
      expect(dag.metadata.isDAG).toBe(true)
    })

    it('creates nodes for all teams', () => {
      const teams: TeamData[] = [
        {
          team_composition: 'Alpha, Beta, Charlie, Delta, Echo',
          damage_p90: 100000,
          attack_count: 50
        },
        {
          team_composition: 'Alpha, Beta, Charlie, Delta, Foxtrot',
          damage_p90: 120000,
          attack_count: 45
        }
      ]

      const dag = createTeamDAG(teams)

      expect(dag.nodes.size).toBe(2)
    })

    it('creates edge for single-swap upgrade when minCommonMembers is 4', () => {
      const teams: TeamData[] = [
        {
          team_composition: 'Alpha, Beta, Charlie, Delta, Echo',
          damage_p90: 100000,
          attack_count: 50
        },
        {
          team_composition: 'Alpha, Beta, Charlie, Delta, Foxtrot',
          damage_p90: 120000,
          attack_count: 45
        }
      ]

      const dag = createTeamDAG(teams, { minCommonMembers: 4 })

      expect(dag.edges.length).toBeGreaterThan(0)
      expect(dag.edges[0].swappedOut).toBeDefined()
      expect(dag.edges[0].swappedIn).toBeDefined()
    })

    it('sorts teams by damage descending', () => {
      const teams: TeamData[] = [
        { team_composition: 'Low', damage_p90: 50000, attack_count: 50 },
        { team_composition: 'High', damage_p90: 150000, attack_count: 50 },
        { team_composition: 'Mid', damage_p90: 100000, attack_count: 50 }
      ]

      const dag = createTeamDAG(teams)
      const nodesArray = Array.from(dag.nodes.values())

      expect(nodesArray[0].damageP90).toBe(150000)
    })

    it('includes season and raritySet in metadata', () => {
      const teams: TeamData[] = [
        {
          team_composition: 'Alpha, Beta, Charlie',
          damage_p90: 100000,
          attack_count: 50
        }
      ]

      const dag = createTeamDAG(teams, { season: 'S1', raritySet: 'L1' })

      expect(dag.metadata.season).toBe('S1')
      expect(dag.metadata.raritySet).toBe('L1')
    })

    it('respects minCommonMembers option', () => {
      const teams: TeamData[] = [
        {
          team_composition: 'Alpha, Beta, Charlie, Delta, Echo',
          damage_p90: 100000,
          attack_count: 50
        },
        {
          team_composition: 'Alpha, Beta, Foxtrot, Golf, Hotel',
          damage_p90: 120000,
          attack_count: 45
        }
      ]

      const strictDag = createTeamDAG(teams, { minCommonMembers: 5 })
      const looseDag = createTeamDAG(teams, { minCommonMembers: 2 })

      expect(strictDag.edges.length).toBeLessThanOrEqual(looseDag.edges.length)
    })
  })

  describe('getSubDAG', () => {
    const createTestDAG = (): TeamDAG => {
      return createTeamDAG([
        {
          team_composition: 'A, B, C, D, E',
          damage_p90: 100000,
          attack_count: 50
        },
        {
          team_composition: 'A, B, C, D, F',
          damage_p90: 120000,
          attack_count: 45
        },
        {
          team_composition: 'A, B, C, D, G',
          damage_p90: 140000,
          attack_count: 40
        }
      ])
    }

    it('returns null for non-existent starting team', () => {
      const dag = createTestDAG()

      const subDag = getSubDAG(dag, 'NonExistent, Team, Comp')

      expect(subDag).toBeNull()
    })

    it('returns subDAG with correct startNode', () => {
      const dag = createTestDAG()
      const startComp = 'A, B, C, D, E'

      const subDag = getSubDAG(dag, startComp)

      expect(subDag).not.toBeNull()
      expect(subDag?.startNode).toBeDefined()
    })

    it('includes only reachable nodes', () => {
      const dag = createTestDAG()
      const startComp = 'A, B, C, D, E'

      const subDag = getSubDAG(dag, startComp)

      expect(subDag?.nodes.size).toBeLessThanOrEqual(dag.nodes.size)
    })
  })

  describe('findUpgradePaths', () => {
    it('returns empty array when no upgrades available', () => {
      const dag = createTeamDAG([
        {
          team_composition: 'A, B, C, D, E',
          damage_p90: 100000,
          attack_count: 50
        }
      ])

      const paths = findUpgradePaths(dag, 'A, B, C, D, E')

      expect(paths).toHaveLength(0)
    })

    it('finds upgrade with higher damage when edges exist', () => {
      const dag = createTeamDAG(
        [
          {
            team_composition: 'A, B, C, D, E + MoW',
            damage_p90: 100000,
            attack_count: 50
          },
          {
            team_composition: 'A, B, C, D, F + MoW',
            damage_p90: 150000,
            attack_count: 45
          }
        ],
        { minCommonMembers: 5 }
      )

      const paths = findUpgradePaths(dag, 'A, B, C, D, E + MoW')

      expect(paths.length).toBeGreaterThan(0)
      expect(paths[0].damageIncrease).toBe(50000)
    })

    it('sorts paths by damage increase descending when edges exist', () => {
      const dag = createTeamDAG(
        [
          {
            team_composition: 'A, B, C, D, E',
            damage_p90: 100000,
            attack_count: 50
          },
          {
            team_composition: 'A, B, C, D, F',
            damage_p90: 120000,
            attack_count: 45
          },
          {
            team_composition: 'A, B, C, D, G',
            damage_p90: 150000,
            attack_count: 40
          }
        ],
        { minCommonMembers: 4 }
      )

      const paths = findUpgradePaths(dag, 'A, B, C, D, E')

      for (let i = 1; i < paths.length; i++) {
        expect(paths[i - 1].damageIncrease).toBeGreaterThanOrEqual(
          paths[i].damageIncrease
        )
      }
    })

    it('calculates percent increase correctly when edges exist', () => {
      const dag = createTeamDAG(
        [
          {
            team_composition: 'A, B, C, D, E + MoW',
            damage_p90: 100000,
            attack_count: 50
          },
          {
            team_composition: 'A, B, C, D, F + MoW',
            damage_p90: 150000,
            attack_count: 45
          }
        ],
        { minCommonMembers: 5 }
      )

      const paths = findUpgradePaths(dag, 'A, B, C, D, E + MoW')

      expect(paths.length).toBeGreaterThan(0)
      expect(paths[0].percentIncrease).toBe(50)
    })
  })

  describe('findProgressionPath', () => {
    it('returns empty path when no upgrades match roster', () => {
      const dag = createTeamDAG([
        {
          team_composition: 'A, B, C, D, E',
          damage_p90: 100000,
          attack_count: 50
        },
        {
          team_composition: 'A, B, C, D, F',
          damage_p90: 150000,
          attack_count: 45
        }
      ])

      const roster = new Set(['a', 'b', 'c', 'd', 'e'])
      const path = findProgressionPath(dag, 'A, B, C, D, E', roster)

      expect(path).toHaveLength(0)
    })

    it('finds a single-step progression when roster has the required swap-in hero', () => {
      // A MoW keeps 5 common members after a swap (the edge threshold), or the assertion is vacuous.
      const dag = createTeamDAG([
        {
          team_composition: 'A, B, C, D, E + MoW',
          damage_p90: 100000,
          attack_count: 50
        },
        {
          team_composition: 'A, B, C, D, F + MoW',
          damage_p90: 150000,
          attack_count: 45
        }
      ])

      const roster = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'mow'])
      const path = findProgressionPath(dag, 'A, B, C, D, E + MoW', roster)

      expect(path).toHaveLength(1)
      const step = path[0]!
      expect(step.swappedOut).toBe('e')
      expect(step.swappedIn).toBe('f')
      expect(step.to.composition).toBe('A, B, C, D, F + MoW')
      expect(step.damageIncrease).toBe(50000)
    })

    it('walks a multi-hop progression chain swapping in roster heroes in order', () => {
      const dag = createTeamDAG([
        {
          team_composition: 'A, B, C, D, E + MoW',
          damage_p90: 100000,
          attack_count: 50
        },
        {
          team_composition: 'A, B, C, D, F + MoW',
          damage_p90: 150000,
          attack_count: 45
        },
        {
          team_composition: 'A, B, C, F, G + MoW',
          damage_p90: 200000,
          attack_count: 40
        }
      ])

      const roster = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'mow'])
      const path = findProgressionPath(dag, 'A, B, C, D, E + MoW', roster)

      expect(path).toHaveLength(2)
      expect(path.map((p) => p.swappedIn)).toEqual(['f', 'g'])
      expect(path[1]!.to.composition).toBe('A, B, C, F, G + MoW')
    })

    it('stops progression when the roster lacks the swap-in hero', () => {
      const dag = createTeamDAG([
        {
          team_composition: 'A, B, C, D, E + MoW',
          damage_p90: 100000,
          attack_count: 50
        },
        {
          team_composition: 'A, B, C, D, F + MoW',
          damage_p90: 150000,
          attack_count: 45
        }
      ])

      const roster = new Set(['a', 'b', 'c', 'd', 'e', 'mow'])
      const path = findProgressionPath(dag, 'A, B, C, D, E + MoW', roster)

      expect(path).toHaveLength(0)
    })

    it('respects MAX_ITERATIONS limit', () => {
      const teams: TeamData[] = []
      for (let i = 0; i < 60; i++) {
        teams.push({
          team_composition: `A, B, C, D, Hero${i}`,
          damage_p90: 100000 + i * 1000,
          attack_count: 50
        })
      }

      const dag = createTeamDAG(teams)
      const roster = new Set(
        teams.map((_, i) => `hero${i}`).concat(['a', 'b', 'c', 'd'])
      )

      const path = findProgressionPath(dag, 'A, B, C, D, Hero0', roster)

      expect(path.length).toBeLessThanOrEqual(50)
    })
  })

  describe('dagToMermaid', () => {
    it('returns flowchart header', () => {
      const dag = createTeamDAG([])
      const mermaid = dagToMermaid(dag)

      expect(mermaid).toContain('flowchart TD')
    })

    it('includes edge labels with swap info', () => {
      const dag = createTeamDAG([
        {
          team_composition: 'A, B, C, D, E + MoW',
          damage_p90: 100000,
          attack_count: 50
        },
        {
          team_composition: 'A, B, C, D, F + MoW',
          damage_p90: 150000,
          attack_count: 45
        }
      ])

      expect(dag.edges).toHaveLength(1)

      const mermaid = dagToMermaid(dag)

      expect(mermaid).toContain('flowchart TD')
      expect(mermaid).toContain('-->')
      expect(mermaid).toContain('|e → f|')
    })
  })

  describe('dagToJSON', () => {
    it('returns object with nodes, edges, and metadata', () => {
      const dag = createTeamDAG([
        { team_composition: 'A, B, C', damage_p90: 100000, attack_count: 50 }
      ])

      const json = dagToJSON(dag)

      expect(json).toHaveProperty('nodes')
      expect(json).toHaveProperty('edges')
      expect(json).toHaveProperty('metadata')
    })

    it('serializes nodes as composition strings', () => {
      const dag = createTeamDAG([
        {
          team_composition: 'Alpha, Beta, Charlie',
          damage_p90: 100000,
          attack_count: 50
        }
      ])

      const json = dagToJSON(dag) as { nodes: Record<number, string> }

      expect(Object.values(json.nodes)[0]).toBe('Alpha, Beta, Charlie')
    })

    it('serializes edges as [from, to] tuples', () => {
      const dag = createTeamDAG([
        {
          team_composition: 'A, B, C, D, E + MoW',
          damage_p90: 100000,
          attack_count: 50
        },
        {
          team_composition: 'A, B, C, D, F + MoW',
          damage_p90: 150000,
          attack_count: 45
        }
      ])

      const json = dagToJSON(dag) as { edges: [number, number][] }

      expect(json.edges).toHaveLength(1)
      expect(json.edges[0]).toHaveLength(2)
      expect(json.edges[0]).toEqual([2, 1])
    })
  })
})
