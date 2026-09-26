import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

let mockGetAuthUser: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('GET /api/wars/analytics/performance', () => {
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

    const routeModule =
      await import('@/app/api/wars/analytics/performance/route')
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
      new NextRequest('http://localhost/api/wars/analytics/performance')
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
      new NextRequest('http://localhost/api/wars/analytics/performance')
    )

    expect(response.status).toBe(403)
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
    expect(mockSupabase.rpc).not.toHaveBeenCalled()
  })

  it('returns 400 when user has no guild code', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: null } })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/performance')
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('No guild associated with user')
  })

  it('returns 400 when side is invalid', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })

    const response = await GET(
      new NextRequest(
        'http://localhost/api/wars/analytics/performance?side=invalid'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('side must be offense or defense')
  })

  it('returns 500 when RPC fails', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    mockSupabase.rpc.mockResolvedValue({
      data: null,
      error: { message: 'boom' }
    })

    const response = await GET(
      new NextRequest('http://localhost/api/wars/analytics/performance')
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toContain('Failed to fetch hero performan')
  })

  it('returns performance data on success', async () => {
    mockGetAuthUser.mockResolvedValue({ profile: { guild_code: 'ABC' } })
    mockSupabase.rpc.mockResolvedValue({
      data: [{ hero_id: 'h1' }],
      error: null
    })

    const response = await GET(
      new NextRequest(
        'http://localhost/api/wars/analytics/performance?side=defense&limit=25&season_count=3'
      )
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(mockSupabase.rpc).toHaveBeenCalledWith('get_hero_performance', {
      p_guild_code: 'ABC',
      p_side: 'defense',
      p_limit: 25,
      p_season_count: 3
    })
    expect(body.heroes).toEqual([{ hero_id: 'h1' }])
  })
})
