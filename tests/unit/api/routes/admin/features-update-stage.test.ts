import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>

describe('Features Update Stage API', () => {
  let mockSupabase: {
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockRequireAuth = vi.fn()
    mockCreateClient = vi.fn()

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
      createClient: mockCreateClient
    }))

    mockSupabase = {
      rpc: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)
  })

  describe('POST /api/admin/features/update-stage', () => {
    let POST: (request: NextRequest) => Promise<Response>

    beforeEach(async () => {
      const routeModule =
        await import('@/app/api/admin/features/update-stage/route')
      POST = routeModule.POST
    })

    it('returns 500 when not authenticated', async () => {
      mockRequireAuth.mockRejectedValue(new Error('Not authenticated'))

      const request = new NextRequest(
        'http://localhost/api/admin/features/update-stage',
        {
          method: 'POST',
          body: JSON.stringify({ feature_key: 'test', new_stage: 'beta' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(500)
    })

    it('returns 403 when not app admin', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: false }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/features/update-stage',
        {
          method: 'POST',
          body: JSON.stringify({ feature_key: 'test', new_stage: 'beta' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(403)
    })

    it('returns 400 when feature_key missing', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/features/update-stage',
        {
          method: 'POST',
          body: JSON.stringify({ new_stage: 'beta' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(400)
    })

    it('returns 400 when new_stage missing', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/features/update-stage',
        {
          method: 'POST',
          body: JSON.stringify({ feature_key: 'test' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(400)
    })

    it('returns 400 for invalid stage', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/features/update-stage',
        {
          method: 'POST',
          body: JSON.stringify({
            feature_key: 'test',
            new_stage: 'invalid_stage'
          })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Invalid stage')
    })

    it('returns 500 when RPC fails', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC error' }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/features/update-stage',
        {
          method: 'POST',
          body: JSON.stringify({ feature_key: 'test', new_stage: 'beta' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(500)
    })

    it('returns 400 when RPC returns unsuccessful', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: false, error: 'Feature not found' },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/features/update-stage',
        {
          method: 'POST',
          body: JSON.stringify({ feature_key: 'test', new_stage: 'beta' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(400)
    })

    it('successfully updates feature stage', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: true },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/features/update-stage',
        {
          method: 'POST',
          body: JSON.stringify({
            feature_key: 'war_tracking',
            new_stage: 'public'
          })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.success).toBe(true)

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'admin_update_feature_stage',
        {
          p_feature_key: 'war_tracking',
          p_new_stage: 'public'
        }
      )
    })

    it('accepts all valid stages', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true }
      })

      const validStages = ['alpha', 'beta', 'coming_soon', 'public']

      for (const stage of validStages) {
        mockSupabase.rpc.mockResolvedValue({
          data: { success: true },
          error: null
        })

        const request = new NextRequest(
          'http://localhost/api/admin/features/update-stage',
          {
            method: 'POST',
            body: JSON.stringify({ feature_key: 'test', new_stage: stage })
          }
        )

        const response = await POST(request)
        expect(response.status).toBe(200)
      }
    })
  })
})
