import { describe, expect, it } from 'vitest'

import {
  buildMetaAnalysisBossLevels,
  buildMetaBossNameKey,
  buildMetaBossNameMap,
  getMetaAnalysisBossType,
  parseMetaAnalysisRarities
} from '@/app/api/meta-analysis/_shared'
import {
  buildCompositionFromMetaAtlasRow,
  type MetaAtlasAuthenticatedRow
} from '@/app/lib/meta/meta-atlas-compositions'
import { getAuthorizedClusterGuildCodes } from '@/app/api/meta-analysis/_scope'
import type { MetaAnalysisAccessScope } from '@/app/api/meta-analysis/_scope'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

describe('meta-analysis API shared helpers', () => {
  it('parses rarity lists with route-specific trimming behavior', () => {
    expect(parseMetaAnalysisRarities(null)).toEqual(['Legendary', 'Mythic'])
    expect(parseMetaAnalysisRarities('Legendary, Mythic')).toEqual([
      'Legendary',
      'Mythic'
    ])
    expect(
      parseMetaAnalysisRarities('Legendary, Mythic', { trim: false })
    ).toEqual(['Legendary', ' Mythic'])
  })

  it('builds stable boss-name keys for main and side encounters', () => {
    expect(buildMetaBossNameKey('Legendary', 0, 0)).toBe('Legendary-0')
    expect(buildMetaBossNameKey('Legendary', 0, 1)).toBe('Legendary-0-side1')
    expect(buildMetaBossNameKey('Mythic', 4, 2)).toBe('Mythic-4-side2')
  })

  it('builds boss-name maps with first occurrence winning', () => {
    expect(
      buildMetaBossNameMap([
        { rarity: 'Legendary', set: 0, Name: 'Hive Tyrant', encounterId: 0 },
        { rarity: 'Legendary', set: 0, Name: 'Duplicate', encounterId: 0 },
        { rarity: 'Legendary', set: 0, Name: 'Side Boss 1', encounterId: 1 }
      ])
    ).toEqual({
      'Legendary-0': 'Hive Tyrant',
      'Legendary-0-side1': 'Side Boss 1'
    })
  })

  it('classifies meta-analysis boss encounter types', () => {
    expect(getMetaAnalysisBossType(0)).toBe('main')
    expect(getMetaAnalysisBossType(1)).toBe('side-left')
    expect(getMetaAnalysisBossType(2)).toBe('side-right')
  })

  it('builds batch boss levels and boss-name lookup from observed rows', () => {
    const { bossLevels, bossNames } = buildMetaAnalysisBossLevels([
      { rarity: 'Legendary', set: 0, Name: 'Main Boss', encounterId: 0 },
      { rarity: 'Legendary', set: 0, Name: 'Duplicate', encounterId: 0 },
      { rarity: 'Legendary', set: 0, Name: 'Side Boss', encounterId: 1 }
    ])

    expect(bossLevels).toEqual([
      { rarity: 'Legendary', set: 0, encounterId: 0, bossType: 'main' },
      { rarity: 'Legendary', set: 0, encounterId: 1, bossType: 'side-left' }
    ])
    expect(bossNames).toEqual({
      'Legendary-0': 'Main Boss',
      'Legendary-0-side1': 'Side Boss'
    })
  })

  it('uses Legendary main levels when batch has no observed bosses', () => {
    expect(buildMetaAnalysisBossLevels([]).bossLevels).toEqual([
      { rarity: 'Legendary', set: 0, encounterId: 0, bossType: 'main' },
      { rarity: 'Legendary', set: 1, encounterId: 0, bossType: 'main' },
      { rarity: 'Legendary', set: 2, encounterId: 0, bossType: 'main' },
      { rarity: 'Legendary', set: 3, encounterId: 0, bossType: 'main' },
      { rarity: 'Legendary', set: 4, encounterId: 0, bossType: 'main' }
    ])
  })
})

