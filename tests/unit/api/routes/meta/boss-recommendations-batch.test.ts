import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>

describe('POST /api/meta/boss-recommendations-batch', () => {
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

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient,
      createClient: mockCreateClient
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

    mockAuthSupabase = {
      auth: { getUser: vi.fn() }
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)
    mockCreateClient.mockResolvedValue(mockAuthSupabase)

    const routeModule =
      await import('@/app/api/meta/boss-recommendations-batch/route')
    POST = routeModule.POST
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({ boss_types: ['Hive_Tyrant'] })
        }
      )

      const response = await POST(request)
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
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({ boss_types: ['Hive_Tyrant'] })
        }
      )

      const response = await POST(request)
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

    it('returns 400 when boss_types is missing', async () => {
      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('boss_types array is required')
    })

    it('returns 400 when boss_types is not an array', async () => {
      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({ boss_types: 'Hive_Tyrant' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('boss_types array is required')
    })

    it('returns 400 when boss_types is empty', async () => {
      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({ boss_types: [] })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('boss_types array is required')
    })

    it('returns 400 when boss_types exceeds 50', async () => {
      const manyBossTypes = Array(51).fill('Hive_Tyrant')

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({ boss_types: manyBossTypes })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Maximum 50 boss types per requ')
    })

    it('returns 400 for invalid roster payload', async () => {
      const { parseRosterPayload } = await import('@/app/lib/meta/roster-input')
      vi.mocked(parseRosterPayload).mockReturnValue({
        roster: null,
        error: 'Invalid roster'
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({ boss_types: ['Hive_Tyrant'], roster: 'bad' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid roster')
    })
  })

  describe('successful queries', () => {
    const mockMetaAtlasData = [
      {
        team_hash: 'abc123',
        team_composition: 'Hero1, Hero2, Hero3',
        meta_team: 'Ultramarines',
        rarity_set: 'L3',
        sub_boss_name: 'Main',
        boss_type: 'Hive_Tyrant',
        encounter_index: 0,
        damage_p90: 450000,
        damage_p75: 400000,
        damage_max: 500000,
        damage_avg: 350000,
        attack_count: 100,
        season: '45'
      }
    ]

    const mockBossMappings = [
      { boss_type: 'Hive_Tyrant', boss_name: 'Hive Tyrant', encounter_index: 0 }
    ]

    const createChainableQueryMock = (
      resolveData: Record<string, unknown>[],
      trackers?: { eq?: ReturnType<typeof vi.fn> }
    ) => {
      const result = { data: resolveData, error: null }
      const chainable: Record<string, unknown> = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.in = vi.fn().mockReturnValue(chainable)
      chainable.eq = (trackers?.eq || vi.fn()).mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)
      chainable.then = (
        onFulfilled?: (value: typeof result) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        return Promise.resolve(result).then(onFulfilled, onRejected)
      }
      return chainable
    }

    const createBossMappingMock = (resolveData: Record<string, unknown>[]) => {
      const result = { data: resolveData, error: null }
      const chainable: Record<string, unknown> = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.in = vi.fn().mockReturnValue(chainable)
      chainable.then = (
        onFulfilled?: (value: typeof result) => unknown,
        onRejected?: (reason: unknown) => unknown
      ) => {
        return Promise.resolve(result).then(onFulfilled, onRejected)
      }
      return chainable
    }

    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'meta_atlas_data') {
          return createChainableQueryMock(mockMetaAtlasData)
        }
        if (table === 'boss_mapping') {
          return createBossMappingMock(mockBossMappings)
        }
        return { select: vi.fn().mockReturnThis() }
      })
    })

    it('returns batch recommendations for multiple boss types', async () => {
      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({
            boss_types: ['Hive_Tyrant', 'Screamer_Killer'],
            season: '45',
            min_attacks: 20,
            limit: 10
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results).toBeDefined()
      expect(body.filters).toBeDefined()
      expect(body.count).toBeDefined()
    })

    it('includes boss display names from mapping', async () => {
      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({ boss_types: ['Hive_Tyrant'] })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results.Hive_Tyrant).toBeDefined()
      expect(body.results.Hive_Tyrant.boss_name).toBe('Hive Tyrant')
    })

    it('applies season filter when provided', async () => {
      const eqSpy = vi.fn()
      const createTrackedMock = (resolveData: Record<string, unknown>[]) => {
        const result = { data: resolveData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi
          .fn()
          .mockImplementation((...args: readonly unknown[]) => {
            eqSpy(...args)
            return chainable
          })
        chainable.gte = vi.fn().mockReturnValue(chainable)
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
        if (table === 'meta_atlas_data') {
          return createTrackedMock(mockMetaAtlasData)
        }
        return createBossMappingMock(mockBossMappings)
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({ boss_types: ['Hive_Tyrant'], season: '45' })
        }
      )

      await POST(request)

      expect(eqSpy).toHaveBeenCalledWith('season', '45')
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns 500 when meta_atlas_data query fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        in: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        gte: vi.fn().mockReturnThis(),
        order: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: 'Query failed' } })
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({ boss_types: ['Hive_Tyrant'] })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to fetch recommendation')
    })

    it('returns 500 when exception is thrown', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = new Request(
        'http://localhost/api/meta/boss-recommendations-batch',
        {
          method: 'POST',
          body: JSON.stringify({ boss_types: ['Hive_Tyrant'] })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to fetch recommendation')
    })
  })
})
