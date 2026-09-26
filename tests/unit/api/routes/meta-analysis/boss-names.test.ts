import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateClient: ReturnType<typeof vi.fn>

type MockThenError = unknown
type MockThenReturn = unknown
type MockQueryArgs = unknown[]

const createNextRequest = (url: string) => {
  const urlObj = new URL(url)
  return {
    nextUrl: {
      searchParams: urlObj.searchParams
    }
  } as unknown as Request
}

describe('GET /api/meta-analysis/boss-names', () => {
  let GET: (request: Request) => Promise<Response>
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
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/meta-analysis/boss-names/route')
    GET = routeModule.GET
  })

  describe('validation', () => {
    it('returns 400 when season is missing', async () => {
      const request = createNextRequest(
        'http://localhost/api/meta-analysis/boss-names'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Season is required')
    })
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/boss-names?season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('profile validation', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 404 when profile not found', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/boss-names?season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error.message).toBe('User profile not found')
    })

    it('returns 403 when user has no guild or cluster', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: null, cluster_code: null },
          error: null
        })
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/boss-names?season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('User has no guild association.')
    })
  })

  describe('successful queries', () => {
    const mockBossData = [
      { rarity: 'Legendary', set: 0, Name: 'Hive Tyrant', encounterId: 0 },
      { rarity: 'Legendary', set: 0, Name: 'Side Boss 1', encounterId: 1 },
      { rarity: 'Legendary', set: 1, Name: 'Screamer Killer', encounterId: 0 }
    ]

    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns boss name map for guild user', async () => {
      const profileMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', cluster_code: null },
          error: null
        })
      }

      const createQueryMock = () => {
        const result = { data: mockBossData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_with_cluster') {
          return profileMock
        }
        return createQueryMock()
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/boss-names?season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body['Legendary-0']).toBe('Hive Tyrant')
      expect(body['Legendary-0-side1']).toBe('Side Boss 1')
      expect(body['Legendary-1']).toBe('Screamer Killer')
    })

    it('filters by cluster when user has cluster', async () => {
      const profileMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', cluster_code: 'EOT' },
          error: null
        })
      }

      const eqTracker = vi.fn()
      const createQueryMock = () => {
        const result = { data: mockBossData, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockImplementation((...args: MockQueryArgs) => {
          eqTracker(...args)
          return chainable
        })
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_with_cluster') {
          return profileMock
        }
        return createQueryMock()
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/boss-names?season=45'
      )

      await GET(request)

      expect(eqTracker).toHaveBeenCalledWith('cluster_code', 'EOT')
    })

    it('accepts rarity parameter', async () => {
      const profileMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', cluster_code: null },
          error: null
        })
      }

      const inTracker = vi.fn()
      const createQueryMock = () => {
        const result = { data: [], error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockImplementation((...args: MockQueryArgs) => {
          inTracker(...args)
          return chainable
        })
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_with_cluster') {
          return profileMock
        }
        return createQueryMock()
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/boss-names?season=45&rarity=Mythic'
      )

      await GET(request)

      expect(inTracker).toHaveBeenCalledWith('rarity', ['Mythic'])
    })

    it('returns empty map when no bosses found', async () => {
      const profileMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', cluster_code: null },
          error: null
        })
      }

      const createQueryMock = () => {
        const result = { data: [], error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_with_cluster') {
          return profileMock
        }
        return createQueryMock()
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/boss-names?season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({})
    })
  })

  describe('single-pass stages', () => {
    const runWithRows = async (
      rows: Array<Record<string, unknown>>
    ): Promise<{ body: Record<string, string>; singlePass: string | null }> => {
      const profileMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', cluster_code: null },
          error: null
        })
      }

      const createQueryMock = () => {
        const result = { data: rows, error: null }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => Promise.resolve(result).then(onFulfilled, onRejected)
        return chainable
      }

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockImplementation((table: string) =>
        table === 'player_with_cluster' ? profileMock : createQueryMock()
      )

      const response = await GET(
        createNextRequest(
          'http://localhost/api/meta-analysis/boss-names?season=45'
        )
      )
      expect(response.status).toBe(200)
      return {
        body: (await response.json()) as Record<string, string>,
        singlePass: response.headers.get('X-Single-Pass-Stages')
      }
    }

    const row = (
      rarity: string,
      set: number,
      Name: string,
      loopIndex: number
    ) => ({ rarity, set, Name, encounterId: 0, loopIndex, Guild: 'TEST' })

    it('reports the single-pass stages WITHOUT dropping them from the map', async () => {
      // The client hides these behind a default-off pill, so they must survive.
      const { body, singlePass } = await runWithRows([
        row('Legendary', 0, 'Hive Tyrant', 0),
        row('Legendary', 2, 'Screamer Killer', 0),
        row('Legendary', 3, 'Rogal Dorn', 1),
        row('Mythic', 0, 'Riptide', 1)
      ])

      expect(singlePass).toBe('L1,L3')
      expect(body['Legendary-0']).toBe('Hive Tyrant')
      expect(body['Legendary-2']).toBe('Screamer Killer')
      expect(body['Legendary-3']).toBe('Rogal Dorn')
      expect(body['Mythic-0']).toBe('Riptide')
    })

    it('reports nothing while the guild is still on its first pass', async () => {
      const { body, singlePass } = await runWithRows([
        row('Legendary', 0, 'Hive Tyrant', 0),
        row('Legendary', 3, 'Rogal Dorn', 0),
        row('Mythic', 2, 'Magnus', 0)
      ])

      expect(singlePass).toBe('')
      expect(body['Legendary-0']).toBe('Hive Tyrant')
      expect(body['Legendary-3']).toBe('Rogal Dorn')
      expect(body['Mythic-2']).toBe('Magnus')
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 500 when query fails', async () => {
      const profileMock = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', cluster_code: null },
          error: null
        })
      }

      const createQueryMock = () => {
        const result = { data: null, error: { message: 'Query failed' } }
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.in = vi.fn().mockReturnValue(chainable)
        chainable.not = vi.fn().mockReturnValue(chainable)
        chainable.order = vi.fn().mockReturnValue(chainable)
        chainable.then = (
          onFulfilled?: (value: typeof result) => MockThenReturn,
          onRejected?: (reason: MockThenError) => MockThenReturn
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_with_cluster') {
          return profileMock
        }
        return createQueryMock()
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/boss-names?season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to fetch boss names')
    })

    it('returns 500 when exception is thrown', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = createNextRequest(
        'http://localhost/api/meta-analysis/boss-names?season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to fetch boss names')
    })
  })
})
