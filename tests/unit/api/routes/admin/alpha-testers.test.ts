import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Errors as ErrorsType } from '@/app/lib/errors/AppError'

const createRequest = (url: string, body: object) =>
  new NextRequest(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

let mockRequireAppAdmin: ReturnType<typeof vi.fn>
let mockRemoveAccessGrant: ReturnType<typeof vi.fn>
let Errors: typeof ErrorsType

describe('POST /api/admin/alpha-testers/remove', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    const errorModule = await import('@/app/lib/errors/AppError')
    Errors = errorModule.Errors

    mockRequireAppAdmin = vi.fn()
    mockRemoveAccessGrant = vi.fn()

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      requireAppAdmin: mockRequireAppAdmin,
      removeAccessGrant: mockRemoveAccessGrant
    }))

    const routeModule =
      await import('@/app/api/admin/alpha-testers/remove/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns 403 when user is not an admin', async () => {
    mockRequireAppAdmin.mockRejectedValue(
      Errors.forbidden('Admin access required')
    )

    const request = createRequest(
      'http://localhost/api/admin/alpha-testers/remove',
      { email: 'test@example.com' }
    )
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Admin access required')
  })

  it('returns 400 when email is missing', async () => {
    mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })

    const request = createRequest(
      'http://localhost/api/admin/alpha-testers/remove',
      {}
    )
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('Email is required')
  })

  it('returns 500 when the RPC returns an error', async () => {
    mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
    mockRemoveAccessGrant.mockRejectedValue(Errors.database('RPC failed'))

    const request = createRequest(
      'http://localhost/api/admin/alpha-testers/remove',
      { email: 'test@example.com' }
    )
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toBe('RPC failed')
  })

  it('returns 400 when the RPC reports failure', async () => {
    mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
    mockRemoveAccessGrant.mockRejectedValue(
      Errors.validation('Failed to remove')
    )

    const request = createRequest(
      'http://localhost/api/admin/alpha-testers/remove',
      { email: 'test@example.com' }
    )
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toBe('Failed to remove')
  })

  it('returns success when the alpha tester is removed', async () => {
    mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
    mockRemoveAccessGrant.mockResolvedValue({ success: true })

    const request = createRequest(
      'http://localhost/api/admin/alpha-testers/remove',
      { email: 'test@example.com' }
    )
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockRemoveAccessGrant).toHaveBeenCalledWith(
      'test@example.com',
      'alpha_tester'
    )
  })

  it('returns 500 when requireAppAdmin throws', async () => {
    mockRequireAppAdmin.mockRejectedValue(new Error('Auth failed'))

    const request = createRequest(
      'http://localhost/api/admin/alpha-testers/remove',
      { email: 'test@example.com' }
    )
    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toBe('An unexpected error occurred')
  })
})
