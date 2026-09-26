import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetUserAccessLevels: ReturnType<typeof vi.fn>

describe('POST /api/meta/hero-impact', () => {
  let POST: (request: Request) => Promise<Response>
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

    vi.doMock('@/app/lib/meta/team-progression', () => ({
      createTeamDAG: vi.fn().mockReturnValue(new Map()),
      findUpgradePaths: vi.fn().mockReturnValue([])
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

    const routeModule = await import('@/app/api/meta/hero-impact/route')
    POST = routeModule.POST
  })

  describe('validation', () => {
    it('returns 400 when player_name is missing', async () => {
      const request = new Request('http://localhost/api/meta/hero-impact', {
        method: 'POST',
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('player_name and guild_code are')
    })

    it('returns 400 when guild_code is missing', async () => {
      const request = new Request('http://localhost/api/meta/hero-impact', {
        method: 'POST',
        body: JSON.stringify({ player_name: 'TestPlayer' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('player_name and guild_code are')
    })
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new Request('http://localhost/api/meta/hero-impact', {
        method: 'POST',
        body: JSON.stringify({ player_name: 'TestPlayer', guild_code: 'TEST' })
      })

      const response = await POST(request)
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

      const request = new Request('http://localhost/api/meta/hero-impact', {
        method: 'POST',
        body: JSON.stringify({ player_name: 'TestPlayer', guild_code: 'TEST' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('You can only view hero impact ')
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
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null }),
        or: vi.fn().mockReturnThis(),
        gte: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const request = new Request('http://localhost/api/meta/hero-impact', {
        method: 'POST',
        body: JSON.stringify({
          player_name: 'TestPlayer',
          guild_code: 'TEST',
          season: '45'
        })
      })

      const response = await POST(request)
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

      const request = new Request('http://localhost/api/meta/hero-impact', {
        method: 'POST',
        body: JSON.stringify({ player_name: 'TestPlayer', guild_code: 'TEST' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('Meta Atlas feature access requ')
      expect(body.error.metadata?.stage).toBe('beta')
    })
  })

  describe('successful queries', () => {
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

    it('returns empty hero_impacts when no battle data found', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const request = new Request('http://localhost/api/meta/hero-impact', {
        method: 'POST',
        body: JSON.stringify({
          player_name: 'TestPlayer',
          guild_code: 'TEST',
          season: '45'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('TestPlayer')
      expect(body.hero_impacts).toEqual([])
      expect(body.message).toBe('No battle data found')
    })

    it('returns hero impacts with battle data', async () => {
      const mockBattleData = [
        {
          Name: 'Hive_Tyrant',
          unitId: 'GuildBoss1HiveTyrant',
          heroDetails: JSON.stringify([
            { unitId: 'Hero1' },
            { unitId: 'Hero2' }
          ]),
          machineOfWarDetails: null,
          damageDealt: 450000,
          tier: 3,
          set: 'L'
        }
      ]

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'EOT_GR_data') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi
              .fn()
              .mockResolvedValue({ data: mockBattleData, error: null })
          }
        }
        if (table === 'boss_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            not: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        if (table === 'meta_atlas_data') {
          return {
            select: vi.fn().mockReturnThis(),
            or: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = new Request('http://localhost/api/meta/hero-impact', {
        method: 'POST',
        body: JSON.stringify({
          player_name: 'TestPlayer',
          guild_code: 'TEST',
          season: '45'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('TestPlayer')
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

    it('returns 500 when database query throws', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        order: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: 'DB Error' } })
      })

      const request = new Request('http://localhost/api/meta/hero-impact', {
        method: 'POST',
        body: JSON.stringify({
          player_name: 'TestPlayer',
          guild_code: 'TEST',
          season: '45'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to analyze hero impact')
    })

    it('returns 500 when exception is thrown', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = new Request('http://localhost/api/meta/hero-impact', {
        method: 'POST',
        body: JSON.stringify({
          player_name: 'TestPlayer',
          guild_code: 'TEST',
          season: '45'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to analyze hero impact')
    })
  })
})
