import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  buildCompositionFromMetaAtlasRow,
  clearMetaAtlasRowsCacheForTests,
  compareMetaAtlasRowsByStrength,
  fetchMetaAtlasSeasonRows,
  filterMetaAtlasRowsForCell,
  parseTeamCompositionDisplay,
  type MetaAtlasAuthenticatedRow
} from './meta-atlas-compositions'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

const row = (
  overrides: Partial<MetaAtlasAuthenticatedRow> = {}
): MetaAtlasAuthenticatedRow => ({
  team_hash: 'hash-1',
  team_composition: "Actus, Tan Gi'da, Vitruvius + Biovore",
  meta_team: 'Admech',
  boss_type: 'SilentKing',
  boss_unit_id: 'GuildBoss3Boss1NecroSilentKing',
  sub_boss_name: 'Szarekh',
  encounter_index: 0,
  encounter_type: 'Boss',
  rarity: 'Legendary',
  set_num: 1,
  rarity_set: 'L2',
  season: '83',
  attack_count: 25,
  damage_max: 900,
  damage_p90: 800,
  damage_p75: 700,
  damage_avg: 600,
  damage_stddev: 120,
  coef_variation: 20,
  damage_min: 100,
  distinct_players: 12,
  distinct_guilds: 4,
  ...overrides
})

describe('parseTeamCompositionDisplay', () => {
  it('splits heroes and machine of war on the last " + "', () => {
    expect(
      parseTeamCompositionDisplay("Actus, Tan Gi'da, Vitruvius + Biovore")
    ).toEqual({
      heroNames: ['Actus', "Tan Gi'da", 'Vitruvius'],
      mowName: 'Biovore'
    })
  })

  it('handles teams without a machine of war', () => {
    expect(parseTeamCompositionDisplay('Aleph-Null, Bellator')).toEqual({
      heroNames: ['Aleph-Null', 'Bellator'],
      mowName: null
    })
  })

  it('returns empty for null/blank input', () => {
    expect(parseTeamCompositionDisplay(null)).toEqual({
      heroNames: [],
      mowName: null
    })
    expect(parseTeamCompositionDisplay('  ')).toEqual({
      heroNames: [],
      mowName: null
    })
  })
})

describe('buildCompositionFromMetaAtlasRow', () => {
  it('maps the new aggregate row onto the legacy TeamComposition shape', () => {
    const mapped = buildCompositionFromMetaAtlasRow(
      row(),
      { rarity: 'Legendary', set: 1, season: '83' },
      {
        minDamageMode: 'min-or-avg',
        standardDeviationMode: 'row-or-zero',
        coefficientFallback: null,
        bossNameFallback: 'Unknown'
      }
    )

    expect(mapped.compositionKey).toBe('hash-1')
    expect(mapped.heroNames).toEqual(['Actus', "Tan Gi'da", 'Vitruvius'])
    expect(JSON.parse(mapped.heroDetails ?? '[]')).toEqual([
      { unitId: 'Actus' },
      { unitId: "Tan Gi'da" },
      { unitId: 'Vitruvius' }
    ])
    expect(JSON.parse(mapped.machineOfWarDetails ?? 'null')).toEqual({
      unitId: 'Biovore'
    })
    expect(mapped.battlesCount).toBe(25)
    expect(mapped.minDamage).toBe(100)
    expect(mapped.maxDamage).toBe(900)
    expect(mapped.avgDamage).toBe(600)
    expect(mapped.medianDamage).toBe(600)
    expect(mapped.standardDeviation).toBe(120)
    expect(mapped.coefficientOfVariation).toBe(20)
    expect(mapped.stabilityRank).toBe('High')
    expect(mapped.playerCount).toBe(12)
    expect(mapped.guildCount).toBe(4)
    expect(mapped.categories).toEqual(['Admech'])
    expect(mapped.category).toBe('Admech')
    expect(mapped.bossName).toBe('Szarekh')
    expect(mapped.encounterId).toBe(0)
  })

  it("falls back to avg damage when damage_min is withheld ('min-or-avg')", () => {
    const mapped = buildCompositionFromMetaAtlasRow(
      row({ damage_min: null }),
      { rarity: 'Legendary', set: 1, season: '83' },
      {
        minDamageMode: 'min-or-avg',
        standardDeviationMode: 'row-or-zero',
        coefficientFallback: null,
        bossNameFallback: 'Unknown'
      }
    )
    expect(mapped.minDamage).toBe(600)
  })

  it('derives stability rank bands from coef_variation', () => {
    const build = (coef: number | null) =>
      buildCompositionFromMetaAtlasRow(
        row({ coef_variation: coef }),
        { rarity: 'Legendary', set: 1, season: '83' },
        {
          minDamageMode: 'avg',
          standardDeviationMode: 'zero',
          coefficientFallback: 0,
          bossNameFallback: 'Boss'
        }
      )
    expect(build(10).stabilityRank).toBe('High')
    expect(build(45).stabilityRank).toBe('Medium')
    expect(build(80).stabilityRank).toBe('Low')
    expect(build(null).stabilityRank).toBe('Medium')
    expect(build(null).coefficientOfVariation).toBe(0)
  })
})

