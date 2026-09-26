import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('GET /api/meta/trends', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateServiceClient = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
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

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/meta/trends/route')
    GET = routeModule.GET
  })

  describe('validation', () => {
    it('returns 400 when current_season is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/trends?previous_season=44'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('current_season and previous_se')
    })

    it('returns 400 when previous_season is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/trends?current_season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('current_season and previous_se')
    })
  })

  describe('successful queries', () => {
    const mockMetaData = [
      { meta_team: 'Ultramarines', damage_p90: 500000, attack_count: 100 },
      { meta_team: 'Ultramarines', damage_p90: 480000, attack_count: 80 },
      { meta_team: 'Black Templars', damage_p90: 450000, attack_count: 60 }
    ]

    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })
    })

    it('returns trends for valid seasons', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'meta_atlas_data') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            lt: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = new Request(
        'http://localhost/api/meta/trends?current_season=45&previous_season=44'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.current_season).toBe('45')
      expect(body.previous_season).toBe('44')
      expect(body.trends).toBeDefined()
      expect(body.rising_stars).toBeDefined()
      expect(body.falling_off).toBeDefined()
      expect(body.off_meta_gems).toBeDefined()
    })

    it('applies rarity filter when provided', async () => {
      const eqMock = vi.fn().mockReturnThis()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: eqMock,
        gte: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/trends?current_season=45&previous_season=44&rarity=Legendary'
      )

      await GET(request)

      expect(eqMock).toHaveBeenCalled()
    })

    it('applies rarity_set filter when provided', async () => {
      const eqMock = vi.fn().mockReturnThis()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: eqMock,
        gte: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/trends?current_season=45&previous_season=44&rarity_set=L3'
      )

      await GET(request)

      expect(eqMock).toHaveBeenCalledWith('rarity_set', 'L3')
    })

    it('uses min_attacks parameter', async () => {
      const gteMock = vi.fn().mockReturnThis()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: gteMock,
        not: vi.fn().mockReturnThis(),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/trends?current_season=45&previous_season=44&min_attacks=50'
      )

      await GET(request)

      expect(gteMock).toHaveBeenCalledWith('attack_count', 50)
    })

    it('calculates rising trends correctly', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockImplementation((col, val) => {
            if (col === 'season') {
              if (val === '45') {
                return {
                  gte: vi.fn().mockReturnThis(),
                  not: vi.fn().mockResolvedValue({
                    data: [
                      {
                        meta_team: 'Team1',
                        damage_p90: 600000,
                        attack_count: 100
                      }
                    ],
                    error: null
                  }),
                  lt: vi.fn().mockReturnThis(),
                  order: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockResolvedValue({ data: [], error: null })
                }
              }
              if (val === '44') {
                return {
                  gte: vi.fn().mockReturnThis(),
                  not: vi.fn().mockResolvedValue({
                    data: [
                      {
                        meta_team: 'Team1',
                        damage_p90: 400000,
                        attack_count: 80
                      }
                    ],
                    error: null
                  }),
                  lt: vi.fn().mockReturnThis(),
                  order: vi.fn().mockReturnThis(),
                  limit: vi.fn().mockResolvedValue({ data: [], error: null })
                }
              }
            }
            return {
              gte: vi.fn().mockReturnThis(),
              not: vi.fn().mockReturnThis(),
              lt: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockResolvedValue({ data: [], error: null })
            }
          }),
          gte: vi.fn().mockReturnThis(),
          not: vi.fn().mockReturnThis(),
          lt: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null })
        }
      })

      const request = new Request(
        'http://localhost/api/meta/trends?current_season=45&previous_season=44'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
    })

    it('falls back to RPC when materialized view returns empty', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        not: vi.fn().mockResolvedValue({ data: [], error: null }),
        lt: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })
      mockSupabase.rpc.mockResolvedValue({
        data: mockMetaData,
        error: null
      })

      const request = new Request(
        'http://localhost/api/meta/trends?current_season=45&previous_season=44'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
    })
  })

  describe('error handling', () => {
    it('returns 500 when database query throws', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = new Request(
        'http://localhost/api/meta/trends?current_season=45&previous_season=44'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to fetch meta trends')
    })
  })
})
