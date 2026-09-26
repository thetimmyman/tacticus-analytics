import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetUserAccessLevels: ReturnType<typeof vi.fn>

describe('GET /api/meta/performance-gaps', () => {
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

    const routeModule = await import('@/app/api/meta/performance-gaps/route')
    GET = routeModule.GET
  })

  describe('validation', () => {
    it('returns 400 when player_name is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/performance-gaps?guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('player_name and guild_code are')
    })

    it('returns 400 when guild_code is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer'
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
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST'
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
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('You can only view performance ')
    })

    it('allows app admin to view any guild', async () => {
      mockGetUserAccessLevels.mockResolvedValue({
        guild_code: 'OTHER',
        is_app_admin: true
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = new Request(
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST'
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
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST'
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
        boss_type: 'Hive_Tyrant',
        rarity: 'Legendary',
        team_hash: 'abc123',
        team_composition: 'Hero1, Hero2, Hero3, Hero4, Hero5',
        attack_count: 10,
        avg_damage: 300000
      }
    ]

    const mockMetaData = [
      {
        team_hash: 'abc123',
        boss_type: 'Hive_Tyrant',
        rarity: 'Legendary',
        damage_avg: 400000,
        damage_p75: 450000,
        damage_p90: 500000,
        attack_count: 100
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

    it('returns empty gaps when no player data found', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = new Request(
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('TestPlayer')
      expect(body.guild_code).toBe('TEST')
      expect(body.gaps).toEqual([])
      expect(body.message).toBe('No battle data found for this player')
    })

    it('returns performance gaps for player', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockPlayerTeams, error: null })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: mockMetaData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('TestPlayer')
      expect(body.gaps).toBeDefined()
      expect(body.all_teams).toBeDefined()
      expect(body.summary).toBeDefined()
    })

    it('includes tier distribution in summary', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockPlayerTeams, error: null })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: mockMetaData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.summary.tier_distribution).toBeDefined()
      expect(body.summary.tier_distribution).toHaveProperty('elite')
      expect(body.summary.tier_distribution).toHaveProperty('excellent')
      expect(body.summary.tier_distribution).toHaveProperty('above_average')
      expect(body.summary.tier_distribution).toHaveProperty('average')
      expect(body.summary.tier_distribution).toHaveProperty('below_average')
      expect(body.summary.tier_distribution).toHaveProperty('needs_improvement')
    })

    it('applies min_attacks filter', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockPlayerTeams, error: null })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: mockMetaData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST&min_attacks=5'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
    })

    it('applies min_gap_pct filter', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockPlayerTeams, error: null })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: mockMetaData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST&min_gap_pct=15'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
    })

    it('applies limit parameter', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockPlayerTeams, error: null })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: mockMetaData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST&limit=5'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
    })

    it('includes top_performers and watch_list in summary', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockPlayerTeams, error: null })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: mockMetaData, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.summary.top_performers).toBeDefined()
      expect(body.summary.watch_list).toBeDefined()
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

    it('returns 500 when RPC fails', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' }
      })

      const request = new Request(
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST'
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
        'http://localhost/api/meta/performance-gaps?player_name=TestPlayer&guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to analyze performance ')
    })
  })
})
