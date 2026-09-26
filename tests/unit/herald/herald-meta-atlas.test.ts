import { describe, it, expect, vi, beforeEach } from 'vitest'

// Deterministic BOSS_ID_LOOKUP, independent of the real GlobalConfig.json.
vi.mock('@/app/lib/loki/season-configs', () => ({
  SEASON_CONFIGS: [
    {
      id: 'config_1',
      bosses: [
        {
          boss_type: 'Belisarius',
          boss_name: 'Belisarius Cawl',
          encounter_id: 0,
          set: 0,
          rarity: 'Legendary'
        },
        {
          boss_type: 'Belisarius',
          boss_name: 'Actus',
          encounter_id: 1,
          set: 0,
          rarity: 'Legendary'
        },
        {
          boss_type: 'Belisarius',
          boss_name: "Tan Gi'da",
          encounter_id: 2,
          set: 0,
          rarity: 'Legendary'
        },
        {
          boss_type: 'Ghazghkull',
          boss_name: 'Ghazghkull',
          encounter_id: 0,
          set: 0,
          rarity: 'Legendary'
        }
      ],
      canonicalOrder: ['belisarius', 'ghazghkull']
    }
  ]
}))

import { fetchHeraldSeedFromMetaAtlas } from '@/app/lib/herald/meta-atlas'

type MetaAtlasRow = {
  boss_type: string
  sub_boss_name: string
  rarity: string
  meta_team: string
  damage_p90: number | null
  attack_count: number | null
  encounter_index: number
  set_num?: number
  /** Defaults to the mock's season; production picks each boss's latest season. */
  season?: string
}

