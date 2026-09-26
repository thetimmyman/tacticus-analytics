import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockRequireAuthForApi: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockLoggerError: ReturnType<typeof vi.fn>
let mockAppCacheGet: ReturnType<typeof vi.fn>
let mockAppCacheSet: ReturnType<typeof vi.fn>
let mockApiGetOrFetch: ReturnType<typeof vi.fn>
let mockSupabase: {
  from: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
}

function primeEmptySupabase() {
  mockSupabase.from.mockImplementation((table: string) => {
    if (table === 'EOT_GR_data') {
      const limitMock = vi.fn().mockResolvedValue({ data: [], error: null })
      const orderMock = vi.fn().mockReturnValue({ limit: limitMock })
      const eqDamageTypeMock = vi.fn().mockReturnValue({ order: orderMock })
      const eqGuildMock = vi.fn().mockReturnValue({ eq: eqDamageTypeMock })
      return { select: vi.fn().mockReturnValue({ eq: eqGuildMock }) }
    }
    if (table === 'player_mapping') {
      const eqMock = vi.fn()
      const builder = { eq: eqMock }
      eqMock
        .mockReturnValueOnce(builder)
        .mockResolvedValueOnce({ data: [], error: null })
      return { select: vi.fn().mockReturnValue(builder) }
    }
    return { select: vi.fn() }
  })
  mockSupabase.rpc.mockResolvedValue({ data: [], error: null })
}

// Optional env lets a test set a rollback gate BEFORE the module's top-level gate const is read.
async function loadRoute(): Promise<() => Promise<Response>> {
  vi.doMock('@/app/lib/auth', () => ({
    requireRoleForApi: mockRequireAuthForApi,
    AuthError: class AuthError extends Error {
      code: string
      constructor(code: string, message: string) {
        super(message)
        this.code = code
      }
    }
  }))

  vi.doMock('@/app/lib/db', () => ({
    serviceDb: mockCreateServiceClient
  }))

  vi.doMock('@/app/lib/logging', async (importOriginal) => {
    const actual = await importOriginal<typeof import('@/app/lib/logging')>()
    return {
      ...actual,
      createComponentLogger: vi.fn(() => ({
        error: mockLoggerError,
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
      }))
    }
  })

  vi.doMock('@tacticus/app-core/unified-cache', () => ({
    apiCache: {
      getOrFetch: mockApiGetOrFetch,
      invalidate: vi.fn()
    }
  }))

  vi.doMock('@tacticus/app-core/app-cache', () => ({
    appCache: {
      get: mockAppCacheGet,
      set: mockAppCacheSet,
      del: vi.fn().mockResolvedValue(undefined)
    }
  }))

  const routeModule = await import('@/app/api/upcoming/enhanced-data/route')
  return routeModule.GET
}

