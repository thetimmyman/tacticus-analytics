import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

let mockGetAuthUser: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('GET /api/wars/analytics/cores', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let mockSupabase: { rpc: ReturnType<typeof vi.fn> }

  beforeEach(async () => {
    vi.resetModules()
    mockGetAuthUser = vi.fn()
    mockCreateServiceClient = vi.fn()

    vi.doMock('@/app/lib/auth', () => ({
      AuthError,
      requireActiveMembershipForApi: mockGetAuthUser
    }))

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        warn: vi.fn(),
        info: vi.fn(),
        debug: vi.fn()
      }
    }))

    mockSupabase = { rpc: vi.fn() }
    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/wars/analytics/cores/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 401 when user is not authenticated', async () => {
    mockGetAuthUser.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/cores')
    )
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.message).toBe('Authentication required')
  })

  it('rejects inactive membership before querying analytics', async () => {
    mockGetAuthUser.mockRejectedValue(
      new AuthError('Current guild membership required', 'ONBOARDING_REQUIRED')
    )

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/cores')
    )

    expect(response.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('does not scope global cores to the user guild', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: null } })
    mockSupabase.rpc.mockImplementation(async (name: string) =>
      name === 'get_global_war_meta_filters'
        ? { data: { seasons: [26], battlefieldLevels: [5] }, error: null }
        : { data: [{ core_id: 'c1' }], error: null }
    )

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/cores')
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.cores).toEqual([{ core_id: 'c1' }])
    expect(JSON.stringify(mockSupabase.rpc.mock.calls)).not.toContain(
      'guild_code'
    )
  })

  it('returns 400 when side is invalid', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/cores?side=invalid')
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('side must be offense or defense')
  })

  it('rejects an invalid battlefield tier before querying the database', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })

    const response = await GET(
      new NextRequest(
        'http://localhost/api/wars/analytics/cores?battlefield_levels=6'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('between 1 and 5')
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it.each(['1', '6', '3.5', 'nope'])(
    'returns 400 when core_size is %s',
    async (coreSize) => {
      mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })

      const response = await GET(
        new NextRequest(
          `http://localhost/api/wars/analytics/cores?core_size=${coreSize}`
        )
      )
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain(
        'core_size must be an integer between 2 and 5'
      )
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    }
  )

  it('returns 500 when RPC fails', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    mockSupabase.rpc.mockImplementation(async (name: string) =>
      name === 'get_global_war_meta_filters'
        ? { data: { seasons: [], battlefieldLevels: [] }, error: null }
        : { data: null, error: { message: 'boom' } }
    )

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/cores')
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toContain('Failed to fetch core compositi')
  })

  it('returns cores data on success', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    mockSupabase.rpc.mockImplementation(async (name: string) =>
      name === 'get_global_war_meta_filters'
        ? {
            data: { seasons: [26, 25], battlefieldLevels: [5, 4] },
            error: null
          }
        : { data: [{ core_id: 'c1' }], error: null }
    )

    const response = await GET(
      new NextRequest(
        'http://localhost/api/wars/analytics/cores?side=defense&limit=5&season_count=2&min_uses=3&seasons=26&battlefield_levels=5&core_size=2'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'get_global_war_core_compositions',
      {
        p_side: 'defense',
        p_seasons: [26],
        p_battlefield_levels: [5],
        p_min_uses: 3,
        p_limit: 5,
        p_season_count: 2,
        p_core_size: 2
      }
    )
    expect(body.cores).toEqual([{ core_id: 'c1' }])
    expect(body.filters).toEqual({
      seasons: [26, 25],
      battlefieldLevels: [5, 4]
    })
  })

  it('requests three-hero cores by default', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: null } })
    mockSupabase.rpc.mockImplementation(async (name: string) =>
      name === 'get_global_war_meta_filters'
        ? { data: { seasons: [], battlefieldLevels: [] }, error: null }
        : { data: [], error: null }
    )

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/cores')
    )

    expect(response.status).toBe(200)
    expect(mockSupabase.rpc).toHaveBeenCalledWith(
      'get_global_war_core_compositions',
      expect.objectContaining({ p_core_size: 3 })
    )
  })
})
