import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>
let mockHandleDataAccessRequest: ReturnType<typeof vi.fn>

describe('POST /api/gdpr/my-data', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockApiSecurityMiddleware = vi.fn()
    mockHandleDataAccessRequest = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))
    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))
    vi.doMock('@/app/lib/compliance/gdpr-manager', () => ({
      gdprManager: {
        handleDataAccessRequest: mockHandleDataAccessRequest
      }
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockSupabase = { auth: { getUser: vi.fn() } }
    mockCreateClient.mockResolvedValue(mockSupabase)
    mockApiSecurityMiddleware.mockResolvedValue(null)

    const mod = await import('@/app/api/gdpr/my-data/route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createRequest = () =>
    new NextRequest('http://localhost/api/gdpr/my-data', { method: 'POST' })

  it('returns 401 when unauthenticated', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'no' }
    })
    const response = await POST(createRequest())
    expect(response.status).toBe(401)
  })

  it('returns rate-limit response when middleware blocks', async () => {
    mockApiSecurityMiddleware.mockResolvedValue(
      new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
    )
    const response = await POST(createRequest())
    expect(response.status).toBe(429)
  })

  it('creates export request and returns request ID on happy path', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockHandleDataAccessRequest.mockResolvedValue({
      request_id: 'req-abc',
      status: 'pending',
      requested_at: '2026-04-16T00:00:00Z'
    })

    const response = await POST(createRequest())
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body).toEqual({
      success: true,
      requestId: 'req-abc',
      status: 'pending',
      requestedAt: '2026-04-16T00:00:00Z'
    })
    expect(mockHandleDataAccessRequest).toHaveBeenCalledWith('user-1')
  })

  it('returns 500 when manager throws', async () => {
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id: 'user-1' } }
    })
    mockHandleDataAccessRequest.mockRejectedValue(new Error('boom'))

    const response = await POST(createRequest())
    expect(response.status).toBe(500)
  })
})
