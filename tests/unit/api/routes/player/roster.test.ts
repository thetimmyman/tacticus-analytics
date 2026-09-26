import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockGetPlayerApiKey: ReturnType<typeof vi.fn>
let mockTacticusAPI: {
  getPlayer: ReturnType<typeof vi.fn>
  getPlayerWithRetry: ReturnType<typeof vi.fn>
}
let mockGetUnitCatalog: ReturnType<typeof vi.fn>
let mockPersistRosterSnapshot: ReturnType<typeof vi.fn>

describe('GET /api/player/roster', () => {
  let GET: () => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockGetPlayerApiKey = vi.fn()
    // The retry+breaker variant absorbs a transient outbound-DNS burst instead of 502ing.
    mockTacticusAPI = { getPlayer: vi.fn(), getPlayerWithRetry: vi.fn() }
    mockGetUnitCatalog = vi.fn()
    mockPersistRosterSnapshot = vi
      .fn()
      .mockResolvedValue({ upserted: 0, playerPowerUpdated: false })

    vi.doMock('next/server', async () => {
      const actual =
        await vi.importActual<typeof import('next/server')>('next/server')
      return {
        ...actual,
        after: vi.fn((callback: () => unknown) => callback())
      }
    })

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      // tacticus_api_key_encrypted is not granted to `authenticated`, so reads use serviceDb().
      createServiceClient: () => mockSupabase
    }))

    vi.doMock('@tacticus/app-core/api-key-helper', () => ({
      getPlayerApiKey: mockGetPlayerApiKey
    }))

    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: mockTacticusAPI,
      resolveMachinesOfWar: (player: {
        machinesOfWar?: Record<string, unknown>[]
        machines_of_war?: Record<string, unknown>[]
      }) => player.machinesOfWar ?? player.machines_of_war ?? []
    }))

    vi.doMock('@/app/lib/player/unit-catalog', () => ({
      getUnitCatalog: mockGetUnitCatalog
    }))

    vi.doMock('@/app/lib/player/roster-sync', () => ({
      persistRosterSnapshot: mockPersistRosterSnapshot
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

    const routeModule = await import('@/app/api/player/roster/route')
    GET = routeModule.GET
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })

    it('returns 401 when auth errors', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Auth error' }
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('API key handling', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 400 when player has no API key', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { tacticus_api_key_encrypted: null },
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001)
    })

    it('returns 500 when API key decryption fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 123, tacticus_api_key_encrypted: 'encrypted-key' },
          error: null
        })
      })
      mockGetPlayerApiKey.mockResolvedValue(null)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.code).toBe(5001)
    })

    it('returns 502 when Tacticus API fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { tacticus_api_key_encrypted: 'encrypted-key' },
          error: null
        })
      })
      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.getPlayerWithRetry.mockResolvedValue(null)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(502)
      expect(body.error.code).toBe(4001)
    })
  })

  describe('successful roster fetch', () => {
    const mockPlayerData = {
      details: { name: 'TestPlayer', powerLevel: 100000 },
      units: [
        { id: 'hero-1', name: 'Hero 1', level: 50 },
        { id: 'hero-2', name: 'Hero 2', level: 40 }
      ],
      machinesOfWar: [{ id: 'mow-1', name: 'Machine 1' }],
      progress: { campaign: 75 }
    }

    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { tacticus_api_key_encrypted: 'encrypted-key' },
          error: null
        })
      })
      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.getPlayerWithRetry.mockResolvedValue(mockPlayerData)
    })

    it('returns player roster without catalog enrichment', async () => {
      mockGetUnitCatalog.mockRejectedValue(new Error('Catalog not available'))

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.playerName).toBe('TestPlayer')
      expect(body.powerLevel).toBe(100000)
      expect(body.units).toEqual(mockPlayerData.units)
      expect(body.progress).toEqual({ campaign: 75 })
      expect(mockPersistRosterSnapshot).toHaveBeenCalledWith(
        'user-123',
        mockPlayerData.units,
        mockPlayerData.machinesOfWar,
        mockSupabase,
        undefined,
        { playerPower: 100000 }
      )
    })

    it('returns enriched roster when catalog available', async () => {
      const mockCatalog = {
        heroes: new Set(['hero-1', 'hero-2']),
        mows: new Set(['mow-1']),
        aliases: new Map()
      }
      mockGetUnitCatalog.mockResolvedValue(mockCatalog)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.units).toBeDefined()
      expect(body.units[0]).toHaveProperty('engineId')
      expect(body.units[0]).toHaveProperty('category')
    })

    it('merges machines of war from multiple sources', async () => {
      const mockCatalog = {
        heroes: new Set(['hero-1']),
        mows: new Set(['mow-1', 'mow-2']),
        aliases: new Map()
      }
      mockGetUnitCatalog.mockResolvedValue(mockCatalog)

      const playerWithMows = {
        ...mockPlayerData,
        machinesOfWar: [{ id: 'mow-1' }],
        units: [{ id: 'hero-1' }, { id: 'mow-2' }]
      }
      mockTacticusAPI.getPlayerWithRetry.mockResolvedValue(playerWithMows)

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.machinesOfWar).toBeDefined()
    })

    it('handles player with no units', async () => {
      mockGetUnitCatalog.mockRejectedValue(new Error('Catalog not available'))
      mockTacticusAPI.getPlayerWithRetry.mockResolvedValue({
        details: { name: 'NewPlayer', powerLevel: 1000 },
        units: [],
        progress: {}
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.units).toEqual([])
    })

    it('handles alternative machinesOfWar property names', async () => {
      mockGetUnitCatalog.mockRejectedValue(new Error('Catalog not available'))
      mockTacticusAPI.getPlayerWithRetry.mockResolvedValue({
        details: { name: 'TestPlayer', powerLevel: 50000 },
        units: [],
        machines_of_war: [{ id: 'mow-1' }],
        progress: {}
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.machinesOfWar).toBeDefined()
    })
  })

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Unexpected error'))

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('An unexpected error occurred')
    })

    it('returns 400 when profile not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      })

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001)
    })
  })
})
