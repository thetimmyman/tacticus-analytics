import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockDb: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>

describe('/api/meta/boss-recommendations', () => {
  let GET: (request: Request) => Promise<Response>
  let POST: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockDb = vi.fn()
    mockServiceDb = vi.fn()
    mockCheckFeatureAccess = vi.fn()

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb,
      serviceDb: mockServiceDb
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess
    }))

    vi.doMock('@/app/lib/meta/dag-progression', () => ({
      resolveDagProgression: vi
        .fn()
        .mockResolvedValue({ error: 'Not implemented' })
    }))

    vi.doMock('@/app/lib/meta/roster-input', () => ({
      parseRosterPayload: vi.fn().mockReturnValue({ roster: null })
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

    mockDb.mockResolvedValue({
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-123' } } })
      }
    })
    mockServiceDb.mockReturnValue(mockSupabase)
    mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

    const routeModule =
      await import('@/app/api/meta/boss-recommendations/route')
    GET = routeModule.GET
    POST = routeModule.POST
  })

  describe('GET - validation', () => {
    it('returns 400 when boss_type is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/boss-recommendations'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('boss_type is required')
    })
  })

  describe('GET - successful queries', () => {
    const mockMetaData = [
      {
        team_hash: 'abc123',
        team_composition: 'Hero1, Hero2, Hero3, Hero4, Hero5',
        meta_team: 'Ultramarines',
        rarity_set: 'L3',
        sub_boss_name: null,
        damage_p90: 450000,
        damage_p75: 400000,
        damage_max: 500000,
        damage_avg: 350000,
        attack_count: 150,
        season: '45'
      }
    ]

    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockMetaData, error: null }),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })
    })

    it('returns recommendations for valid boss_type', async () => {
      const request = new Request(
        'http://localhost/api/meta/boss-recommendations?boss_type=Hive_Tyrant'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.boss_type).toBe('Hive_Tyrant')
      expect(body.recommendations).toBeDefined()
      expect(Array.isArray(body.recommendations)).toBe(true)
    })

    it('applies rarity filter when provided', async () => {
      const eqMock = vi.fn().mockReturnThis()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: eqMock,
        ilike: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockMetaData, error: null }),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations?boss_type=Hive_Tyrant&rarity=Legendary'
      )

      await GET(request)

      const eqCalls = eqMock.mock.calls
      const rarityCall = eqCalls.find(
        (call: [string, unknown, ...unknown[]]) =>
          call[0] === 'rarity' && call[1] === 'Legendary'
      )
      expect(rarityCall).toBeDefined()
    })

    it('applies rarity_set filter when provided', async () => {
      const eqMock = vi.fn().mockReturnThis()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: eqMock,
        ilike: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockMetaData, error: null }),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations?boss_type=Hive_Tyrant&rarity_set=L3'
      )

      await GET(request)

      const eqCalls = eqMock.mock.calls
      const raritySetCall = eqCalls.find(
        (call: [string, unknown, ...unknown[]]) =>
          call[0] === 'rarity_set' && call[1] === 'L3'
      )
      expect(raritySetCall).toBeDefined()
    })

    it('applies season filter when provided', async () => {
      const eqMock = vi.fn().mockReturnThis()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: eqMock,
        ilike: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockMetaData, error: null }),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations?boss_type=Hive_Tyrant&season=45'
      )

      await GET(request)

      const eqCalls = eqMock.mock.calls
      const seasonCall = eqCalls.find(
        (call: [string, unknown, ...unknown[]]) =>
          call[0] === 'season' && call[1] === '45'
      )
      expect(seasonCall).toBeDefined()
    })

    it('uses min_attacks parameter with default fallback', async () => {
      const gteMock = vi.fn().mockReturnThis()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        gte: gteMock,
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: mockMetaData, error: null }),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations?boss_type=Hive_Tyrant&min_attacks=50'
      )

      await GET(request)

      const gteCalls = gteMock.mock.calls
      const attackCountCall = gteCalls.find(
        (call: [string, unknown, ...unknown[]]) =>
          call[0] === 'attack_count' && call[1] === 50
      )
      expect(attackCountCall).toBeDefined()
    })

    it('returns empty recommendations when no data found and RPC fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' }
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations?boss_type=Unknown_Boss'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.recommendations).toEqual([])
      expect(body.source).toBe('empty')
    })
  })

  describe('GET - boss mapping', () => {
    it('loads boss mapping by boss_name first', async () => {
      const maybeSingleMock = vi
        .fn()
        .mockResolvedValueOnce({
          data: {
            boss_type: 'Hive_Tyrant',
            boss_name: 'Hive Tyrant L3',
            encounter_index: 0
          },
          error: null
        })
        .mockResolvedValue({ data: null, error: null })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue({ data: [{ team_hash: 'abc' }], error: null }),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        maybeSingle: maybeSingleMock
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations?boss_type=Hive_Tyrant'
      )

      await GET(request)

      expect(maybeSingleMock).toHaveBeenCalled()
    })
  })

  describe('GET - error handling', () => {
    it('returns empty recommendations when database query throws', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations?boss_type=Hive_Tyrant'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.recommendations).toEqual([])
      expect(body.source).toBe('empty')
    })
  })

  describe('POST - validation', () => {
    it('returns 400 when boss_type is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/boss-recommendations',
        {
          method: 'POST',
          body: JSON.stringify({ rarity: 'Legendary' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('boss_type is required')
    })

    it('returns 400 for invalid roster payload', async () => {
      const { parseRosterPayload } = await import('@/app/lib/meta/roster-input')
      vi.mocked(parseRosterPayload).mockReturnValue({
        roster: null,
        error: 'Invalid roster format'
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations',
        {
          method: 'POST',
          body: JSON.stringify({ boss_type: 'Hive_Tyrant', roster: 'invalid' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid roster format')
    })
  })

  describe('POST - successful queries', () => {
    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi
          .fn()
          .mockResolvedValue({ data: [{ team_hash: 'abc123' }], error: null }),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
        maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
      })
    })

    it('returns recommendations for valid POST body', async () => {
      const request = new Request(
        'http://localhost/api/meta/boss-recommendations',
        {
          method: 'POST',
          body: JSON.stringify({
            boss_type: 'Hive_Tyrant',
            rarity: 'Legendary',
            season: '45',
            min_attacks: 20,
            limit: 10
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.boss_type).toBe('Hive_Tyrant')
    })
  })

  describe('POST - error handling', () => {
    it('returns 500 when database throws', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Database error')
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations',
        {
          method: 'POST',
          body: JSON.stringify({ boss_type: 'Hive_Tyrant' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to fetch recommendation')
    })
  })
})