describe('compareMetaAtlasRowsByStrength / filterMetaAtlasRowsForCell', () => {
  it('ranks by p90 then attack count', () => {
    const weaker = row({ damage_p90: 100, attack_count: 99 })
    const stronger = row({ damage_p90: 200, attack_count: 10 })
    const tiedBigger = row({ damage_p90: 200, attack_count: 50 })
    const sorted = [weaker, stronger, tiedBigger].sort(
      compareMetaAtlasRowsByStrength
    )
    expect(sorted[0]).toBe(tiedBigger)
    expect(sorted[1]).toBe(stronger)
    expect(sorted[2]).toBe(weaker)
  })

  it('filters by rarity, set, and (optionally) encounter', () => {
    const rows = [
      row({ encounter_index: 0 }),
      row({ encounter_index: 1 }),
      row({ rarity: 'Mythic' }),
      row({ set_num: 2 })
    ]
    expect(
      filterMetaAtlasRowsForCell(rows, {
        rarity: 'Legendary',
        set: 1,
        encounterIndex: 0
      })
    ).toHaveLength(1)
    expect(
      filterMetaAtlasRowsForCell(rows, {
        rarity: 'Legendary',
        set: 1,
        encounterIndex: null
      })
    ).toHaveLength(2)
  })
})

describe('fetchMetaAtlasSeasonRows', () => {
  beforeEach(() => clearMetaAtlasRowsCacheForTests())

  const makeClient = (rpc: ReturnType<typeof vi.fn>) =>
    ({ rpc }) as unknown as TypedSupabaseClient

  it('clamps the floor to 10, forwards fixed filters, and caches per season', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [row()], error: null })
    const client = makeClient(rpc)

    const first = await fetchMetaAtlasSeasonRows(client, '83', 3)
    const second = await fetchMetaAtlasSeasonRows(client, '83', 3)

    expect(first).toHaveLength(1)
    expect(second).toBe(first)
    expect(rpc).toHaveBeenCalledTimes(1)
    expect(rpc).toHaveBeenCalledWith('get_meta_atlas_authenticated', {
      p_min_attacks: 10,
      p_exclude_overkills: true,
      p_exclude_retreats: true,
      p_retreat_threshold: 10000,
      p_seasons: ['83']
    })
  })

  it('does not cache failures', async () => {
    const rpc = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: 'boom' } })
      .mockResolvedValueOnce({ data: [], error: null })
    const client = makeClient(rpc)

    await expect(fetchMetaAtlasSeasonRows(client, '83')).rejects.toThrow('boom')
    await expect(fetchMetaAtlasSeasonRows(client, '83')).resolves.toEqual([])
    expect(rpc).toHaveBeenCalledTimes(2)
  })
})
