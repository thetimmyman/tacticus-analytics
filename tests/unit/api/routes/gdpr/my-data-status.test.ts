import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>

type RouteHandler = (
  req: NextRequest,
  ctx: { params: Promise<{ requestId: string }> }
) => Promise<Response>

describe('GET /api/gdpr/my-data/[requestId]', () => {
  let GET: RouteHandler
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  const VALID_UUID = '11111111-2222-3333-4444-555555555555'

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockApiSecurityMiddleware = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))
    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
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
    mockApiSecurityMiddleware.mockResolvedValue(null)

    const mod = await import('@/app/api/gdpr/my-data/[requestId]/route')
    GET = mod.GET as RouteHandler
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createRequest = () =>
    new NextRequest(`http://localhost/api/gdpr/my-data/${VALID_UUID}`)

  const mockSelectChain = (data: unknown, error: unknown = null) => {
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data, error })
          })
        })
      })
    })
  }

  it('returns 401 when unauthenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'no' }
    })
    const response = await GET(createRequest(), {
      params: Promise.resolve({ requestId: VALID_UUID })
    })
    expect(response.status).toBe(401)
  })

  it('returns 400 on invalid UUID', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    const response = await GET(
      new NextRequest('http://localhost/api/gdpr/my-data/not-a-uuid'),
      { params: Promise.resolve({ requestId: 'not-a-uuid' }) }
    )
    expect(response.status).toBe(400)
  })

  it('returns 404 when request does not exist for this user', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSelectChain(null, { message: 'not found' })
    const response = await GET(createRequest(), {
      params: Promise.resolve({ requestId: VALID_UUID })
    })
    expect(response.status).toBe(404)
  })

  it('returns pending status without download URL', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSelectChain({
      request_id: VALID_UUID,
      status: 'processing',
      requested_at: '2026-04-16T00:00:00Z',
      completed_at: null,
      download_url: null,
      expires_at: null
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ requestId: VALID_UUID })
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('processing')
    expect(body.downloadUrl).toBeNull()
  })

  it('returns download URL when completed', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockSelectChain({
      request_id: VALID_UUID,
      status: 'completed',
      requested_at: '2026-04-16T00:00:00Z',
      completed_at: '2026-04-16T00:05:00Z',
      download_url: 'https://signed.example/download',
      expires_at: '2026-04-23T00:05:00Z'
    })

    const response = await GET(createRequest(), {
      params: Promise.resolve({ requestId: VALID_UUID })
    })
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('completed')
    expect(body.downloadUrl).toBe('https://signed.example/download')
  })
})
