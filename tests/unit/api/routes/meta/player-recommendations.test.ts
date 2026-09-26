import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetUserAccessLevels: ReturnType<typeof vi.fn>
let mockGetPlayerApiKey: ReturnType<typeof vi.fn>
let mockTacticusAPI: { getPlayer: ReturnType<typeof vi.fn> }

describe('GET /api/meta/player-recommendations', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let mockAuthSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateServiceClient = vi.fn()
    mockCreateClient = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockGetUserAccessLevels = vi.fn()
    mockGetPlayerApiKey = vi.fn()
    mockTacticusAPI = { getPlayer: vi.fn() }

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient,
      createClient: mockCreateClient
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess,
      getUserAccessLevels: mockGetUserAccessLevels
    }))

    vi.doMock('@tacticus/app-core/api-key-helper', () => ({
      getPlayerApiKey: mockGetPlayerApiKey
    }))

    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: mockTacticusAPI
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockAuthSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)
    mockCreateClient.mockResolvedValue(mockAuthSupabase)

    const routeModule =
      await import('@/app/api/meta/player-recommendations/route')
    GET = routeModule.GET
  })

  describe('validation', () => {
    it('returns 400 when player_name is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/player-recommendations?guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('player_name and guild_code are')
    })

    it('returns 400 when guild_code is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('player_name and guild_code are')
    })
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('guild access', () => {
    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 403 when user tries to view another guild', async () => {
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'OTHER',
        is_app_admin: false
      })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('You can only view recommendati')
    })

    it('allows app admin to view any guild', async () => {
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'OTHER',
        is_app_admin: true
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: [], error: null })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
    })
  })

  describe('feature access', () => {
    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'TEST',
        is_app_admin: false
      })
    })

    it('returns 403 when user lacks meta_atlas access', async () => {
      mockCheckFeatureAccess.mockResolvedValue({
        has_access: false,
        stage: 'beta',
        reason: 'Feature in beta'
      })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('Meta Atlas feature access requ')
      expect(body.error.metadata?.stage).toBe('beta')
    })
  })

  describe('successful queries', () => {
    const mockPlayerTeams = [
      {
        boss_name: 'Hive Tyrant',
        boss_type: 'Hive_Tyrant',
        rarity: 'Legendary',
        encounter_index: 0,
        encounter_type: null,
        team_hash: 'abc123',
        team_composition: 'Hero1, Hero2, Hero3, Hero4, Hero5',
        attack_count: 10,
        avg_damage: 450000,
        meta_team: 'Ultramarines'
      }
    ]

    const mockMetaTeams = [
      {
        team_hash: 'abc123',
        team_composition: 'Hero1, Hero2, Hero3, Hero4, Hero5',
        meta_team: 'Ultramarines',
        damage_p75: 480000,
        damage_p90: 520000,
        damage_avg: 460000,
        attack_count: 100,
        boss_type: 'Hive_Tyrant',
        rarity: 'Legendary',
        encounter_index: 0,
        encounter_type: null
      }
    ]

    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'TEST',
        is_app_admin: false
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns empty results when no player data found', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: [], error: null })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('TestPlayer')
      expect(body.guild_code).toBe('TEST')
      expect(body.boss_comparisons).toEqual([])
      expect(body.roster_gaps).toEqual([])
      expect(body.message).toBe('No battle data found for this player')
    })

    it('returns recommendations for player with battle data', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: mockPlayerTeams, error: null })

      const createChainableQueryMock = (
        resolveData: Record<string, unknown>[]
      ) => {
        const result = { data: resolveData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.gte = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.single = vi
          .fn()
          .mockResolvedValue({ data: null, error: null })
        chainable.then = (
          onFulfilled?: (value: typeof result) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'hero_mappings') {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return createChainableQueryMock([])
      })
      mockAuthSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('TestPlayer')
      expect(body.boss_comparisons).toBeDefined()
      expect(Array.isArray(body.boss_comparisons)).toBe(true)
      expect(body.boss_comparisons.length).toBeGreaterThan(0)
      expect(body.roster_gaps).toBeDefined()
      expect(body.summary).toBeDefined()
      expect(body.summary.bosses_analyzed).toBeGreaterThan(0)
    })

    it('includes summary with optimal and improvement counts', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: mockPlayerTeams, error: null })

      const createChainableQueryMock = (
        resolveData: Record<string, unknown>[]
      ) => {
        const result = { data: resolveData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.gte = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.single = vi
          .fn()
          .mockResolvedValue({ data: null, error: null })
        chainable.then = (
          onFulfilled?: (value: typeof result) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'hero_mappings') {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return createChainableQueryMock([])
      })
      mockAuthSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.summary).toHaveProperty('bosses_analyzed')
      expect(body.summary).toHaveProperty('optimal_teams')
      expect(body.summary).toHaveProperty('can_improve')
      expect(body.summary.optimal_teams).toBe(body.summary.bosses_analyzed)
    })

    it('uses season parameter when provided', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockPlayerTeams, error: null })

      const createChainableQueryMock = (
        resolveData: Record<string, unknown>[]
      ) => {
        const result = { data: resolveData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.gte = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.single = vi
          .fn()
          .mockResolvedValue({ data: null, error: null })
        chainable.then = (
          onFulfilled?: (value: typeof result) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'hero_mappings') {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return createChainableQueryMock([])
      })
      mockAuthSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST&season=44'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.season).toBe('44')
    })

    it('applies rarity_set filter', async () => {
      const eqMock = vi.fn()
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: mockPlayerTeams, error: null })

      const createChainableQueryMock = (
        resolveData: Record<string, unknown>[]
      ) => {
        const mockQuery: Record<string, unknown> = {
          data: resolveData,
          error: null
        }
        const chainable: Record<string, unknown> = {
          select: vi.fn().mockImplementation(() => chainable),
          eq: eqMock.mockImplementation(() => chainable),
          in: vi.fn().mockImplementation(() => chainable),
          gte: vi.fn().mockImplementation(() => chainable),
          order: vi.fn().mockImplementation(() => chainable),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          then: (resolve: (value: typeof mockQuery) => void) => {
            resolve(mockQuery)
            return Promise.resolve(mockQuery)
          }
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'hero_mappings') {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return createChainableQueryMock([])
      })
      mockAuthSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST&rarity_set=L3'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
    })

    it('fetches current season when not provided', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: [], error: null })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST'
      )

      await GET(request)

      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_current_season')
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'TEST',
        is_app_admin: false
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns 500 when player teams RPC fails', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'RPC failed' } })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to fetch player team us')
    })

    it('returns 500 when exception is thrown', async () => {
      mockSupabase.rpc.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = new Request(
        'http://localhost/api/meta/player-recommendations?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to generate recommendat')
    })
  })
})
