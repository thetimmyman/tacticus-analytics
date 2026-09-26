import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockDb: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetUserAccessLevels: ReturnType<typeof vi.fn>

describe('GET /api/meta/player-current-teams', () => {
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

    mockDb = vi.fn()
    mockServiceDb = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockGetUserAccessLevels = vi.fn()

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb,
      serviceDb: mockServiceDb
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess,
      getUserAccessLevels: mockGetUserAccessLevels
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

    mockServiceDb.mockReturnValue(mockSupabase)
    mockDb.mockResolvedValue(mockAuthSupabase)

    const routeModule =
      await import('@/app/api/meta/player-current-teams/route')
    GET = routeModule.GET
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('feature access', () => {
    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 403 when user lacks meta_atlas access', async () => {
      mockCheckFeatureAccess.mockResolvedValue({
        has_access: false,
        stage: 'beta',
        reason: 'Feature in beta'
      })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('Meta Atlas feature access requ')
      expect(body.error.metadata?.stage).toBe('beta')
    })
  })

  describe('validation', () => {
    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns 400 when player_name is provided without guild_code', async () => {
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'TEST',
        is_app_admin: false
      })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams?player_name=TestPlayer'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('player_name and guild_code are')
    })

    it('returns 400 when guild_code is provided without player_name', async () => {
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'TEST',
        is_app_admin: false
      })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams?guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('player_name and guild_code are')
    })
  })

  describe('guild access', () => {
    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns 403 when user tries to view another guild', async () => {
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'OTHER',
        is_app_admin: false
      })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('You can only view teams for yo')
    })

    it('allows app admin to view any guild', async () => {
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'OTHER',
        is_app_admin: true
      })
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: [], error: null })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.message).toBe('No battle data found for this player')
    })
  })

  describe('auto-detection from profile', () => {
    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns 400 when profile not found', async () => {
      mockAuthSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Player profile not found. Comp')
    })

    it('uses profile data when params not provided', async () => {
      mockAuthSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { display_name: 'ProfilePlayer', guild_code: 'PROFILE' },
          error: null
        })
      })
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'PROFILE',
        is_app_admin: false
      })
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: [], error: null })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ data: [], error: null }),
        eq: vi.fn().mockReturnThis()
      })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('ProfilePlayer')
      expect(body.guild_code).toBe('PROFILE')
    })
  })

  describe('successful queries', () => {
    const mockPlayerTeams = [
      {
        boss_name: 'Hive Tyrant',
        boss_type: 'Hive_Tyrant',
        rarity: 'Legendary',
        rarity_set: 'L3',
        encounter_index: 0,
        encounter_type: null,
        team_hash: 'abc123',
        team_composition: 'Hero1, Hero2, Hero3, Hero4, Hero5',
        attack_count: 10,
        avg_damage: 450000,
        meta_team: 'Ultramarines'
      }
    ]

    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'TEST',
        is_app_admin: false
      })
    })

    it('returns empty current_teams when no data found', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: [], error: null })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('TestPlayer')
      expect(body.guild_code).toBe('TEST')
      expect(body.current_teams).toEqual([])
      expect(body.message).toBe('No battle data found for this player')
    })

    it('returns current teams for player', async () => {
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
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'boss_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({
              data: [
                {
                  boss_type: 'Hive_Tyrant',
                  boss_name: 'Hive Tyrant',
                  encounter_index: 0
                }
              ],
              error: null
            })
          }
        }
        return createChainableQueryMock([])
      })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.current_teams).toBeDefined()
      expect(Array.isArray(body.current_teams)).toBe(true)
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
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'boss_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        return createChainableQueryMock([])
      })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams?player_name=TestPlayer&guild_code=TEST&season=44'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.season).toBe('44')
    })

    it('fetches current season when not provided', async () => {
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
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'boss_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            in: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        return createChainableQueryMock([])
      })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(mockSupabase.rpc).toHaveBeenCalledWith('get_current_season')
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'TEST',
        is_app_admin: false
      })
    })

    it('returns 500 when RPC fails', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'RPC failed' } })

      const request = new Request(
        'http://localhost/api/meta/player-current-teams?player_name=TestPlayer&guild_code=TEST'
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
        'http://localhost/api/meta/player-current-teams?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to load current teams')
    })
  })
})
