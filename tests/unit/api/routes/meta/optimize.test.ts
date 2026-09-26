import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>

type MockQueryData = unknown
type MockQueryError = unknown
type MockThenError = unknown
type MockThenReturn = unknown
type MockQueryArgs = unknown[]

describe('POST /api/meta/optimize', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateServiceClient = vi.fn()
    mockApiSecurityMiddleware = vi.fn().mockResolvedValue(null)

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
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

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/meta/optimize/route')
    POST = routeModule.POST
  })

  describe('security', () => {
    it('short-circuits when public rate limiting rejects the request', async () => {
      mockApiSecurityMiddleware.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429
        })
      )

      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roster: ['Hero1'] })
      })

      const response = await POST(request)

      expect(response.status).toBe(429)
      expect(mockApiSecurityMiddleware).toHaveBeenCalledWith(request, {
        requireAuth: false,
        skipSecurityChecks: true
      })
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('returns 400 when roster is missing', async () => {
      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({ player_name: 'TestPlayer' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('roster is required and must be')
    })

    it('returns 400 when roster is empty', async () => {
      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({ roster: [] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('roster is required and must be')
    })

    it('returns 400 when roster is not an array', async () => {
      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({ roster: 'not-an-array' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('roster is required and must be')
    })

    it('returns 413 for an oversized body without relying on content-length', async () => {
      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({ roster: ['Hero1'], padding: 'x'.repeat(70_000) })
      })

      const response = await POST(request)

      expect(response.status).toBe(413)
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })

    it('returns 400 when the roster exceeds the work limit', async () => {
      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({
          roster: Array.from({ length: 301 }, (_, index) => `Hero${index}`)
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })

    it('returns 400 when a boss list exceeds the query limit', async () => {
      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({
          roster: ['Hero1'],
          boss_types: Array.from({ length: 51 }, (_, index) => `Boss${index}`)
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })
  })

  describe('successful queries', () => {
    const mockRoster = ['Hero1', 'Hero2', 'Hero3', 'Hero4', 'Hero5']

    const mockMetaData = [
      {
        team_hash: 'abc123',
        team_composition: 'Hero1, Hero2, Hero3, Hero4, Hero5',
        meta_team: 'Ultramarines',
        boss_type: 'Hive_Tyrant',
        boss_unit_id: null,
        rarity_set: 'L3',
        damage_p90: 500000,
        damage_avg: 450000,
        attack_count: 100
      }
    ]

    const createChainableQueryMock = (
      resolveData: MockQueryData,
      trackers?: {
        eq?: ReturnType<typeof vi.fn>
        in?: ReturnType<typeof vi.fn>
      }
    ) => {
      const result = { data: resolveData, error: null }
      const chainable: Record<string, unknown> = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.not = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.eq = (trackers?.eq || vi.fn()).mockReturnValue(chainable)
      chainable.in = (trackers?.in || vi.fn()).mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)
      chainable.limit = vi.fn().mockReturnValue(chainable)
      chainable.then = (
        onFulfilled?: (value: typeof result) => MockThenReturn,
        onRejected?: (reason: MockThenError) => MockThenReturn
      ) => {
        return Promise.resolve(result).then(onFulfilled, onRejected)
      }
      return chainable
    }

    beforeEach(() => {
      mockSupabase.from.mockReturnValue(createChainableQueryMock(mockMetaData))
    })

    it('returns optimization results for valid roster', async () => {
      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({
          roster: mockRoster,
          player_name: 'TestPlayer'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.player_name).toBe('TestPlayer')
      expect(body.roster_size).toBe(5)
      expect(body.assignments).toBeDefined()
      expect(Array.isArray(body.assignments)).toBe(true)
    })

    it('accepts roster as array of objects', async () => {
      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({
          roster: [
            { name: 'Hero1', rarity: 'Legendary' },
            { name: 'Hero2', rarity: 'Epic' }
          ]
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.roster_size).toBe(2)
    })

    it('filters by rarity_set when provided', async () => {
      const eqSpy = vi.fn()
      const createTrackedMock = (resolveData: MockQueryData) => {
        const result = { data: resolveData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.gte = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockImplementation((...args: MockQueryArgs) => {
          eqSpy(...args)
          return chainable
        })
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }
      mockSupabase.from.mockReturnValue(createTrackedMock(mockMetaData))

      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({
          roster: mockRoster,
          rarity_set: 'L3'
        })
      })

      await POST(request)

      expect(eqSpy).toHaveBeenCalledWith('rarity_set', 'L3')
    })

    it('filters by boss_types when provided', async () => {
      const inSpy = vi.fn()
      const createTrackedMock = (resolveData: MockQueryData) => {
        const result = { data: resolveData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.gte = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockImplementation((...args: MockQueryArgs) => {
          inSpy(...args)
          return chainable
        })
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }
      mockSupabase.from.mockReturnValue(createTrackedMock(mockMetaData))

      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({
          roster: mockRoster,
          boss_types: ['Hive_Tyrant', 'Screamer_Killer']
        })
      })

      await POST(request)

      expect(inSpy).toHaveBeenCalledWith('boss_type', [
        'Hive_Tyrant',
        'Screamer_Killer'
      ])
    })

    it('filters by boss_unit_ids when provided', async () => {
      const createThenableMock = (resolveData: MockQueryData) => {
        const result = { data: resolveData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.gte = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'boss_mapping') {
          return createThenableMock([
            {
              unit_id: 'GuildBoss1',
              boss_type: 'Hive_Tyrant',
              boss_name: 'Hive Tyrant'
            }
          ])
        }
        return createThenableMock(mockMetaData)
      })

      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({
          roster: mockRoster,
          boss_unit_ids: ['GuildBoss1']
        })
      })

      const response = await POST(request)
      expect(response.status).toBe(200)
    })

    it('applies min_coverage filter', async () => {
      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({
          roster: mockRoster,
          min_coverage: 80
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
    })

    it('includes optimization notes', async () => {
      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({ roster: mockRoster })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.optimization_notes).toBeDefined()
      expect(Array.isArray(body.optimization_notes)).toBe(true)
    })

    it('lists unassigned bosses', async () => {
      const createThenableMock = (resolveData: MockQueryData) => {
        const result = { data: resolveData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.gte = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.limit = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }
      mockSupabase.from.mockReturnValue(createThenableMock([]))

      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({
          roster: mockRoster,
          boss_types: ['Hive_Tyrant', 'Unknown_Boss']
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.unassigned_bosses).toBeDefined()
    })
  })

  describe('error handling', () => {
    const createChainableQueryMock = (
      resolveData: MockQueryData,
      error: MockQueryError = null
    ) => {
      const result = { data: resolveData, error }
      const chainable: Record<string, unknown> = {}
      chainable.select = vi.fn().mockReturnValue(chainable)
      chainable.not = vi.fn().mockReturnValue(chainable)
      chainable.gte = vi.fn().mockReturnValue(chainable)
      chainable.eq = vi.fn().mockReturnValue(chainable)
      chainable.in = vi.fn().mockReturnValue(chainable)
      chainable.order = vi.fn().mockReturnValue(chainable)
      chainable.limit = vi.fn().mockReturnValue(chainable)
      chainable.then = (
        onFulfilled?: (value: typeof result) => MockThenReturn,
        onRejected?: (reason: MockThenError) => MockThenReturn
      ) => {
        return Promise.resolve(result).then(onFulfilled, onRejected)
      }
      return chainable
    }

    it('returns 500 when database query throws', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({ roster: ['Hero1', 'Hero2'] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to optimize team assign')
    })

    it('returns 500 when meta_atlas_data query fails', async () => {
      mockSupabase.from.mockReturnValue(
        createChainableQueryMock(null, { message: 'Query failed' })
      )

      const request = new NextRequest('http://localhost/api/meta/optimize', {
        method: 'POST',
        body: JSON.stringify({ roster: ['Hero1', 'Hero2'] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to optimize team assign')
    })
  })
})
