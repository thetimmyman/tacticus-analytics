// The adapter caches per `season::minAttacks`, so each case uses its own season.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  clearMetaAtlasRowsCacheForTests,
  type MetaAtlasAuthenticatedRow
} from '@/app/lib/meta/meta-atlas-compositions'

const loggerErrorMock = vi.hoisted(() => vi.fn())
const dbMock = vi.hoisted(() => vi.fn())

vi.mock('@/app/lib/db', () => ({
  db: dbMock
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: loggerErrorMock
  }),
  logError: vi.fn()
}))

import * as metaAnalysisService from '@/app/lib/services/meta-analysis'
import {
  analyzeTeamCompositions,
  getAvailableGuilds,
  getRecommendedTeams
} from '@/app/lib/services/meta-analysis'

const META_ATLAS_RPC = 'get_meta_atlas_authenticated'

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
  season: 'S1',
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

function makeAtlasClient(rows: MetaAtlasAuthenticatedRow[] | null) {
  const rpc = vi.fn().mockResolvedValue({ data: rows, error: null })
  return { rpc, client: { rpc } as unknown as TypedSupabaseClient }
}

describe('meta-analysis service', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearMetaAtlasRowsCacheForTests()
  })

  describe('analyzeTeamCompositions', () => {
    it('passes rarity/set/season/minBattles/encounter through to the Meta Atlas RPC and cell filter', async () => {
      const wanted = row({ team_hash: 'wanted' })
      const { rpc, client } = makeAtlasClient([
        wanted,
        row({ team_hash: 'other-encounter', encounter_index: 1 }),
        row({ team_hash: 'other-rarity', rarity: 'Mythic' }),
        row({ team_hash: 'other-set', set_num: 2 })
      ])

      const result = await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-passthrough',
        25,
        0,
        100,
        client
      )

      expect(rpc).toHaveBeenCalledWith(META_ATLAS_RPC, {
        p_min_attacks: 25,
        p_exclude_overkills: true,
        p_exclude_retreats: true,
        p_retreat_threshold: 10000,
        p_seasons: ['S-passthrough']
      })
      expect(result).toHaveLength(1)
      expect(result[0].compositionKey).toBe('wanted')
      expect(result[0].rarity).toBe('Legendary')
      expect(result[0].set).toBe(1)
      expect(result[0].season).toBe('S-passthrough')
      expect(result[0].encounterId).toBe(0)
    })

    it('handles null optional parameters: 10-attack floor, all encounters, default 50 limit', async () => {
      const rows = Array.from({ length: 60 }, (_, index) =>
        row({
          team_hash: `hash-${index}`,
          damage_p90: 1000 - index,
          encounter_index: index % 3
        })
      )
      const { rpc, client } = makeAtlasClient(rows)

      const result = await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-nulls',
        null,
        null,
        null,
        client
      )

      expect(rpc).toHaveBeenCalledWith(META_ATLAS_RPC, {
        p_min_attacks: 10,
        p_exclude_overkills: true,
        p_exclude_retreats: true,
        p_retreat_threshold: 10000,
        p_seasons: ['S-nulls']
      })
      expect(
        new Set(result.map((composition) => composition.encounterId))
      ).toEqual(new Set([0, 1, 2]))
      expect(result).toHaveLength(50)
    })

    it('omitting minBattles/encounterId/limit entirely behaves the same as passing null', async () => {
      const { rpc, client } = makeAtlasClient([row()])

      const result = await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-omitted',
        undefined,
        undefined,
        undefined,
        client
      )

      expect(rpc).toHaveBeenCalledWith(
        META_ATLAS_RPC,
        expect.objectContaining({ p_min_attacks: 10, p_seasons: ['S-omitted'] })
      )
      expect(result).toHaveLength(1)
    })

    it('clamps a below-floor minBattles to the server 10-attack floor', async () => {
      const { rpc, client } = makeAtlasClient([row()])

      // The legacy batch route passes 2; the DB clamps to >= 10.
      await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-floor',
        2,
        0,
        null,
        client
      )

      expect(rpc).toHaveBeenCalledWith(
        META_ATLAS_RPC,
        expect.objectContaining({ p_min_attacks: 10 })
      )
    })

    it('honours an explicit limit', async () => {
      const rows = Array.from({ length: 10 }, (_, index) =>
        row({ team_hash: `hash-${index}`, damage_p90: 1000 - index })
      )
      const { client } = makeAtlasClient(rows)

      const result = await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-limit',
        null,
        0,
        3,
        client
      )

      expect(result).toHaveLength(3)
      expect(result.map((composition) => composition.compositionKey)).toEqual([
        'hash-0',
        'hash-1',
        'hash-2'
      ])
    })

    it('returns the strongest rows first (p90 desc, then attack count desc)', async () => {
      const { client } = makeAtlasClient([
        row({ team_hash: 'weak', damage_p90: 100, attack_count: 99 }),
        row({ team_hash: 'tie-small', damage_p90: 200, attack_count: 10 }),
        row({ team_hash: 'tie-big', damage_p90: 200, attack_count: 50 })
      ])

      const result = await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-sort',
        null,
        0,
        null,
        client
      )

      expect(result.map((composition) => composition.compositionKey)).toEqual([
        'tie-big',
        'tie-small',
        'weak'
      ])
    })

    it('returns an empty array when the season aggregate has no rows', async () => {
      const { client } = makeAtlasClient(null)

      const result = await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-empty',
        null,
        null,
        null,
        client
      )

      expect(result).toEqual([])
    })

    it('handles all rarity types', async () => {
      const { rpc, client } = makeAtlasClient([
        row({ team_hash: 'legendary-row' }),
        row({ team_hash: 'mythic-row', rarity: 'Mythic', set_num: 2 })
      ])

      const result = await analyzeTeamCompositions(
        'Mythic',
        2,
        'S-rarity',
        null,
        0,
        null,
        client
      )

      expect(rpc).toHaveBeenCalledWith(
        META_ATLAS_RPC,
        expect.objectContaining({ p_seasons: ['S-rarity'] })
      )
      expect(result).toHaveLength(1)
      expect(result[0].compositionKey).toBe('mythic-row')
      expect(result[0].rarity).toBe('Mythic')
      expect(result[0].set).toBe(2)
    })

    it('maps rows with the per-cell option set (min-or-avg, row stddev, null CV fallback, "Unknown" boss)', async () => {
      const { client } = makeAtlasClient([
        row({
          damage_min: null,
          damage_stddev: null,
          coef_variation: null,
          sub_boss_name: null,
          boss_type: null
        })
      ])

      const [composition] = await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-mapping',
        null,
        0,
        null,
        client
      )

      expect(composition.heroNames).toEqual(['Actus', "Tan Gi'da", 'Vitruvius'])
      expect(JSON.parse(composition.machineOfWarDetails ?? 'null')).toEqual({
        unitId: 'Biovore'
      })
      expect(composition.avgDamage).toBe(600)
      expect(composition.minDamage).toBe(600)
      expect(composition.standardDeviation).toBe(0)
      expect(composition.coefficientOfVariation).toBeNull()
      expect(composition.bossName).toBe('Unknown')
    })

    it('keeps the row stddev, damage_min and coefficient when the aggregate exposes them', async () => {
      const { client } = makeAtlasClient([row()])

      const [composition] = await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-mapping-full',
        null,
        0,
        null,
        client
      )

      expect(composition.minDamage).toBe(100)
      expect(composition.standardDeviation).toBe(120)
      expect(composition.coefficientOfVariation).toBe(20)
      expect(composition.stabilityRank).toBe('High')
      expect(composition.bossName).toBe('Szarekh')
    })

    it('propagates the adapter error when the Meta Atlas RPC fails', async () => {
      const rpc = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'RPC failed' } })
      const client = { rpc } as unknown as TypedSupabaseClient

      await expect(
        analyzeTeamCompositions(
          'Legendary',
          1,
          'S-error',
          null,
          null,
          null,
          client
        )
      ).rejects.toThrow('get_meta_atlas_authenticated failed: RPC failed')
    })

    it('accepts a custom supabase client (no db() fallback)', async () => {
      const { rpc, client } = makeAtlasClient([row()])

      const result = await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-custom',
        null,
        0,
        null,
        client
      )

      expect(rpc).toHaveBeenCalled()
      expect(dbMock).not.toHaveBeenCalled()
      expect(result).toHaveLength(1)
    })

    it('falls back to the shared db() client when none is supplied', async () => {
      const { rpc, client } = makeAtlasClient([row()])
      dbMock.mockResolvedValue(client)

      const result = await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-db',
        null,
        0
      )

      expect(dbMock).toHaveBeenCalledTimes(1)
      expect(rpc).toHaveBeenCalledWith(
        META_ATLAS_RPC,
        expect.objectContaining({ p_seasons: ['S-db'] })
      )
      expect(result).toHaveLength(1)
    })

    it('never calls the retired get_meta_analysis_compositions RPC', async () => {
      const { rpc, client } = makeAtlasClient([row()])

      await analyzeTeamCompositions(
        'Legendary',
        1,
        'S-retired',
        null,
        0,
        null,
        client
      )

      expect(rpc).not.toHaveBeenCalledWith(
        'get_meta_analysis_compositions',
        expect.anything()
      )
      expect(rpc).toHaveBeenCalledTimes(1)
    })
  })

  describe('analyzeTeamCompositionsOptimized removal', () => {
    it('no longer exists — analyzeTeamCompositions is the single entry point', () => {
      expect(metaAnalysisService).not.toHaveProperty(
        'analyzeTeamCompositionsOptimized'
      )
      expect(typeof metaAnalysisService.analyzeTeamCompositions).toBe(
        'function'
      )
    })

    it('serves the batch-route call shape the "Optimized" wrapper used to serve', async () => {
      const { rpc, client } = makeAtlasClient([
        row({
          team_hash: 'batch-row',
          rarity: 'Mythic',
          set_num: 2,
          encounter_index: 1
        })
      ])

      const result = await analyzeTeamCompositions(
        'Mythic',
        2,
        'S-batch',
        2,
        1,
        null,
        client
      )

      expect(rpc).toHaveBeenCalledWith(META_ATLAS_RPC, {
        p_min_attacks: 10,
        p_exclude_overkills: true,
        p_exclude_retreats: true,
        p_retreat_threshold: 10000,
        p_seasons: ['S-batch']
      })
      expect(result).toHaveLength(1)
      expect(result[0].compositionKey).toBe('batch-row')
      expect(result[0].encounterId).toBe(1)
    })
  })

  describe('getRecommendedTeams', () => {
    it('calls RPC with correct parameters', async () => {
      const mockData = [
        { team_composition: 'Hero1, Hero2', recommended_for: 'Boss1' }
      ]
      const rpc = vi.fn().mockResolvedValue({ data: mockData, error: null })
      dbMock.mockResolvedValue({ rpc } as unknown as TypedSupabaseClient)

      const result = await getRecommendedTeams('S1', 'GUILD1', 'EOT')

      expect(rpc).toHaveBeenCalledWith('get_recommended_teams_for_season', {
        p_season: 'S1',
        p_guild_filter: 'GUILD1',
        p_cluster_code: 'EOT'
      })
      expect(result).toEqual(mockData)
    })

    it('handles null optional parameters', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
      dbMock.mockResolvedValue({ rpc } as unknown as TypedSupabaseClient)

      await getRecommendedTeams('S1')

      expect(rpc).toHaveBeenCalledWith('get_recommended_teams_for_season', {
        p_season: 'S1',
        p_guild_filter: undefined,
        p_cluster_code: undefined
      })
    })

    it('returns empty array when data is null', async () => {
      const rpc = vi.fn().mockResolvedValue({ data: null, error: null })
      dbMock.mockResolvedValue({ rpc } as unknown as TypedSupabaseClient)

      const result = await getRecommendedTeams('S1')

      expect(result).toEqual([])
    })

    it('throws error when RPC fails', async () => {
      const error = new Error('Recommended teams RPC failed')
      const rpc = vi.fn().mockResolvedValue({ data: null, error })
      dbMock.mockResolvedValue({ rpc } as unknown as TypedSupabaseClient)

      await expect(getRecommendedTeams('S1')).rejects.toThrow(
        'Recommended teams RPC failed'
      )
    })

    it('accepts custom supabase client', async () => {
      const mockData = [{ recommendation: 'test' }]
      const customClient = {
        rpc: vi.fn().mockResolvedValue({ data: mockData, error: null })
      }

      const result = await getRecommendedTeams(
        'S1',
        null,
        null,
        customClient as unknown as TypedSupabaseClient
      )

      expect(customClient.rpc).toHaveBeenCalled()
      expect(dbMock).not.toHaveBeenCalled()
      expect(result).toEqual(mockData)
    })
  })

  describe('getAvailableGuilds', () => {
    const makeGuildClient = (result: { data: unknown; error: unknown }) => {
      const order = vi.fn().mockResolvedValue(result)
      const not = vi.fn().mockReturnValue({ order })
      const select = vi.fn().mockReturnValue({ not })
      const from = vi.fn().mockReturnValue({ select })
      return {
        from,
        select,
        not,
        order,
        client: { from } as unknown as TypedSupabaseClient
      }
    }

    it('queries the public_guild_snapshots_explore view', async () => {
      const mockData = [
        { guild_code: 'GUILD1', guild_name: 'Guild One' },
        { guild_code: 'GUILD2', guild_name: 'Guild Two' }
      ]
      const fake = makeGuildClient({ data: mockData, error: null })
      dbMock.mockResolvedValue(fake.client)

      const result = await getAvailableGuilds()

      expect(fake.from).toHaveBeenCalledWith('public_guild_snapshots_explore')
      expect(fake.select).toHaveBeenCalledWith(
        'guild_code, guild_name, guild_tag'
      )
      expect(fake.not).toHaveBeenCalledWith('guild_code', 'is', null)
      expect(fake.order).toHaveBeenCalledWith('guild_name', { ascending: true })
      expect(result).toEqual(mockData)
    })

    it('returns empty array when data is null', async () => {
      const fake = makeGuildClient({ data: null, error: null })
      dbMock.mockResolvedValue(fake.client)

      const result = await getAvailableGuilds()

      expect(result).toEqual([])
    })

    it('throws error when query fails', async () => {
      const error = new Error('Query failed')
      const fake = makeGuildClient({ data: null, error })
      dbMock.mockResolvedValue(fake.client)

      await expect(getAvailableGuilds()).rejects.toThrow('Query failed')
    })

    it('accepts custom supabase client', async () => {
      const mockData = [{ guild_code: 'CUSTOM', guild_name: 'Custom Guild' }]
      const fake = makeGuildClient({ data: mockData, error: null })

      const result = await getAvailableGuilds(fake.client)

      expect(fake.from).toHaveBeenCalledWith('public_guild_snapshots_explore')
      expect(dbMock).not.toHaveBeenCalled()
      expect(result).toEqual(mockData)
    })

    it('orders guilds alphabetically by name', async () => {
      const mockData = [
        { guild_code: 'A', guild_name: 'Alpha Guild' },
        { guild_code: 'B', guild_name: 'Beta Guild' },
        { guild_code: 'Z', guild_name: 'Zeta Guild' }
      ]
      const fake = makeGuildClient({ data: mockData, error: null })
      dbMock.mockResolvedValue(fake.client)

      const result = (await getAvailableGuilds()) as Array<{
        guild_name: string
      }>

      expect(fake.order).toHaveBeenCalledWith('guild_name', { ascending: true })
      expect(result[0].guild_name).toBe('Alpha Guild')
    })

    it('filters out guilds with null guild_code', async () => {
      const fake = makeGuildClient({ data: [], error: null })
      dbMock.mockResolvedValue(fake.client)

      await getAvailableGuilds()

      expect(fake.not).toHaveBeenCalledWith('guild_code', 'is', null)
    })
  })

  describe('error logging', () => {
    it('logs the new Meta Atlas failure message when analyzeTeamCompositions fails', async () => {
      const rpc = vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'boom' } })
      const client = { rpc } as unknown as TypedSupabaseClient

      await expect(
        analyzeTeamCompositions(
          'Legendary',
          1,
          'S-log',
          null,
          null,
          null,
          client
        )
      ).rejects.toThrow()

      expect(loggerErrorMock).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        '[meta-analysis] RPC get_meta_atlas_authenticated failed'
      )
      const [[payload]] = loggerErrorMock.mock.calls as Array<
        [{ err: Error }, string]
      >
      expect(payload.err.message).toBe(
        'get_meta_atlas_authenticated failed: boom'
      )
    })

    it('logs error when getRecommendedTeams fails', async () => {
      const error = new Error('RPC failed')
      const rpc = vi.fn().mockResolvedValue({ data: null, error })
      dbMock.mockResolvedValue({ rpc } as unknown as TypedSupabaseClient)

      await expect(getRecommendedTeams('S1')).rejects.toThrow()

      expect(loggerErrorMock).toHaveBeenCalledWith(
        { err: error },
        '[meta-analysis] RPC get_recommended_teams_for_season failed'
      )
    })

    it('logs error when getAvailableGuilds fails', async () => {
      const error = new Error('Query failed')
      const order = vi.fn().mockResolvedValue({ data: null, error })
      const not = vi.fn().mockReturnValue({ order })
      const select = vi.fn().mockReturnValue({ not })
      const from = vi.fn().mockReturnValue({ select })
      dbMock.mockResolvedValue({ from } as unknown as TypedSupabaseClient)

      await expect(getAvailableGuilds()).rejects.toThrow()

      expect(loggerErrorMock).toHaveBeenCalledWith(
        { err: error },
        '[meta-analysis] Failed to load available guilds'
      )
    })
  })
})
