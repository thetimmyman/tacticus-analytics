import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetLatestSeason: ReturnType<typeof vi.fn>
let mockGenerateSeasonPlanForGuild: ReturnType<typeof vi.fn>

describe('/api/guild-raid/season-plan/generate', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockGetLatestSeason = vi.fn().mockResolvedValue('42')
    mockGenerateSeasonPlanForGuild = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess
    }))

    vi.doMock('@/app/lib/utils/season', () => ({
      getLatestSeason: mockGetLatestSeason
    }))

    vi.doMock(
      '@/app/lib/boss-assignments/season-planner/generate-season-plan',
      () => ({
        generateSeasonPlanForGuild: mockGenerateSeasonPlanForGuild
      })
    )

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule =
      await import('@/app/api/guild-raid/season-plan/generate/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET - Generate season plan', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate'
      )

      const response = await GET(request)

      expect(response.status).toBe(401)
    })

    it('returns 403 when boss_assignments feature not enabled', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: false })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('Boss assignments')
    })

    it('returns 403 when season_planner feature not enabled', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess
        .mockResolvedValueOnce({ has_access: true })
        .mockResolvedValueOnce({ has_access: false })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('Season planner')
    })

    it('returns 403 when profile not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Not found' }
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
    })

    it('returns 403 when user is not officer or leader', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'member' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
    })

    it.each(['42abc', '0', '-1', '1234567'])(
      'returns 400 before generating when season is malformed: %s',
      async (season) => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null
        })
        mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { guild_code: 'TEST', role: 'leader' },
            error: null
          })
        })

        const request = new NextRequest(
          `http://localhost/api/guild-raid/season-plan/generate?season=${season}`
        )

        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('season')
        expect(mockGenerateSeasonPlanForGuild).not.toHaveBeenCalled()
      }
    )

    it('returns 503 when no explicit season and latest season is unavailable', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockGetLatestSeason.mockResolvedValue(null)
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error.message).toContain('Season data unavailable')
      expect(mockGenerateSeasonPlanForGuild).not.toHaveBeenCalled()
    })

    it('generates season plan successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader' },
          error: null
        })
      })

      const mockPlan = {
        season: '42',
        plan: { sessions: [] },
        metrics: { totalDamage: 0 }
      }
      mockGenerateSeasonPlanForGuild.mockResolvedValue(mockPlan)

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.season).toBe('42')
      expect(mockGenerateSeasonPlanForGuild).toHaveBeenCalledWith(
        expect.objectContaining({
          guildCode: 'TEST',
          season: '42'
        })
      )
    })

    it('passes custom parameters to generator', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'officer' },
          error: null
        })
      })

      mockGenerateSeasonPlanForGuild.mockResolvedValue({ success: true })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate?season=43&lookback_days=60&sessions_per_day=2&time_zone=America/New_York&snapshot_at=2024-01-15T00:00:00Z'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(mockGenerateSeasonPlanForGuild).toHaveBeenCalledWith({
        guildCode: 'TEST',
        season: '43',
        snapshotAt: '2024-01-15T00:00:00Z',
        lookbackDays: 60,
        sessionsPerDay: 2,
        timeZone: 'America/New_York',
        configId: null
      })
    })

    it('clamps lookback_days to valid range', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader' },
          error: null
        })
      })

      mockGenerateSeasonPlanForGuild.mockResolvedValue({ success: true })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate?lookback_days=500'
      )

      await GET(request)

      expect(mockGenerateSeasonPlanForGuild).toHaveBeenCalledWith(
        expect.objectContaining({
          lookbackDays: 180
        })
      )
    })

    it('clamps sessions_per_day to valid range', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader' },
          error: null
        })
      })

      mockGenerateSeasonPlanForGuild.mockResolvedValue({ success: true })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate?sessions_per_day=10'
      )

      await GET(request)

      expect(mockGenerateSeasonPlanForGuild).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionsPerDay: 3
        })
      )
    })

    it('returns 500 when generator throws', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader' },
          error: null
        })
      })

      mockGenerateSeasonPlanForGuild.mockRejectedValue(
        new Error('Generator failed')
      )

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate'
      )

      const response = await GET(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.metadata?.details).toContain('Generator failed')
    })

    it('handles admin role as officer-level permissions', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'admin' },
          error: null
        })
      })

      mockGenerateSeasonPlanForGuild.mockResolvedValue({ success: true })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/generate'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
    })
  })
})