describe('GET /api/upcoming/enhanced-data', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.unstubAllEnvs()
    mockRequireAuthForApi = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockLoggerError = vi.fn()
    mockAppCacheGet = vi.fn().mockResolvedValue(null)
    mockAppCacheSet = vi.fn().mockResolvedValue(undefined)
    mockApiGetOrFetch = vi.fn(
      async (_key: string, fetcher: () => Promise<unknown>) => fetcher()
    )

    mockSupabase = { from: vi.fn(), rpc: vi.fn() }
    mockCreateServiceClient.mockReturnValue(mockSupabase)
  })

  it('returns 403 when role is not officer or leader', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      profile: { role: 'member', guild_code: 'ABC' }
    })

    const GET = await loadRoute()
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Access denied')
  })

  // SQL compares `lower(pm.role)`, so requireRoleForApi admits 'Officer'; the handler's own re-check
  // must be case-insensitive too.
  it.each(['Officer', 'Leader'])(
    'serves a caller whose stored role is %s',
    async (role) => {
      mockRequireAuthForApi.mockResolvedValue({
        profile: { role, guild_code: 'ABC' }
      })
      primeEmptySupabase()

      const GET = await loadRoute()
      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    }
  )

  it('still returns 403 for a mixed-case Member', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      profile: { role: 'Member', guild_code: 'ABC' }
    })

    const GET = await loadRoute()
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Access denied')
  })

  it('returns 403 when guild code is missing', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      profile: { role: 'leader', guild_code: null }
    })

    const GET = await loadRoute()
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('No guild code available')
  })

  it('computes reliability per-encounter from EOT_GR_data and remaps display names', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      profile: { role: 'officer', guild_code: 'ABC' }
    })

    const battleRows = [
      {
        userId: 'player-1',
        displayName: 'OldName',
        damageDealt: '0',
        encounterId: 'enc-a'
      },
      {
        userId: 'player-1',
        displayName: 'OldName',
        damageDealt: '1000',
        encounterId: 'enc-a'
      },
      {
        userId: 'player-1',
        displayName: 'OldName',
        damageDealt: '0',
        encounterId: 'enc-b'
      },
      {
        userId: 'player-1',
        displayName: 'OldName',
        damageDealt: 2500,
        encounterId: 'enc-c'
      },
      {
        userId: 'player-2',
        displayName: 'OrphanLegacy',
        damageDealt: '5000',
        encounterId: 'enc-d'
      },
      {
        userId: null,
        displayName: 'Legacy',
        damageDealt: 500,
        encounterId: 'enc-e'
      },
      {
        userId: null,
        displayName: 'Legacy',
        damageDealt: 0,
        encounterId: 'enc-f'
      }
    ]
    const metaTeamData = [
      {
        player_id: 'player-1',
        display_name: 'NewName',
        primary_team: 'Alpha',
        secondary_team: 'Bravo',
        tertiary_team: 'Charlie'
      }
    ]
    const teamCompositionData = [{ boss_id: 'boss-1' }]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'EOT_GR_data') {
        const limitMock = vi
          .fn()
          .mockResolvedValue({ data: battleRows, error: null })
        const orderMock = vi.fn().mockReturnValue({ limit: limitMock })
        const eqDamageTypeMock = vi.fn().mockReturnValue({ order: orderMock })
        const eqGuildMock = vi.fn().mockReturnValue({ eq: eqDamageTypeMock })
        return {
          select: vi.fn().mockReturnValue({ eq: eqGuildMock })
        }
      }
      if (table === 'player_mapping') {
        const eqMock = vi.fn()
        const builder = { eq: eqMock }
        eqMock.mockReturnValueOnce(builder).mockResolvedValueOnce({
          data: metaTeamData,
          error: null
        })
        return {
          select: vi.fn().mockReturnValue(builder)
        }
      }
      return { select: vi.fn() }
    })

    mockSupabase.rpc.mockResolvedValue({
      data: teamCompositionData,
      error: null
    })

    const GET = await loadRoute()
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.reliability.NewName).toBeCloseTo((2 / 3) * 100, 5)
    expect(body.reliability.OrphanLegacy).toBe(100)
    expect(body.reliability.Legacy).toBe(50)
    expect(body.reliability.OldName).toBeUndefined()
    expect(body.metaTeams).toEqual({
      NewName: {
        primary: 'Alpha',
        secondary: 'Bravo',
        tertiary: 'Charlie'
      }
    })
    expect(body.teamCompositions).toEqual(teamCompositionData)
  })

  it('logs reliability errors, responds successfully, but does NOT cache the degraded payload', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      profile: { role: 'leader', guild_code: 'ABC' }
    })
    mockAppCacheGet.mockResolvedValue(null) // force a miss so the build runs

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'EOT_GR_data') {
        const limitMock = vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Reliability failed' }
        })
        const orderMock = vi.fn().mockReturnValue({ limit: limitMock })
        const eqDamageTypeMock = vi.fn().mockReturnValue({ order: orderMock })
        const eqGuildMock = vi.fn().mockReturnValue({ eq: eqDamageTypeMock })
        return {
          select: vi.fn().mockReturnValue({ eq: eqGuildMock })
        }
      }
      if (table === 'player_mapping') {
        const eqMock = vi.fn()
        const builder = { eq: eqMock }
        eqMock.mockReturnValueOnce(builder).mockResolvedValueOnce({
          data: [],
          error: null
        })
        return {
          select: vi.fn().mockReturnValue(builder)
        }
      }
      return { select: vi.fn() }
    })

    mockSupabase.rpc.mockResolvedValue({
      data: [],
      error: null
    })

    const GET = await loadRoute()
    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockLoggerError).toHaveBeenCalledWith(
      expect.objectContaining({ err: expect.anything() }),
      'Error fetching reliability scores:'
    )
    // A degraded payload in the shared cache would pin a transient failure for the full TTL.
    expect(mockAppCacheSet).not.toHaveBeenCalled()
  })

  it('serves from appCache on a hit without querying the DB', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      profile: { role: 'officer', guild_code: 'ABC' }
    })
    const cachedPayload = {
      reliability: { Alice: 90 },
      metaTeams: {},
      teamCompositions: [],
      success: true
    }
    mockAppCacheGet.mockResolvedValue(cachedPayload)

    const GET = await loadRoute()
    const response = await GET()
    const body = await response.json()

    expect(mockAppCacheGet).toHaveBeenCalledWith('enhanced_data:ABC')
    expect(response.status).toBe(200)
    expect(body).toEqual(cachedPayload)
    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(mockAppCacheSet).not.toHaveBeenCalled()
  })

  it('writes the computed payload back to appCache with a 600s TTL on a miss', async () => {
    mockRequireAuthForApi.mockResolvedValue({
      profile: { role: 'officer', guild_code: 'ABC' }
    })
    mockAppCacheGet.mockResolvedValue(null)
    primeEmptySupabase()

    const GET = await loadRoute()
    const response = await GET()

    expect(response.status).toBe(200)
    expect(mockAppCacheSet).toHaveBeenCalledWith(
      'enhanced_data:ABC',
      expect.objectContaining({ success: true }),
      10 * 60
    )
  })

  it('rolls back to the apiCache path when WI6060_ENHANCED_DATA_BACKEND=apiCache', async () => {
    vi.stubEnv('WI6060_ENHANCED_DATA_BACKEND', 'apiCache')
    mockRequireAuthForApi.mockResolvedValue({
      profile: { role: 'officer', guild_code: 'ABC' }
    })
    primeEmptySupabase()

    const GET = await loadRoute()
    const response = await GET()

    expect(response.status).toBe(200)
    expect(mockApiGetOrFetch).toHaveBeenCalledWith(
      'enhanced_data:ABC',
      expect.any(Function),
      expect.objectContaining({ ttl: 10 * 60 * 1000 })
    )
    expect(mockAppCacheGet).not.toHaveBeenCalled()
  })
})
