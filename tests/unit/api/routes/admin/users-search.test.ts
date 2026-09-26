import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let GET: (request: NextRequest) => Promise<Response>

describe('GET /api/admin/users/search', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    auth: { admin: { getUserById: ReturnType<typeof vi.fn> } }
  }

  beforeEach(async () => {
    vi.resetModules()

    mockRequireAuth = vi.fn()
    mockCreateServiceClient = vi.fn()

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireAuth: mockRequireAuth,
        requireAuthForApi: mockRequireAuth,
        requireActiveMembershipForApi: mockRequireAuth
      }
    })

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    }))

    mockSupabase = {
      from: vi.fn(),
      auth: {
        admin: {
          getUserById: vi.fn().mockResolvedValue({
            data: { user: null },
            error: null
          })
        }
      }
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/admin/users/search/route')
    GET = routeModule.GET
  })

  it('returns 403 when user is not admin', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: false }
    })

    const request = new NextRequest('http://localhost/api/admin/users/search')
    const response = await GET(request)

    expect(response.status).toBe(403)
  })

  it('returns empty results when no users found', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 })
    })

    const request = new NextRequest('http://localhost/api/admin/users/search')
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.users).toEqual([])
    expect(body.total).toBe(0)
  })

  it('searches users by query parameter', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const orMock = vi.fn().mockReturnThis()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: orMock,
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({
            data: [
              {
                user_id: 'user-1',
                display_name: 'TestUser',
                guild_code: 'GUILD1'
              }
            ],
            error: null,
            count: 1
          })
        }
      }
      if (table === 'auth_user_emails') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockResolvedValue({
            data: [{ user_id: 'user-1', email: 'test@example.com' }],
            error: null
          })
        }
      }
      if (table === 'feature_access_grants') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: [], error: null })
        }
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const request = new NextRequest(
      'http://localhost/api/admin/users/search?q=test'
    )
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(orMock).toHaveBeenCalled()
    expect(body.users).toHaveLength(1)
  })

  it('filters by guild_code', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const eqMock = vi.fn().mockReturnThis()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: eqMock,
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 })
        }
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const request = new NextRequest(
      'http://localhost/api/admin/users/search?guild_code=GUILD1'
    )
    await GET(request)

    expect(eqMock).toHaveBeenCalledWith('guild_code', 'GUILD1')
  })

  it('filters by has_account=true', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const notMock = vi.fn().mockReturnThis()

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: notMock,
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 })
        }
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const request = new NextRequest(
      'http://localhost/api/admin/users/search?has_account=true'
    )
    await GET(request)

    expect(notMock).toHaveBeenCalledWith('user_id', 'is', null)
  })

  it('respects limit parameter with max of 100', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    const rangeMock = vi
      .fn()
      .mockResolvedValue({ data: [], error: null, count: 0 })

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: rangeMock
    })

    const request = new NextRequest(
      'http://localhost/api/admin/users/search?limit=200'
    )
    await GET(request)

    expect(rangeMock).toHaveBeenCalledWith(0, 99)
  })

  it('returns 500 on database error', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockReturnThis(),
      range: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'DB error' } })
    })

    const request = new NextRequest('http://localhost/api/admin/users/search')
    const response = await GET(request)

    expect(response.status).toBe(500)
  })

  it('falls back to auth_user_emails when no player_mapping results', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          or: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 })
        }
      }
      if (table === 'auth_user_emails') {
        return {
          select: vi.fn().mockReturnThis(),
          ilike: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({
            data: [{ user_id: 'auth-user-1', email: 'test@example.com' }],
            error: null
          })
        }
      }
      return { select: vi.fn().mockReturnThis() }
    })
    mockSupabase.auth.admin.getUserById.mockResolvedValue({
      data: {
        user: {
          id: 'auth-user-1',
          identities: [
            {
              provider: 'discord',
              identity_data: {
                provider_id: '123456789012345678',
                name: 'auth-only#0'
              }
            }
          ]
        }
      },
      error: null
    })

    const request = new NextRequest(
      'http://localhost/api/admin/users/search?q=test@example.com'
    )
    const response = await GET(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.users[0].source).toBe('auth_only')
    expect(body.users[0].discord_user_id).toBe('123456789012345678')
    expect(body.users[0].discord_username).toBe('auth-only')
  })
})
