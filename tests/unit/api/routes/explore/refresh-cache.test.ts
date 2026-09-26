import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireRoleForApi: ReturnType<typeof vi.fn>
let mockAppCacheDel: ReturnType<typeof vi.fn>
let AuthError: typeof import('@/app/lib/auth').AuthError

describe('POST /api/explore/refresh-cache', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()
    mockRequireRoleForApi = vi.fn()
    mockAppCacheDel = vi.fn().mockResolvedValue(undefined)

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireRoleForApi: mockRequireRoleForApi
      }
    })
    const authModule = await import('@/app/lib/auth')
    AuthError = authModule.AuthError

    vi.doMock('@tacticus/app-core/app-cache', () => ({
      appCache: { del: mockAppCacheDel }
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      }
    }))

    const routeModule = await import('@/app/api/explore/refresh-cache/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createRequest = (body: object) =>
    new NextRequest('http://localhost/api/explore/refresh-cache', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

  it('returns 401 for unauthenticated requests', async () => {
    mockRequireRoleForApi.mockRejectedValue(
      new AuthError('Authentication required', 'UNAUTHENTICATED')
    )

    const response = await POST(createRequest({ guild_code: 'EOT' }))
    const body = await response.json()

    expect(response.status).toBe(401)
    expect(body.error.code).toBe(1001)
  })

  it('returns 403 for insufficient role', async () => {
    mockRequireRoleForApi.mockRejectedValue(
      new AuthError('Access denied', 'INSUFFICIENT_ROLE')
    )

    const response = await POST(createRequest({ guild_code: 'EOT' }))
    expect(response.status).toBe(403)
  })

  it('returns 400 when guild code is missing', async () => {
    mockRequireRoleForApi.mockResolvedValue({
      profile: { guild_code: 'EOT', display_name: 'Leader' }
    })

    const response = await POST(createRequest({}))
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('Guild code is required')
  })

  it('returns 403 when guild code does not match profile', async () => {
    mockRequireRoleForApi.mockResolvedValue({
      profile: { guild_code: 'EOT', display_name: 'Leader' }
    })

    const response = await POST(createRequest({ guild_code: 'OTHER' }))
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toContain('Insufficient permissions for t')
  })

  it('clears cache keys for matching guild', async () => {
    mockRequireRoleForApi.mockResolvedValue({
      profile: { guild_code: 'EOT', display_name: 'Leader' }
    })

    const response = await POST(createRequest({ guild_code: 'EOT' }))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.cache_stats.total_attempted).toBe(21)
    expect(mockRequireRoleForApi).toHaveBeenCalledWith('officer')
    expect(mockAppCacheDel).toHaveBeenCalledWith('explore:guild:EOT')
    expect(mockAppCacheDel).toHaveBeenCalledTimes(21)
  })
})
