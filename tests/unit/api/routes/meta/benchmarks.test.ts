import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('GET /api/meta/benchmarks', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateServiceClient = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    mockSupabase = {
      from: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/meta/benchmarks/route')
    GET = routeModule.GET
  })

  describe('validation', () => {
    it('returns 400 when team_hash is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/benchmarks?boss_type=Hive_Tyrant'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('team_hash and boss_type are re')
    })

    it('returns 400 when boss_type is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('team_hash and boss_type are re')
    })

    it('returns 400 when both parameters are missing', async () => {
      const request = new Request('http://localhost/api/meta/benchmarks')

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('team_hash and boss_type are re')
    })
  })

  describe('successful queries', () => {
    const mockBenchmark = {
      team_hash: 'abc123',
      team_composition: 'Hero1,Hero2,Hero3,Hero4,Hero5',
      meta_team: 'Ultramarines',
      boss_type: 'Hive_Tyrant',
      sub_boss_name: 'Hive Tyrant',
      encounter_type: 'prime',
      rarity: 'L3',
      season: '42',
      attack_count: 150,
      damage_max: 500000,
      damage_p90: 450000,
      damage_p75: 400000,
      damage_avg: 350000
    }

    it('returns benchmark data for valid query', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [mockBenchmark], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.benchmark).toEqual(mockBenchmark)
    })

    it('returns null benchmark when no data found', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=nonexistent&boss_type=Unknown'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.benchmark).toBeNull()
    })

    it('filters by rarity when provided', async () => {
      const eqMock = vi.fn().mockReturnThis()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: eqMock,
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [mockBenchmark], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant&rarity=L3'
      )

      await GET(request)

      expect(eqMock).toHaveBeenCalledWith('rarity', 'L3')
    })

    it('filters by season when provided', async () => {
      const eqMock = vi.fn().mockReturnThis()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: eqMock,
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [mockBenchmark], error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant&season=42'
      )

      await GET(request)

      expect(eqMock).toHaveBeenCalledWith('season', '42')
    })
  })

  describe('percentile calculation', () => {
    const mockBenchmark = {
      team_hash: 'abc123',
      boss_type: 'Hive_Tyrant',
      damage_max: 500000,
      damage_p90: 400000,
      damage_p75: 300000,
      damage_avg: 200000,
      attack_count: 100
    }

    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [mockBenchmark], error: null })
      })
    })

    it('calculates 100th percentile for max damage', async () => {
      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant&user_damage=500000'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.percentile).toBe(100)
      expect(body.user_damage).toBe(500000)
    })

    it('calculates percentile for p90 damage', async () => {
      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant&user_damage=400000'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.percentile).toBe(90)
    })

    it('calculates percentile for p75 damage', async () => {
      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant&user_damage=300000'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.percentile).toBe(75)
    })

    it('calculates percentile for average damage', async () => {
      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant&user_damage=200000'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.percentile).toBe(50)
    })

    it('calculates percentile below average', async () => {
      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant&user_damage=100000'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.percentile).toBe(25)
    })

    it('calculates vs_avg comparison', async () => {
      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant&user_damage=250000'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.vs_avg).toBe(25) // 25% above average
    })

    it('calculates negative vs_avg for below average', async () => {
      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant&user_damage=150000'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.vs_avg).toBe(-25) // 25% below average
    })
  })

  describe('error handling', () => {
    it('returns 500 when database query fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' }
        })
      })

      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to fetch benchmarks')
    })

    it('returns 500 when exception is thrown', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = new Request(
        'http://localhost/api/meta/benchmarks?team_hash=abc123&boss_type=Hive_Tyrant'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to fetch benchmarks')
    })
  })
})
