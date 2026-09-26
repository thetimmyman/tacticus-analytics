import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import type { Errors as ErrorsType } from '@/app/lib/errors/AppError'

let mockRequireAppAdmin: ReturnType<typeof vi.fn>
let mockRemoveAccessGrant: ReturnType<typeof vi.fn>
let Errors: typeof ErrorsType

describe.each([
  { route: 'alpha-testers', accessLevel: 'alpha_tester' },
  { route: 'beta-testers', accessLevel: 'beta_tester' }
])('/api/admin/$route', ({ route, accessLevel }) => {
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
  })

  describe(`POST /api/admin/${route}/remove`, () => {
    let POST: (request: NextRequest) => Promise<Response>

    beforeEach(async () => {
      const routeModule = await import(`@/app/api/admin/${route}/remove/route`)
      POST = routeModule.POST
    })

    it('returns 403 when user is not admin', async () => {
      mockRequireAppAdmin.mockRejectedValue(
        Errors.forbidden('Admin access required')
      )

      const request = new NextRequest(
        `http://localhost/api/admin/${route}/remove`,
        {
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(403)
    })

    it('returns 400 when email is missing', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })

      const request = new NextRequest(
        `http://localhost/api/admin/${route}/remove`,
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
      mockRemoveAccessGrant.mockRejectedValue(
        Errors.notFound('User', 'User not found')
      )

      const request = new NextRequest(
        `http://localhost/api/admin/${route}/remove`,
        {
          method: 'POST',
          body: JSON.stringify({ email: 'notfound@example.com' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(404)
    })

    it('removes access grant successfully', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockRemoveAccessGrant.mockResolvedValue({ success: true })

      const request = new NextRequest(
        `http://localhost/api/admin/${route}/remove`,
        {
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })

    it('returns 500 on database error', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockRemoveAccessGrant.mockRejectedValue(Errors.database('Delete failed'))

      const request = new NextRequest(
        `http://localhost/api/admin/${route}/remove`,
        {
          method: 'POST',
          body: JSON.stringify({ email: 'test@example.com' })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(500)
    })
  })
})
