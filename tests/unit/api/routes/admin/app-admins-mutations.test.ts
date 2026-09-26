import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Errors as ErrorsType } from '@/app/lib/errors/AppError'

let mockRequireAppAdmin: ReturnType<typeof vi.fn>
let mockRemoveAppAdmin: ReturnType<typeof vi.fn>
let Errors: typeof ErrorsType

describe('App Admins Mutations API', () => {
  beforeEach(async () => {
    vi.resetModules()

    const errorModule = await import('@/app/lib/errors/AppError')
    Errors = errorModule.Errors

    mockRequireAppAdmin = vi.fn()
    mockRemoveAppAdmin = vi.fn()

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      requireAppAdmin: mockRequireAppAdmin,
      removeAppAdmin: mockRemoveAppAdmin
    }))
  })

  describe('POST /api/admin/app-admins/remove', () => {
    let POST: (request: NextRequest) => Promise<Response>

    beforeEach(async () => {
      const routeModule =
        await import('@/app/api/admin/app-admins/remove/route')
      POST = routeModule.POST
    })

    it('returns 403 when not app admin', async () => {
      mockRequireAppAdmin.mockRejectedValue(
        Errors.forbidden('Admin access required')
      )

      const request = new NextRequest(
        'http://localhost/api/admin/app-admins/remove',
        {
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(403)
    })

    it('returns 400 when email missing', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })

      const request = new NextRequest(
        'http://localhost/api/admin/app-admins/remove',
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(400)
    })

    it('returns 404 when user not found', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockRemoveAppAdmin.mockRejectedValue(
        Errors.notFound('User', 'User not found')
      )

      const request = new NextRequest(
        'http://localhost/api/admin/app-admins/remove',
        {
          method: 'POST',
          body: JSON.stringify({ email: 'notfound@example.com' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(404)
    })

    it('returns 400 when trying to remove yourself', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'user-1' })
      mockRemoveAppAdmin.mockRejectedValue(
        Errors.validation('Cannot remove yourself as admin')
      )

      const request = new NextRequest(
        'http://localhost/api/admin/app-admins/remove',
        {
          method: 'POST',
          body: JSON.stringify({ email: 'myself@example.com' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Cannot remove yourself')
    })

    it('successfully removes app admin', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockRemoveAppAdmin.mockResolvedValue({ success: true })

      const request = new NextRequest(
        'http://localhost/api/admin/app-admins/remove',
        {
          method: 'POST',
          body: JSON.stringify({ email: 'otheradmin@example.com' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })
  })
})