describe('route option bundles for buildCompositionFromMetaAtlasRow', () => {
  const atlasRow = (
    overrides: Partial<MetaAtlasAuthenticatedRow> = {}
  ): MetaAtlasAuthenticatedRow => ({
    team_hash: 'hash-1',
    team_composition: 'Hero1, Hero2 + MOW1',
    meta_team: ' Row Category ',
    boss_type: null,
    boss_unit_id: null,
    sub_boss_name: null,
    encounter_index: 2,
    encounter_type: 'Boss',
    rarity: 'Legendary',
    set_num: 1,
    rarity_set: 'L2',
    season: '45',
    attack_count: 7,
    damage_max: 500,
    damage_p90: 480,
    damage_p75: 450,
    damage_avg: 400,
    damage_stddev: 25,
    coef_variation: null,
    damage_min: 300,
    distinct_players: 2,
    distinct_guilds: 1,
    ...overrides
  })

  it('maps main-route compositions with row min/stddev and a nullable coefficient', () => {
    const composition = buildCompositionFromMetaAtlasRow(
      atlasRow(),
      { rarity: 'Legendary', set: 1, season: '45' },
      {
        minDamageMode: 'min-or-avg',
        standardDeviationMode: 'row-or-zero',
        coefficientFallback: null,
        bossNameFallback: 'Unknown'
      }
    )

    // The MoW is carried structurally (for its portrait), not in the display string.
    expect(composition.compositionDisplay).toBe('Hero1 + Hero2')
    expect(JSON.parse(composition.machineOfWarDetails ?? 'null')).toEqual({
      unitId: 'MOW1'
    })
    expect(composition.category).toBe('Row Category')
    expect(composition.categories).toEqual(['Row Category'])
    expect(composition.minDamage).toBe(300)
    expect(composition.standardDeviation).toBe(25)
    expect(composition.coefficientOfVariation).toBeNull()
    expect(composition.bossName).toBe('Unknown')
    expect(composition.encounterId).toBe(2)
  })

  it.each([
    ['undefined', undefined],
    ['null', null]
  ])(
    'maps recommendation compositions with avg min-damage and zero fallback for %s coefficient',
    (_label, coefVariation) => {
      const composition = buildCompositionFromMetaAtlasRow(
        atlasRow({
          coef_variation: coefVariation as unknown as number | null
        }),
        { rarity: 'Mythic', set: 4, season: '45' },
        {
          minDamageMode: 'avg',
          standardDeviationMode: 'zero',
          coefficientFallback: 0,
          bossNameFallback: 'Boss'
        }
      )

      expect(composition.compositionDisplay).toBe('Hero1 + Hero2')
      expect(composition.category).toBe('Row Category')
      expect(composition.minDamage).toBe(400)
      expect(composition.avgDamage).toBe(400)
      expect(composition.standardDeviation).toBe(0)
      expect(composition.coefficientOfVariation).toBe(0)
      expect(composition.bossName).toBe('Boss')
      expect(composition.rarity).toBe('Mythic')
      expect(composition.set).toBe(4)
    }
  )
})

/** Authorization boundary with no route caller: only guilds proven by the server-side cluster relation. */
describe('getAuthorizedClusterGuildCodes', () => {
  type ClusterQueryResult = {
    data: Array<{ guild_code: string | null }> | null
    error: { message: string } | null
  }

  const makeSupabase = (result: ClusterQueryResult) => {
    const queries: Array<{
      table: string
      columns: string
      filters: Record<string, unknown>
    }> = []

    const client = {
      from: (table: string) => {
        const entry = {
          table,
          columns: '',
          filters: {} as Record<string, unknown>
        }
        queries.push(entry)
        const builder = {
          select: (columns: string) => {
            entry.columns = columns
            return builder
          },
          eq: (column: string, value: unknown) => {
            entry.filters[column] = value
            return Promise.resolve(result)
          }
        }
        return builder
      }
    }

    return {
      supabase: client as unknown as TypedSupabaseClient,
      queries
    }
  }

  const scope = (
    overrides: Partial<MetaAnalysisAccessScope> = {}
  ): MetaAnalysisAccessScope => ({
    ownGuildCode: 'OWN',
    clusterCode: 'EOT',
    requestedGuildCode: null,
    primaryClusterCode: 'EOT',
    primaryGuildCode: null,
    ...overrides
  })

  it('returns only the caller own guild and issues no query when there is no cluster', async () => {
    const { supabase, queries } = makeSupabase({ data: [], error: null })

    await expect(
      getAuthorizedClusterGuildCodes(supabase, scope({ clusterCode: null }))
    ).resolves.toEqual(['OWN'])
    expect(queries).toHaveLength(0)
  })

  it('returns the guilds the server relation proves for the cluster', async () => {
    const { supabase, queries } = makeSupabase({
      data: [
        { guild_code: ' ALLY ' },
        { guild_code: 'OWN' },
        { guild_code: null },
        { guild_code: '   ' }
      ],
      error: null
    })

    await expect(
      getAuthorizedClusterGuildCodes(supabase, scope())
    ).resolves.toEqual(['ALLY', 'OWN'])
    expect(queries).toEqual([
      {
        table: 'guild_config',
        columns: 'guild_code',
        filters: { cluster_code: 'EOT' }
      }
    ])
  })

  it('denies instead of returning an unproven list when the cluster query errors', async () => {
    const { supabase } = makeSupabase({
      data: null,
      error: { message: 'guild_config unavailable' }
    })

    await expect(
      getAuthorizedClusterGuildCodes(supabase, scope())
    ).rejects.toMatchObject({
      statusCode: 403,
      message: 'Active guild membership required'
    })
  })

  it('denies when the cluster query returns a non-array payload', async () => {
    const { supabase } = makeSupabase({ data: null, error: null })

    await expect(
      getAuthorizedClusterGuildCodes(supabase, scope())
    ).rejects.toMatchObject({ statusCode: 403 })
  })
})
