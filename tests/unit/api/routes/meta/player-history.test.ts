import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetUserAccessLevels: ReturnType<typeof vi.fn>

describe('GET /api/meta/player-history', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let mockAuthSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateServiceClient = vi.fn()
    mockCreateClient = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockGetUserAccessLevels = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient,
      createClient: mockCreateClient
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
      auth: { getUser: vi.fn() }
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)
    mockCreateClient.mockResolvedValue(mockAuthSupabase)

    const routeModule = await import('@/app/api/meta/player-history/route')
    GET = routeModule.GET
  })

  describe('validation', () => {
    it('returns 400 when player_name is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/player-history?guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('player_name and guild_code are')
    })

    it('returns 400 when guild_code is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer'
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
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
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
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('You can only view player histo')
    })

    it('allows app admin to view any guild', async () => {
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'OTHER',
        is_app_admin: true
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
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
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('Meta Atlas feature access requ')
      expect(body.error.metadata?.stage).toBe('beta')
    })
  })

  describe('successful queries', () => {
    const mockSeasonData = [
      { Season: '45', Name: 'Hive_Tyrant', damageDealt: 500000 },
      { Season: '45', Name: 'Hive_Tyrant', damageDealt: 450000 },
      { Season: '44', Name: 'Screamer_Killer', damageDealt: 400000 },
      { Season: '44', Name: 'Screamer_Killer', damageDealt: 380000 }
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

    it('returns empty data when no history found', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('TestPlayer')
      expect(body.guild_code).toBe('TEST')
      expect(body.seasons).toEqual([])
      expect(body.boss_breakdown).toEqual([])
      expect(body.message).toBe('No historical data found for this player')
    })

    it('returns player history with trends', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockSeasonData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('TestPlayer')
      expect(body.seasons).toBeDefined()
      expect(body.boss_breakdown).toBeDefined()
      expect(body.trends).toBeDefined()
    })

    it('calculates trends correctly', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockSeasonData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.trends).toHaveProperty('direction')
      expect(body.trends).toHaveProperty('change_pct')
      expect(body.trends).toHaveProperty('cagr')
      expect(body.trends).toHaveProperty('cagr_periods')
      expect(body.trends).toHaveProperty('regression_r2')
      expect(body.trends).toHaveProperty('trendline_points')
      expect(body.trends).toHaveProperty('has_enough_data')
    })

    it('includes season summaries', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockSeasonData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.seasons.length).toBeGreaterThan(0)
      expect(body.seasons[0]).toHaveProperty('season')
      expect(body.seasons[0]).toHaveProperty('total_damage')
      expect(body.seasons[0]).toHaveProperty('total_attacks')
      expect(body.seasons[0]).toHaveProperty('avg_damage_per_attack')
      expect(body.seasons[0]).toHaveProperty('bosses_fought')
      expect(body.seasons[0]).toHaveProperty('best_boss')
      expect(body.seasons[0]).toHaveProperty('best_boss_damage')
    })

    it('includes boss breakdown', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockSeasonData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.boss_breakdown.length).toBeGreaterThan(0)
      expect(body.boss_breakdown[0]).toHaveProperty('season')
      expect(body.boss_breakdown[0]).toHaveProperty('boss_type')
      expect(body.boss_breakdown[0]).toHaveProperty('avg_damage')
      expect(body.boss_breakdown[0]).toHaveProperty('total_damage')
      expect(body.boss_breakdown[0]).toHaveProperty('total_attacks')
      expect(body.boss_breakdown[0]).toHaveProperty('best_damage')
    })

    it('applies limit parameter', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: mockSeasonData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST&limit=5'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
    })

    it('detects improving trend', async () => {
      const improvingData = [
        { Season: '45', Name: 'Boss', damageDealt: 600000 },
        { Season: '45', Name: 'Boss', damageDealt: 550000 },
        { Season: '44', Name: 'Boss', damageDealt: 400000 },
        { Season: '44', Name: 'Boss', damageDealt: 380000 }
      ]

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: improvingData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.trends.direction).toBe('improving')
    })

    it('detects declining trend', async () => {
      const decliningData = [
        { Season: '45', Name: 'Boss', damageDealt: 300000 },
        { Season: '45', Name: 'Boss', damageDealt: 280000 },
        { Season: '44', Name: 'Boss', damageDealt: 500000 },
        { Season: '44', Name: 'Boss', damageDealt: 480000 }
      ]

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: decliningData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.trends.direction).toBe('declining')
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

    it('returns 500 when query fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: 'Query failed' } })
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to fetch player history')
    })

    it('returns 500 when exception is thrown', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = new Request(
        'http://localhost/api/meta/player-history?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to fetch player history')
    })
  })
})
