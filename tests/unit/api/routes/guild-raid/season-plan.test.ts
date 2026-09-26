import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>

describe('/api/guild-raid/season-plan', () => {
  let GET: (request: NextRequest) => Promise<Response>
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

    const routeModule = await import('@/app/api/guild-raid/season-plan/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET - Fetch season plans', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan?season_id=1'
      )

      const response = await GET(request)

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
        'http://localhost/api/guild-raid/season-plan?season_id=1'
      )

      const response = await GET(request)

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
        'http://localhost/api/guild-raid/season-plan?season_id=1'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
    })

    it('returns 403 when officer role is whitespace-padded', async () => {
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
              data: { guild_code: 'TEST', role: ' officer ' },
              error: null
            })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [],
            error: null
          })
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan?season_id=1'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
    })

    it('returns 400 when neither id nor season_id provided', async () => {
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
        'http://localhost/api/guild-raid/season-plan'
      )

      const response = await GET(request)

      expect(response.status).toBe(400)
    })

    it('returns plan by id when id parameter provided', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      let fromCallCount = 0
      const planEq = vi.fn().mockReturnThis()
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
            select: vi.fn().mockReturnThis(),
            eq: planEq,
            single: vi.fn().mockResolvedValue({
              data: { id: 'plan-123', season_id: '1', plan: {} },
              error: null
            })
          }
        }
        return { select: vi.fn() }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan?id=plan-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.plan.id).toBe('plan-123')
      expect(planEq).toHaveBeenCalledWith('id', 'plan-123')
      expect(planEq).toHaveBeenCalledWith('guild_code', 'TEST')
    })

    it('does not return a saved plan by id from another guild', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      let fromCallCount = 0
      const planFilters = new Map<string, string>()
      const planQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn((column: string, value: string) => {
          planFilters.set(column, value)
          return planQuery
        }),
        single: vi.fn().mockImplementation(async () => {
          if (
            planFilters.get('id') === 'foreign-plan' &&
            !planFilters.has('guild_code')
          ) {
            return {
              data: {
                id: 'foreign-plan',
                guild_code: 'OTHER',
                season_id: '1',
                plan: {}
              },
              error: null
            }
          }
          return {
            data: null,
            error: { message: 'Not found' }
          }
        })
      }

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
          return planQuery
        }
        return { select: vi.fn() }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan?id=foreign-plan'
      )

      const response = await GET(request)

      expect(response.status).toBe(404)
      expect(planQuery.eq).toHaveBeenCalledWith('id', 'foreign-plan')
      expect(planQuery.eq).toHaveBeenCalledWith('guild_code', 'TEST')
    })

    it('returns 404 when plan id not found', async () => {
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
              data: { guild_code: 'TEST', role: 'leader' },
              error: null
            })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Not found' }
          })
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan?id=nonexistent'
      )

      const response = await GET(request)

      expect(response.status).toBe(404)
    })

    it('returns plans list by season_id', async () => {
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
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{ id: 'plan-1' }, { id: 'plan-2' }],
            error: null
          })
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan?season_id=1'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.plans).toHaveLength(2)
    })

    it('returns 500 when database query fails', async () => {
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
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database error' }
          })
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan?season_id=1'
      )

      const response = await GET(request)

      expect(response.status).toBe(500)
    })

    it('handles admin role as officer-level permissions', async () => {
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
              data: { guild_code: 'TEST', role: 'admin' },
              error: null
            })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [],
            error: null
          })
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan?season_id=1'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
    })
  })
})
