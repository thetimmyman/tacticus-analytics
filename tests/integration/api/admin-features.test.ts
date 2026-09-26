import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import { AuthError } from '@/app/lib/auth'

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  const mockRequireAuth = vi.fn()
  return {
    ...actual,
    requireAuth: mockRequireAuth,
    requireAuthForApi: mockRequireAuth,
    requireActiveMembershipForApi: mockRequireAuth,
    AuthError: actual.AuthError
  }
})

vi.mock('@/app/lib/auth/server', () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn()
}))

describe('Admin Features Routes', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let requireAuthForApi: ReturnType<typeof vi.fn>
  let createClient: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    const authModule = await import('@/app/lib/auth')
    const serverModule = await import('@/app/lib/auth/server')

    requireAuthForApi = vi.mocked(authModule.requireAuthForApi)
    createClient = vi.mocked(serverModule.createClient)

    createClient.mockResolvedValue(mockSupabase)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/admin/features', () => {
    function createRequest(): NextRequest {
      return new NextRequest('http://localhost:3000/api/admin/features', {
        method: 'GET'
      })
    }

    it('returns 403 when user is not an admin', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: false, user_id: 'user-123' }
      })

      const { GET } = await import('@/app/api/admin/features/route')

      const response = await GET(createRequest())

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toBe('Admin access required')
    })

    it('returns features list for admin', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })

      const mockFeatures = [
        { key: 'feature1', stage: 'beta', sort_order: 1 },
        { key: 'feature2', stage: 'public', sort_order: 2 }
      ]

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: mockFeatures,
            error: null
          })
        })
      })

      const { GET } = await import('@/app/api/admin/features/route')

      const response = await GET(createRequest())

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.features).toEqual(mockFeatures)
    })

    it('handles database errors', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'DB Error' }
          })
        })
      })

      const { GET } = await import('@/app/api/admin/features/route')

      const response = await GET(createRequest())

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('DB Error')
    })

    it('handles AuthError correctly', async () => {
      requireAuthForApi.mockRejectedValue(
        new AuthError('Not authenticated', 'UNAUTHENTICATED')
      )

      const { GET } = await import('@/app/api/admin/features/route')

      const response = await GET(createRequest())

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error.code).toBe(1001)
    })
  })

  describe('POST /api/admin/features/update-stage', () => {
    function createRequest(body: object): NextRequest {
      return new NextRequest(
        'http://localhost:3000/api/admin/features/update-stage',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        }
      )
    }

    it('returns 403 when user is not an admin', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: false, user_id: 'user-123' }
      })

      const { POST } =
        await import('@/app/api/admin/features/update-stage/route')
      const req = createRequest({ feature_key: 'test', new_stage: 'beta' })

      const response = await POST(req)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toBe('Admin access required')
    })

    it('returns 400 for missing fields', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })

      const { POST } =
        await import('@/app/api/admin/features/update-stage/route')
      const req = createRequest({ feature_key: 'test' }) // missing new_stage

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toBe('Missing required fields')
    })

    it('returns 400 for invalid stage', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })

      const { POST } =
        await import('@/app/api/admin/features/update-stage/route')
      const req = createRequest({
        feature_key: 'test',
        new_stage: 'invalid_stage'
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Invalid stage')
    })

    it('successfully updates feature stage', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: true },
        error: null
      })

      const { POST } =
        await import('@/app/api/admin/features/update-stage/route')
      const req = createRequest({
        feature_key: 'test_feature',
        new_stage: 'public'
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'admin_update_feature_stage',
        {
          p_feature_key: 'test_feature',
          p_new_stage: 'public'
        }
      )
    })

    it('handles RPC failure result', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: false, error: 'Feature not found' },
        error: null
      })

      const { POST } =
        await import('@/app/api/admin/features/update-stage/route')
      const req = createRequest({ feature_key: 'unknown', new_stage: 'beta' })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toBe('Feature not found')
    })

    it('handles database errors during RPC', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC Error' }
      })

      const { POST } =
        await import('@/app/api/admin/features/update-stage/route')
      const req = createRequest({ feature_key: 'test', new_stage: 'beta' })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('RPC Error')
    })
  })
})
