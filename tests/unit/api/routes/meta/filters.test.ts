import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('GET /api/meta/filters', () => {
  let GET: () => Promise<Response>
  let mockSupabase: {
    rpc: ReturnType<typeof vi.fn>
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateServiceClient = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: { error: vi.fn(), info: vi.fn(), debug: vi.fn() }
    }))

    mockSupabase = {
      rpc: vi.fn(),
      from: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/meta/filters/route')
    GET = routeModule.GET
  })

  describe('successful RPC path', () => {
    it('returns filter data from RPC functions', async () => {
      mockSupabase.rpc.mockImplementation((funcName: string) => {
        const data: Record<string, Array<{ [key: string]: string }>> = {
          get_meta_atlas_distinct_bosses: [
            { boss_type: 'Hive_Tyrant' },
            { boss_type: 'Screamer_Killer' }
          ],
          get_meta_atlas_distinct_rarity_sets: [
            { rarity_set: 'L3' },
            { rarity_set: 'L4' }
          ],
          get_meta_atlas_distinct_seasons: [{ season: '45' }, { season: '44' }],
          get_meta_atlas_distinct_meta_teams: [
            { meta_team: 'Ultramarines' },
            { meta_team: 'Death Guard' }
          ]
        }
        return Promise.resolve({ data: data[funcName] || [], error: null })
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              boss_type: 'Hive_Tyrant',
              boss_unit_id: 'boss_hive_tyrant',
              rarity_set: 'L3'
            },
            {
              boss_type: 'Screamer_Killer',
              boss_unit_id: 'boss_screamer_killer',
              rarity_set: 'L4'
            }
          ],
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.bosses).toEqual(['Hive_Tyrant', 'Screamer_Killer'])
      expect(body.rarity_sets).toEqual(['L3', 'L4'])
      expect(body.seasons).toEqual(['45', '44'])
      expect(body.meta_teams).toEqual(['Ultramarines', 'Death Guard'])
      expect(body.current_season).toBe('45')
      expect(body.previous_season).toBe('44')
      expect(body.season_number).toBe(45)
    })

    it('includes current season bosses with readable names', async () => {
      mockSupabase.rpc.mockImplementation((funcName: string) => {
        const data: Record<string, Array<{ [key: string]: string }>> = {
          get_meta_atlas_distinct_bosses: [{ boss_type: 'HiveTyrant' }],
          get_meta_atlas_distinct_rarity_sets: [{ rarity_set: 'L3' }],
          get_meta_atlas_distinct_seasons: [{ season: '45' }],
          get_meta_atlas_distinct_meta_teams: []
        }
        return Promise.resolve({ data: data[funcName] || [], error: null })
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ boss_type: 'HiveTyrant', boss_unit_id: 'boss_hive_tyrant' }],
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(body.current_season_bosses).toEqual([
        {
          boss_type: 'HiveTyrant',
          boss_name: 'Hive Tyrant',
          boss_unit_id: 'boss_hive_tyrant'
        }
      ])
    })

    it('resolves an unmapped reworked boss_type to its curated name (WI-1820)', async () => {
      // The fallback path must not split 'BelisariusRW' into 'Belisarius RW'.
      mockSupabase.rpc.mockImplementation((funcName: string) => {
        const data: Record<string, Array<{ [key: string]: string }>> = {
          get_meta_atlas_distinct_bosses: [{ boss_type: 'BelisariusRW' }],
          get_meta_atlas_distinct_rarity_sets: [{ rarity_set: 'M1' }],
          get_meta_atlas_distinct_seasons: [{ season: '45' }],
          get_meta_atlas_distinct_meta_teams: []
        }
        return Promise.resolve({ data: data[funcName] || [], error: null })
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [{ boss_type: 'BelisariusRW', boss_unit_id: 'unmapped_unit' }],
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(body.current_season_bosses).toEqual([
        {
          boss_type: 'BelisariusRW',
          boss_name: 'Belisarius Cawl',
          boss_unit_id: 'unmapped_unit'
        }
      ])
    })

    it('returns per-season rarity_sets_by_season from RPC', async () => {
      mockSupabase.rpc.mockImplementation((funcName: string) => {
        if (funcName === 'get_meta_atlas_rarity_sets_by_season') {
          return Promise.resolve({
            data: [
              { season: '99', rarity_set: 'L1' },
              { season: '99', rarity_set: 'L2' },
              { season: '99', rarity_set: 'L3' },
              { season: '98', rarity_set: 'L1' },
              { season: '98', rarity_set: 'L5' },
              { season: '98', rarity_set: 'M1' },
              { season: '98', rarity_set: 'L3' }
            ],
            error: null
          })
        }
        const data: Record<string, Array<{ [key: string]: string }>> = {
          get_meta_atlas_distinct_bosses: [{ boss_type: 'Boss1' }],
          get_meta_atlas_distinct_rarity_sets: [{ rarity_set: 'L1' }],
          get_meta_atlas_distinct_seasons: [{ season: '99' }, { season: '98' }],
          get_meta_atlas_distinct_meta_teams: []
        }
        return Promise.resolve({ data: data[funcName] || [], error: null })
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.rarity_sets_by_season['99']).toEqual(['L1', 'L2', 'L3'])
      expect(body.rarity_sets_by_season['98']).toEqual(['L1', 'L3', 'L5', 'M1'])
    })

    it('handles empty meta_teams gracefully', async () => {
      mockSupabase.rpc.mockImplementation((funcName: string) => {
        const data: Record<string, Array<{ [key: string]: string }>> = {
          get_meta_atlas_distinct_bosses: [{ boss_type: 'Boss1' }],
          get_meta_atlas_distinct_rarity_sets: [{ rarity_set: 'L1' }],
          get_meta_atlas_distinct_seasons: [{ season: '1' }],
          get_meta_atlas_distinct_meta_teams: []
        }
        return Promise.resolve({ data: data[funcName] || [], error: null })
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.meta_teams).toEqual([])
    })
  })

  describe('fallback to direct query', () => {
    it('uses fallback when RPC fails', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('RPC function not found'))

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              boss_type: 'Hive_Tyrant',
              rarity_set: 'L3',
              meta_team: 'Ultramarines',
              season: '45'
            },
            {
              boss_type: 'Screamer_Killer',
              rarity_set: 'L4',
              meta_team: 'Death Guard',
              season: '44'
            }
          ],
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.bosses).toContain('Hive_Tyrant')
      expect(body.bosses).toContain('Screamer_Killer')
    })

    it('uses fallback when RPC returns error', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC error' }
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              boss_type: 'Boss1',
              rarity_set: 'L2',
              meta_team: 'Team1',
              season: '10'
            }
          ],
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.bosses).toContain('Boss1')
    })

    it('sorts rarity sets correctly in fallback', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('RPC unavailable'))

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            { boss_type: 'B1', rarity_set: 'L3', meta_team: null, season: '1' },
            { boss_type: 'B1', rarity_set: 'L1', meta_team: null, season: '1' },
            { boss_type: 'B1', rarity_set: 'M2', meta_team: null, season: '1' },
            { boss_type: 'B1', rarity_set: 'L5', meta_team: null, season: '1' }
          ],
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(body.rarity_sets).toEqual(['L1', 'L3', 'L5', 'M2'])
    })

    it('sorts seasons descending in fallback', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('RPC unavailable'))

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            {
              boss_type: 'B1',
              rarity_set: 'L1',
              meta_team: null,
              season: '10'
            },
            {
              boss_type: 'B1',
              rarity_set: 'L1',
              meta_team: null,
              season: '45'
            },
            { boss_type: 'B1', rarity_set: 'L1', meta_team: null, season: '30' }
          ],
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(body.seasons).toEqual(['45', '30', '10'])
      expect(body.current_season).toBe('45')
    })
  })

  describe('edge cases', () => {
    it('handles no seasons available', async () => {
      mockSupabase.rpc.mockImplementation((funcName: string) => {
        const data: Record<string, Array<{ [key: string]: string }>> = {
          get_meta_atlas_distinct_bosses: [],
          get_meta_atlas_distinct_rarity_sets: [],
          get_meta_atlas_distinct_seasons: [],
          get_meta_atlas_distinct_meta_teams: []
        }
        return Promise.resolve({ data: data[funcName] || [], error: null })
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.current_season).toBeNull()
      expect(body.previous_season).toBeNull()
      expect(body.season_number).toBeNull()
      expect(body.current_season_bosses).toEqual([])
    })

    it('deduplicates boss_unit_ids in current season', async () => {
      mockSupabase.rpc.mockImplementation((funcName: string) => {
        const data: Record<string, Array<{ [key: string]: string }>> = {
          get_meta_atlas_distinct_bosses: [{ boss_type: 'HiveTyrant' }],
          get_meta_atlas_distinct_rarity_sets: [{ rarity_set: 'L3' }],
          get_meta_atlas_distinct_seasons: [{ season: '45' }],
          get_meta_atlas_distinct_meta_teams: []
        }
        return Promise.resolve({ data: data[funcName] || [], error: null })
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: [
            { boss_type: 'HiveTyrant', boss_unit_id: 'boss_hive' },
            { boss_type: 'HiveTyrant', boss_unit_id: 'boss_hive' },
            { boss_type: 'HiveTyrant', boss_unit_id: 'boss_hive' }
          ],
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(body.current_season_bosses.length).toBe(1)
    })
  })

  describe('error handling', () => {
    it('returns 500 when service client creation fails', async () => {
      mockCreateServiceClient.mockRejectedValue(
        new Error('Auth service unavailable')
      )

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to fetch meta filters')
    })

    it('returns 500 when all queries fail', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('RPC failed'))
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockRejectedValue(new Error('Query failed'))
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to fetch meta filters')
    })
  })
})
