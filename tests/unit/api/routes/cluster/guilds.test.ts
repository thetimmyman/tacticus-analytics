import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Serves guild_config."API_Owner" with RLS bypassed, so the cluster-scope check is the only guard.
 * An 'admin' role string comes from client-writable user_metadata; the gate must use is_app_admin.
 */

function createRequest(cluster?: string): NextRequest {
  const url = cluster
    ? `http://localhost/api/cluster/guilds?cluster=${cluster}`
    : 'http://localhost/api/cluster/guilds'
  return new NextRequest(url, { method: 'GET' })
}

describe('GET /api/cluster/guilds — cluster scoping (WI-4450)', () => {
  let GET: (req: NextRequest) => Promise<Response>
  let mockRequireRoleForApi: ReturnType<typeof vi.fn>
  let mockOrder: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    mockRequireRoleForApi = vi.fn()
    mockOrder = vi.fn().mockResolvedValue({
      data: [{ guild_code: 'AAA', API_Owner: 'owner@example.com' }],
      error: null
    })

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      }
    }))
    vi.doMock('@/app/lib/logging', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/logging')>(
          '@/app/lib/logging'
        )
      return {
        ...actual,
        createComponentLogger: () => ({
          info: vi.fn(),
          error: vi.fn(),
          warn: vi.fn(),
          debug: vi.fn()
        })
      }
    })
    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return { ...actual, requireRoleForApi: mockRequireRoleForApi }
    })
    vi.doMock('@/app/lib/db', () => ({
      serviceDb: () => ({
        from: () => ({
          select: () => ({
            eq: () => ({ not: () => ({ order: mockOrder }) })
          })
        })
      })
    }))
    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: { getBasic: vi.fn().mockResolvedValue(null) }
    }))

    const routeModule = await import('@/app/api/cluster/guilds/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('serves the caller their own cluster', async () => {
    mockRequireRoleForApi.mockResolvedValue({
      user: { id: 'u1', role: 'leader' },
      profile: { cluster_code: 'EOT', guild_code: 'AAA', is_app_admin: false }
    })

    const response = await GET(createRequest('EOT'))

    expect(response.status).toBe(200)
    expect(mockOrder).toHaveBeenCalled()
  })

  it('refuses a foreign cluster for a non-admin leader', async () => {
    mockRequireRoleForApi.mockResolvedValue({
      user: { id: 'u1', role: 'leader' },
      profile: { cluster_code: 'EOT', guild_code: 'AAA', is_app_admin: false }
    })

    const response = await GET(createRequest('VAE'))

    expect(response.status).toBe(403)
    expect(mockOrder).not.toHaveBeenCalled()
  })

  it('refuses a foreign cluster when role is SPOOFED to admin via user_metadata', async () => {
    // inferRole() can fall through to client-controlled user_metadata.role.
    mockRequireRoleForApi.mockResolvedValue({
      user: { id: 'u1', role: 'admin' },
      profile: { cluster_code: 'EOT', guild_code: 'AAA', is_app_admin: false }
    })

    const response = await GET(createRequest('VAE'))

    expect(response.status).toBe(403)
    expect(mockOrder).not.toHaveBeenCalled()
  })

  it('allows a genuine app admin to read another cluster', async () => {
    mockRequireRoleForApi.mockResolvedValue({
      user: { id: 'u1', role: 'leader' },
      profile: { cluster_code: 'EOT', guild_code: 'AAA', is_app_admin: true }
    })

    const response = await GET(createRequest('VAE'))

    expect(response.status).toBe(200)
    expect(mockOrder).toHaveBeenCalled()
  })

  it('refuses a clusterless caller who supplies a cluster', async () => {
    mockRequireRoleForApi.mockResolvedValue({
      user: { id: 'u1', role: 'leader' },
      profile: { cluster_code: null, guild_code: null, is_app_admin: false }
    })

    const response = await GET(createRequest('EOT'))

    expect(response.status).toBe(403)
    expect(mockOrder).not.toHaveBeenCalled()
  })

  it('400s a clusterless caller who supplies no cluster', async () => {
    mockRequireRoleForApi.mockResolvedValue({
      user: { id: 'u1', role: 'leader' },
      profile: { cluster_code: null, guild_code: null, is_app_admin: false }
    })

    const response = await GET(createRequest())

    expect(response.status).toBe(400)
    expect(mockOrder).not.toHaveBeenCalled()
  })
})
