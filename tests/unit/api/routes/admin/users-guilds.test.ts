import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let GET: () => Promise<Response>

describe('GET /api/admin/users/guilds', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
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

    mockSupabase = {
      from: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/admin/users/guilds/route')
    GET = routeModule.GET
  })

  it('returns 403 when user is not admin', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: false }
    })

    const response = await GET()
    expect(response.status).toBe(403)
  })

  it('returns empty guilds array when no guilds', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        }
      }
      if (table === 'player_mapping') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({ data: [], error: null })
        }
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.guilds).toEqual([])
  })

  it('returns guilds with member counts', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({
            data: [
              {
                guild_code: 'GUILD1',
                display_name: 'Guild One',
                cluster_code: 'EOT'
              }
            ],
            error: null
          })
        }
      }
      if (table === 'player_mapping') {
        return {
          select: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          not: vi.fn().mockResolvedValue({
            data: [{ guild_code: 'GUILD1' }, { guild_code: 'GUILD1' }],
            error: null
          })
        }
      }
      return { select: vi.fn().mockReturnThis() }
    })

    const response = await GET()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.guilds).toHaveLength(1)
    expect(body.guilds[0].guild_code).toBe('GUILD1')
    expect(body.guilds[0].guild_name).toBe('Guild One')
  })

  it('returns 500 on database error', async () => {
    mockRequireAuth.mockResolvedValue({
      profile: { is_app_admin: true }
    })

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi
        .fn()
        .mockResolvedValue({ data: null, error: { message: 'DB error' } })
    })

    const response = await GET()
    expect(response.status).toBe(500)
  })
})
