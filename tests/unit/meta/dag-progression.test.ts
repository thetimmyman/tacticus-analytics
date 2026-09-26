import { describe, expect, it } from 'vitest'
import { resolveDagProgression } from '@/app/lib/meta/dag-progression'

type TableData = {
  meta_atlas_data: Array<Record<string, any>>
  meta_atlas_dag_edges: Array<Record<string, any>>
}

class MockQuery {
  private filters: Array<(row: Record<string, any>) => boolean> = []
  private orderBy: { field: string; ascending: boolean } | null = null
  private limitCount: number | null = null

  constructor(private rows: Array<Record<string, any>>) {}

  select(_columns: string) {
    return this
  }

  eq(field: string, value: any) {
    this.filters.push((row) => row[field] === value)
    return this
  }

  gte(field: string, value: number) {
    this.filters.push((row) => row[field] >= value)
    return this
  }

  gt(field: string, value: number) {
    this.filters.push((row) => row[field] > value)
    return this
  }

  in(field: string, values: any[]) {
    this.filters.push((row) => values.includes(row[field]))
    return this
  }

  order(field: string, options?: { ascending?: boolean }) {
    this.orderBy = {
      field,
      ascending: options?.ascending ?? true
    }
    return this
  }

  limit(count: number) {
    this.limitCount = count
    return this
  }

  maybeSingle() {
    return Promise.resolve(this.singleResult())
  }

  single() {
    return Promise.resolve(this.singleResult())
  }

  then<
    TResult1 = { data: Array<Record<string, any>>; error: null },
    TResult2 = never
  >(
    resolve?:
      | ((value: {
          data: Array<Record<string, any>>
          error: null
        }) => TResult1 | PromiseLike<TResult1>)
      | null,
    reject?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ) {
    return Promise.resolve(this.result()).then(resolve, reject)
  }

  private applyFilters() {
    let rows = [...this.rows]
    for (const filter of this.filters) {
      rows = rows.filter(filter)
    }
    if (this.orderBy) {
      const { field, ascending } = this.orderBy
      rows.sort((a, b) => {
        const aValue = a[field] ?? 0
        const bValue = b[field] ?? 0
        return ascending ? aValue - bValue : bValue - aValue
      })
    }
    if (this.limitCount != null) {
      rows = rows.slice(0, this.limitCount)
    }
    return rows
  }

  private result() {
    return { data: this.applyFilters(), error: null }
  }

  private singleResult() {
    const rows = this.applyFilters()
    return { data: rows[0] ?? null, error: null }
  }
}

const createSupabaseMock = (tables: TableData) => ({
  from: (table: keyof TableData) => new MockQuery(tables[table] ?? [])
})

const createTeamRow = (overrides: Record<string, any>) => ({
  team_hash: 'team',
  team_composition: 'Alpha, Beta, Delta, Epsilon, Gamma',
  meta_team: 'Meta',
  damage_p90: 0,
  attack_count: 40,
  boss_type: 'boss-1',
  boss_unit_id: null,
  encounter_index: 1,
  rarity_set: 'L1',
  season: 'S1',
  ...overrides
})

const expectResult = (result: any) => {
  if (result && 'error' in result) {
    throw new Error(`Unexpected error: ${result.error}`)
  }
  return result
}

