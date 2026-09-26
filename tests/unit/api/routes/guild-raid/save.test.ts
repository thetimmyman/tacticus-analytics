import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>

describe('/api/guild-raid/season-plan/save', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()

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

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule =
      await import('@/app/api/guild-raid/season-plan/save/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST - Save season plan', () => {
    const validPlanBody = {
      season_id: 'season-1',
      start_at: '2024-01-01T00:00:00Z',
      end_at: '2024-01-14T00:00:00Z',
      plan: { sessions: [] }
    }

    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPlanBody)
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('returns 403 when profile not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Not found' }
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPlanBody)
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(403)
    })

    it('returns 403 when user is not officer or leader', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'member' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPlanBody)
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(403)
    })

    it('returns 403 for app-admin members because save is a guild-officer write', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'member', is_app_admin: true },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPlanBody)
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(403)
    })

    it('returns 400 when season_id is missing', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start_at: '2024-01-01T00:00:00Z',
            end_at: '2024-01-14T00:00:00Z',
            plan: {}
          })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('season_id')
    })

    it('returns 400 when start_at/end_at are missing', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            season_id: 'season-1',
            plan: {}
          })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('start_at')
    })

    it('returns 400 when plan is missing', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            season_id: 'season-1',
            start_at: '2024-01-01T00:00:00Z',
            end_at: '2024-01-14T00:00:00Z'
          })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('plan')
    })

    it('saves plan successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        fromCallCount++
        if (fromCallCount === 1 && table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', role: 'leader' },
              error: null
            })
          }
        }
        if (table === 'guild_raid_season_plans') {
          return {
            insert: vi.fn().mockReturnThis(),
            select: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 'new-plan-123' },
              error: null
            })
          }
        }
        return { select: vi.fn() }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPlanBody)
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.id).toBe('new-plan-123')
    })

    it('saves plan with optional fields', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        fromCallCount++
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', role: 'officer' },
              error: null
            })
          }
        }
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'new-plan-456' },
            error: null
          })
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...validPlanBody,
            kind: 'baseline',
            baseline_key: 'v1',
            trigger: 'auto',
            seed: 12345,
            plan_hash: 'abc123',
            resolved_options: { sessionsPerDay: 2 },
            plan_metrics: { totalDamage: 10000 }
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })

    it('returns 500 when database insert fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        fromCallCount++
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', role: 'leader' },
              error: null
            })
          }
        }
        return {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Insert failed' }
          })
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/save',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(validPlanBody)
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(500)
    })
  })
})