const makeSupabaseMock = (rows: MetaAtlasRow[], season = '98') => {
  const enriched = rows.map((r) => ({ season, set_num: 0, ...r }))

  const makeThenable = <T>(data: T) => {
    const chain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis()
    }
    const promise = Promise.resolve({ data, error: null })
    chain.then = (onFulfilled: (v: Record<string, unknown>) => unknown) =>
      promise.then(onFulfilled)
    return chain
  }

  const seasonListChain = makeThenable([{ season }])
  const rowsChain = makeThenable(enriched)

  const from = vi.fn((table: string) => {
    if (table !== 'meta_atlas_data')
      throw new Error(`unexpected table ${table}`)
    return {
      select: vi.fn().mockImplementation((cols: string) => {
        if (cols === 'season') return seasonListChain
        return rowsChain
      })
    }
  })
  return { from } as unknown as Parameters<
    typeof fetchHeraldSeedFromMetaAtlas
  >[0]
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('fetchHeraldSeedFromMetaAtlas', () => {
  it('returns empty result when there is no season in meta atlas', async () => {
    const seasonListChain: Record<string, unknown> = {
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis()
    }
    const promise = Promise.resolve({ data: [], error: null })
    seasonListChain.then = (
      onFulfilled: (v: Record<string, unknown>) => unknown
    ) => promise.then(onFulfilled)

    const supabase = {
      from: vi.fn().mockReturnValue({ select: () => seasonListChain })
    } as unknown as Parameters<typeof fetchHeraldSeedFromMetaAtlas>[0]

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    expect(result.season).toBeNull()
    expect(result.teams).toEqual([])
    expect(result.seasonsTried).toEqual([])
  })

  it('ranks top-2 teams per boss and groups by meta_team', async () => {
    const supabase = makeSupabaseMock([
      {
        boss_type: 'Belisarius',
        sub_boss_name: 'Belisarius Cawl',
        rarity: 'Legendary',
        meta_team: 'Neuro',
        damage_p90: 5_000_000,
        attack_count: 50,
        encounter_index: 0
      },
      {
        boss_type: 'Belisarius',
        sub_boss_name: 'Belisarius Cawl',
        rarity: 'Legendary',
        meta_team: 'AdMech',
        damage_p90: 4_500_000,
        attack_count: 30,
        encounter_index: 0
      },
      {
        boss_type: 'Belisarius',
        sub_boss_name: 'Belisarius Cawl',
        rarity: 'Legendary',
        meta_team: 'Custodes',
        damage_p90: 3_000_000,
        attack_count: 20,
        encounter_index: 0
      },
      {
        boss_type: 'Belisarius',
        sub_boss_name: 'Actus',
        rarity: 'Legendary',
        meta_team: 'Custodes',
        damage_p90: 2_500_000,
        attack_count: 40,
        encounter_index: 1
      },
      {
        boss_type: 'Belisarius',
        sub_boss_name: 'Actus',
        rarity: 'Legendary',
        meta_team: 'AdMech',
        damage_p90: 2_000_000,
        attack_count: 35,
        encounter_index: 1
      }
    ])

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    expect(result.season).toBe('98')
    const byTeam = new Map(result.teams.map((t) => [t.meta_team, t.boss_ids]))
    expect(byTeam.get('Neuro')).toEqual(['Belisarius_E0'])
    expect(byTeam.get('AdMech')?.sort()).toEqual([
      'Belisarius_E0',
      'Belisarius_E1'
    ])
    expect(byTeam.get('Custodes')).toEqual(['Belisarius_E1']) // dropped off Cawl, top-2 on Actus
  })

  it('collapses multiple team_hash rows of the same meta_team so top-2 picks DISTINCT teams', async () => {
    // Rows are per team_hash, so the seed dedupes by meta_team before top-N.
    const supabase = makeSupabaseMock([
      {
        boss_type: 'Ghazghkull',
        sub_boss_name: 'Ghazghkull',
        rarity: 'Legendary',
        meta_team: 'AdMech',
        damage_p90: 5_000_000,
        attack_count: 50,
        encounter_index: 0
      },
      {
        boss_type: 'Ghazghkull',
        sub_boss_name: 'Ghazghkull',
        rarity: 'Legendary',
        meta_team: 'AdMech',
        damage_p90: 4_800_000,
        attack_count: 40,
        encounter_index: 0
      },
      {
        boss_type: 'Ghazghkull',
        sub_boss_name: 'Ghazghkull',
        rarity: 'Legendary',
        meta_team: 'AdMech',
        damage_p90: 4_500_000,
        attack_count: 30,
        encounter_index: 0
      },
      {
        boss_type: 'Ghazghkull',
        sub_boss_name: 'Ghazghkull',
        rarity: 'Legendary',
        meta_team: 'Orkz',
        damage_p90: 3_000_000,
        attack_count: 20,
        encounter_index: 0
      },
      {
        boss_type: 'Ghazghkull',
        sub_boss_name: 'Ghazghkull',
        rarity: 'Legendary',
        meta_team: 'Neuro',
        damage_p90: 1_500_000,
        attack_count: 15,
        encounter_index: 0
      }
    ])

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    const byTeam = new Map(result.teams.map((t) => [t.meta_team, t.boss_ids]))
    expect(byTeam.get('AdMech')).toEqual(['Ghazghkull_E0'])
    expect(byTeam.get('Orkz')).toEqual(['Ghazghkull_E0']) // would be shut out without dedup
    expect(byTeam.has('Neuro')).toBe(false) // legitimate rank-3, correctly dropped
  })

  it('tie-breaks by attack_count when damage_p90 matches', async () => {
    const supabase = makeSupabaseMock([
      {
        boss_type: 'Ghazghkull',
        sub_boss_name: 'Ghazghkull',
        rarity: 'Legendary',
        meta_team: 'Orkz',
        damage_p90: 1_000_000,
        attack_count: 100,
        encounter_index: 0
      },
      {
        boss_type: 'Ghazghkull',
        sub_boss_name: 'Ghazghkull',
        rarity: 'Legendary',
        meta_team: 'Neuro',
        damage_p90: 1_000_000,
        attack_count: 80,
        encounter_index: 0
      },
      {
        boss_type: 'Ghazghkull',
        sub_boss_name: 'Ghazghkull',
        rarity: 'Legendary',
        meta_team: 'AdMech',
        damage_p90: 1_000_000,
        attack_count: 50,
        encounter_index: 0
      }
    ])

    const result = await fetchHeraldSeedFromMetaAtlas(supabase, { topN: 2 })
    const byTeam = new Map(result.teams.map((t) => [t.meta_team, t.boss_ids]))
    expect(byTeam.has('Orkz')).toBe(true) // highest attack_count wins tie
    expect(byTeam.has('Neuro')).toBe(true) // second tie-break
    expect(byTeam.has('AdMech')).toBe(false) // lowest, falls out of top-2
  })

  it('joins to Herald boss_id by (boss_type, encounter_index) so primes are distinct', async () => {
    const supabase = makeSupabaseMock([
      {
        boss_type: 'Belisarius',
        sub_boss_name: "Tan Gi'da",
        rarity: 'Legendary',
        meta_team: 'Zkar',
        damage_p90: 2_000_000,
        attack_count: 30,
        encounter_index: 2
      },
      {
        boss_type: 'Belisarius',
        sub_boss_name: 'Belisarius Cawl',
        rarity: 'Legendary',
        meta_team: 'Zkar',
        damage_p90: 5_000_000,
        attack_count: 50,
        encounter_index: 0
      }
    ])

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    const zkarBosses =
      result.teams.find((t) => t.meta_team === 'Zkar')?.boss_ids ?? []
    expect(zkarBosses.sort()).toEqual(['Belisarius_E0', 'Belisarius_E2'])
  })

  it("reports unmapped bosses when meta atlas has bosses SEASON_CONFIGS doesn't know about", async () => {
    const supabase = makeSupabaseMock([
      {
        boss_type: 'UnknownBoss',
        sub_boss_name: 'Mystery',
        rarity: 'Legendary',
        meta_team: 'SomeTeam',
        damage_p90: 1_000_000,
        attack_count: 10,
        encounter_index: 0
      }
    ])

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    expect(result.teams).toEqual([])
    expect(result.unmappedBosses).toContain('UnknownBoss_E0 (Mystery)')
  })

  it('dedupes a boss_id within a team when the same team ranks top-2 for both Legendary and Mythic of the same boss', async () => {
    const supabase = makeSupabaseMock([
      {
        boss_type: 'Ghazghkull',
        sub_boss_name: 'Ghazghkull',
        rarity: 'Legendary',
        meta_team: 'Orkz',
        damage_p90: 3_000_000,
        attack_count: 80,
        encounter_index: 0
      },
      {
        boss_type: 'Ghazghkull',
        sub_boss_name: 'Ghazghkull',
        rarity: 'Mythic',
        meta_team: 'Orkz',
        damage_p90: 5_000_000,
        attack_count: 40,
        encounter_index: 0
      }
    ])

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    const orkz = result.teams.find((t) => t.meta_team === 'Orkz')
    expect(orkz?.boss_ids).toEqual(['Ghazghkull_E0']) // not duplicated
  })

  it('skips rows with null or empty meta_team', async () => {
    const supabase = makeSupabaseMock([
      // @ts-expect-error — testing null resilience
      {
        boss_type: 'Belisarius',
        sub_boss_name: 'Belisarius Cawl',
        rarity: 'Legendary',
        meta_team: null,
        damage_p90: 5_000_000,
        attack_count: 50,
        encounter_index: 0
      },
      {
        boss_type: 'Belisarius',
        sub_boss_name: 'Belisarius Cawl',
        rarity: 'Legendary',
        meta_team: '',
        damage_p90: 4_000_000,
        attack_count: 40,
        encounter_index: 0
      },
      {
        boss_type: 'Belisarius',
        sub_boss_name: 'Belisarius Cawl',
        rarity: 'Legendary',
        meta_team: 'Neuro',
        damage_p90: 3_000_000,
        attack_count: 30,
        encounter_index: 0
      }
    ])

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    expect(result.teams.map((t) => t.meta_team)).toEqual(['Neuro'])
  })

  const makeSeasonKeyedMock = (
    rowsBySeason: Record<string, MetaAtlasRow[]>,
    seasonListRows: Array<{ season: string }>
  ) => {
    const seasonListChain: Record<string, unknown> = {
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis()
    }
    const seasonListPromise = Promise.resolve({
      data: seasonListRows,
      error: null
    })
    seasonListChain.then = (
      onFulfilled: (v: Record<string, unknown>) => unknown
    ) => seasonListPromise.then(onFulfilled)

    const allRows: MetaAtlasRow[] = []
    for (const [season, rs] of Object.entries(rowsBySeason)) {
      for (const r of rs) allRows.push({ set_num: 0, ...r, season })
    }
    const rowsChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis()
    }
    const rowsPromise = Promise.resolve({ data: allRows, error: null })
    rowsChain.then = (onFulfilled: (v: Record<string, unknown>) => unknown) =>
      rowsPromise.then(onFulfilled)

    return {
      from: vi.fn().mockReturnValue({
        select: vi
          .fn()
          .mockImplementation((cols: string) =>
            cols === 'season' ? seasonListChain : rowsChain
          )
      })
    } as unknown as Parameters<typeof fetchHeraldSeedFromMetaAtlas>[0]
  }

  it('per-boss cascade falls back to an older season when the newest has no data for that boss', async () => {
    // Ghazghkull_E0 is not in season 99's rotation, so the cascade falls through to 98.
    const supabase = makeSeasonKeyedMock(
      {
        '99': [], // newest season: no data for Ghazghkull
        '98': [
          {
            boss_type: 'Ghazghkull',
            sub_boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            meta_team: 'Orkz',
            damage_p90: 3_000_000,
            attack_count: 80,
            encounter_index: 0
          }
        ]
      },
      [{ season: '99' }, { season: '98' }]
    )

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    expect(result.season).toBe('98') // newest season that contributed data
    expect(result.seasonsTried).toEqual(['99', '98'])
    expect(result.teams.map((t) => t.meta_team)).toEqual(['Orkz'])
  })

  it('per-boss cascade lets different bosses source from different seasons', async () => {
    const supabase = makeSeasonKeyedMock(
      {
        '99': [
          {
            boss_type: 'Belisarius',
            sub_boss_name: 'Belisarius Cawl',
            rarity: 'Legendary',
            meta_team: 'AdMech',
            damage_p90: 5_000_000,
            attack_count: 50,
            encounter_index: 0
          }
        ],
        '98': [
          {
            boss_type: 'Ghazghkull',
            sub_boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            meta_team: 'Orkz',
            damage_p90: 3_000_000,
            attack_count: 80,
            encounter_index: 0
          }
        ]
      },
      [{ season: '99' }, { season: '98' }]
    )

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    expect(result.season).toBe('99') // newest contributing season overall
    expect(result.seasonsTried).toEqual(['99', '98'])
    const byTeam = new Map(result.teams.map((t) => [t.meta_team, t.boss_ids]))
    expect(byTeam.get('AdMech')).toEqual(['Belisarius_E0'])
    expect(byTeam.get('Orkz')).toEqual(['Ghazghkull_E0'])
  })

  it('per-SLOT cascade: same boss at different set_num values does NOT pool data across slots', async () => {
    // set_num must be in the grouping key: the same rarity uses a different set per season.
    const supabase = makeSeasonKeyedMock(
      {
        '99': [
          {
            boss_type: 'Ghazghkull',
            sub_boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            meta_team: 'Lavstodes',
            damage_p90: 1_500_000,
            attack_count: 10,
            encounter_index: 0,
            set_num: 1
          }
        ],
        '98': [
          {
            boss_type: 'Ghazghkull',
            sub_boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            meta_team: 'AdMech',
            damage_p90: 5_000_000,
            attack_count: 50,
            encounter_index: 0,
            set_num: 2
          }
        ]
      },
      [{ season: '99' }, { season: '98' }]
    )

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    const byTeam = new Map(result.teams.map((t) => [t.meta_team, t.boss_ids]))
    expect(byTeam.get('Lavstodes')).toEqual(['Ghazghkull_E0']) // L2 slot (s99)
    expect(byTeam.get('AdMech')).toEqual(['Ghazghkull_E0']) // L3 slot (s98) — ALSO surfaces
  })

  it('per-boss cascade picks the NEWEST season when multiple seasons have data for the same boss', async () => {
    const supabase = makeSeasonKeyedMock(
      {
        '99': [
          {
            boss_type: 'Ghazghkull',
            sub_boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            meta_team: 'NewMeta',
            damage_p90: 5_000_000,
            attack_count: 100,
            encounter_index: 0
          }
        ],
        '98': [
          {
            boss_type: 'Ghazghkull',
            sub_boss_name: 'Ghazghkull',
            rarity: 'Legendary',
            meta_team: 'OldMeta',
            damage_p90: 4_000_000,
            attack_count: 200,
            encounter_index: 0
          }
        ]
      },
      [{ season: '99' }, { season: '98' }]
    )

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    const byTeam = new Map(result.teams.map((t) => [t.meta_team, t.boss_ids]))
    expect(byTeam.get('NewMeta')).toEqual(['Ghazghkull_E0'])
    expect(byTeam.has('OldMeta')).toBe(false) // stale ranking MUST be ignored
  })

  it('returns empty with all seasons tried when every cascade candidate is empty', async () => {
    const seasonListRows = [{ season: '99' }, { season: '98' }]
    const seasonListChain: Record<string, unknown> = {
      order: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis()
    }
    const seasonListPromise = Promise.resolve({
      data: seasonListRows,
      error: null
    })
    seasonListChain.then = (
      onFulfilled: (v: Record<string, unknown>) => unknown
    ) => seasonListPromise.then(onFulfilled)

    const emptyRowsChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis()
    }
    const emptyPromise = Promise.resolve({ data: [], error: null })
    emptyRowsChain.then = (
      onFulfilled: (v: Record<string, unknown>) => unknown
    ) => emptyPromise.then(onFulfilled)

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi
          .fn()
          .mockImplementation((cols: string) =>
            cols === 'season' ? seasonListChain : emptyRowsChain
          )
      })
    } as unknown as Parameters<typeof fetchHeraldSeedFromMetaAtlas>[0]

    const result = await fetchHeraldSeedFromMetaAtlas(supabase)
    expect(result.teams).toEqual([])
    expect(result.season).toBeNull()
    expect(result.seasonsTried).toEqual(['99', '98'])
  })

  it('does not cascade when an explicit season is passed via options', async () => {
    const emptyRowsChain: Record<string, unknown> = {
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      gte: vi.fn().mockReturnThis()
    }
    const emptyPromise = Promise.resolve({ data: [], error: null })
    emptyRowsChain.then = (
      onFulfilled: (v: Record<string, unknown>) => unknown
    ) => emptyPromise.then(onFulfilled)

    const listSelectSpy = vi.fn().mockImplementation(() => emptyRowsChain)

    const supabase = {
      from: vi.fn().mockReturnValue({
        select: listSelectSpy
      })
    } as unknown as Parameters<typeof fetchHeraldSeedFromMetaAtlas>[0]

    const result = await fetchHeraldSeedFromMetaAtlas(supabase, {
      season: '42'
    })
    expect(result.teams).toEqual([])
    expect(result.seasonsTried).toEqual(['42'])
    expect(listSelectSpy).not.toHaveBeenCalledWith('season')
  })
})