describe('resolveDagProgression', () => {
  it('builds a roster baseline when no fully owned teams exist', async () => {
    const topTeam = 'Alpha, Beta, Gamma, Delta, Epsilon'
    const otherTeam = 'Zeta, Eta, Theta, Iota, Kappa'
    const supabase = createSupabaseMock({
      meta_atlas_data: [
        createTeamRow({
          team_hash: 'team-top',
          team_composition: topTeam,
          meta_team: 'Meta',
          damage_p90: 1000
        }),
        createTeamRow({
          team_hash: 'team-alt',
          team_composition: otherTeam,
          meta_team: 'Alt',
          damage_p90: 900
        })
      ],
      meta_atlas_dag_edges: []
    })

    const result = expectResult(
      await resolveDagProgression(supabase as any, {
        bossType: 'boss-1',
        encounterIndex: 1,
        raritySet: 'L1',
        season: 'S1',
        roster: ['Alpha', 'Gamma', 'Zeta', 'Eta', 'Lambda'],
        minAttacks: 0
      })
    )

    expect(result.best_buildable_team).toBe('Alpha, Gamma, Zeta, Eta, Lambda')
    expect(result.best_buildable_info?.damage_p90).toBe(1000)
    expect(result.is_optimal).toBe(false)
    expect(result.is_optimal_from_roster).toBe(false)
  })

  it('marks optimal and clears upgrade path when current exceeds target damage', async () => {
    const currentTeam = 'Alpha, Beta, Delta, Epsilon, Gamma'
    const metaTeam = 'Eta, Iota, Kappa, Theta, Zeta'
    const supabase = createSupabaseMock({
      meta_atlas_data: [
        createTeamRow({
          team_hash: 'team-current',
          team_composition: currentTeam,
          meta_team: 'Off Meta',
          damage_p90: 1200000
        }),
        createTeamRow({
          team_hash: 'team-meta',
          team_composition: metaTeam,
          meta_team: 'Meta',
          damage_p90: 900000
        })
      ],
      meta_atlas_dag_edges: [
        {
          from_team_hash: 'team-current',
          to_team_hash: 'team-meta',
          swapped_out: 'Alpha',
          swapped_in: 'Zeta',
          from_damage_p90: 1200000,
          to_damage_p90: 900000,
          damage_gain: 50000,
          boss_type: 'boss-1',
          encounter_index: 1,
          rarity_set: 'L1',
          season: 'S1'
        }
      ]
    })

    const result = expectResult(
      await resolveDagProgression(supabase as any, {
        bossType: 'boss-1',
        encounterIndex: 1,
        raritySet: 'L1',
        season: 'S1',
        currentTeam,
        roster: ['Eta', 'Iota', 'Kappa', 'Theta', 'Zeta'],
        minAttacks: 0
      })
    )

    expect(result.is_optimal).toBe(true)
    expect(result.upgrade_path).toHaveLength(0)
  })

  it('returns a linear upgrade path for standard data', async () => {
    const currentTeam = 'Alpha, Bravo, Charlie, Delta, Echo'
    const nextTeam = 'Alpha, Bravo, Charlie, Delta, Foxtrot'
    const finalTeam = 'Alpha, Bravo, Charlie, Delta, Golf'
    const supabase = createSupabaseMock({
      meta_atlas_data: [
        createTeamRow({
          team_hash: 'team-current',
          team_composition: currentTeam,
          meta_team: 'Current',
          damage_p90: 100000
        }),
        createTeamRow({
          team_hash: 'team-next',
          team_composition: nextTeam,
          meta_team: 'Next',
          damage_p90: 150000
        }),
        createTeamRow({
          team_hash: 'team-final',
          team_composition: finalTeam,
          meta_team: 'Meta',
          damage_p90: 200000
        })
      ],
      meta_atlas_dag_edges: [
        {
          from_team_hash: 'team-current',
          to_team_hash: 'team-next',
          swapped_out: 'Echo',
          swapped_in: 'Foxtrot',
          from_damage_p90: 100000,
          to_damage_p90: 150000,
          damage_gain: 50000,
          boss_type: 'boss-1',
          encounter_index: 1,
          rarity_set: 'L1',
          season: 'S1'
        },
        {
          from_team_hash: 'team-next',
          to_team_hash: 'team-final',
          swapped_out: 'Foxtrot',
          swapped_in: 'Golf',
          from_damage_p90: 150000,
          to_damage_p90: 200000,
          damage_gain: 50000,
          boss_type: 'boss-1',
          encounter_index: 1,
          rarity_set: 'L1',
          season: 'S1'
        }
      ]
    })

    const result = expectResult(
      await resolveDagProgression(supabase as any, {
        bossType: 'boss-1',
        encounterIndex: 1,
        raritySet: 'L1',
        season: 'S1',
        currentTeam,
        minAttacks: 0
      })
    )

    expect(result.upgrade_path).toHaveLength(2)
    expect(result.target_team).toBe(finalTeam)
    expect(result.total_damage_increase).toBe(100000)
  })

  it('keeps zero-gain steps so the DAG path does not stall', async () => {
    const currentTeam = 'Alpha, Bravo, Charlie, Delta, Echo'
    const nextTeam = 'Alpha, Bravo, Charlie, Delta, Foxtrot'
    const finalTeam = 'Alpha, Bravo, Charlie, Delta, Golf'
    const supabase = createSupabaseMock({
      meta_atlas_data: [
        createTeamRow({
          team_hash: 'team-current',
          team_composition: currentTeam,
          meta_team: 'Current',
          damage_p90: 100000
        }),
        createTeamRow({
          team_hash: 'team-next',
          team_composition: nextTeam,
          meta_team: 'Next',
          damage_p90: 100000
        }),
        createTeamRow({
          team_hash: 'team-final',
          team_composition: finalTeam,
          meta_team: 'Meta',
          damage_p90: 150000
        })
      ],
      meta_atlas_dag_edges: [
        {
          from_team_hash: 'team-current',
          to_team_hash: 'team-next',
          swapped_out: 'Echo',
          swapped_in: 'Foxtrot',
          from_damage_p90: 100000,
          to_damage_p90: 100000,
          damage_gain: 0,
          boss_type: 'boss-1',
          encounter_index: 1,
          rarity_set: 'L1',
          season: 'S1'
        },
        {
          from_team_hash: 'team-next',
          to_team_hash: 'team-final',
          swapped_out: 'Foxtrot',
          swapped_in: 'Golf',
          from_damage_p90: 100000,
          to_damage_p90: 150000,
          damage_gain: 50000,
          boss_type: 'boss-1',
          encounter_index: 1,
          rarity_set: 'L1',
          season: 'S1'
        }
      ]
    })

    const result = expectResult(
      await resolveDagProgression(supabase as any, {
        bossType: 'boss-1',
        encounterIndex: 1,
        raritySet: 'L1',
        season: 'S1',
        currentTeam,
        minAttacks: 0
      })
    )

    expect(result.upgrade_path).toHaveLength(2)
    expect(result.target_team).toBe(finalTeam)
  })
})
