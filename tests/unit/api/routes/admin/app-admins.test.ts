import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Errors as ErrorsType } from '@/app/lib/errors/AppError'

let mockRequireAppAdmin: ReturnType<typeof vi.fn>
let mockListAppAdmins: ReturnType<typeof vi.fn>
let Errors: typeof ErrorsType

describe('/api/admin/app-admins', () => {
  let GET: () => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    const errorModule = await import('@/app/lib/errors/AppError')
    Errors = errorModule.Errors

    mockRequireAppAdmin = vi.fn()
    mockListAppAdmins = vi.fn()

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      requireAppAdmin: mockRequireAppAdmin,
      listAppAdmins: mockListAppAdmins
    }))

    const routeModule = await import('@/app/api/admin/app-admins/route')
    GET = routeModule.GET
  })

  describe('GET /api/admin/app-admins', () => {
    it('returns 403 when user is not admin', async () => {
      mockRequireAppAdmin.mockRejectedValue(
        Errors.forbidden('Admin access required')
      )

      const response = await GET()

      expect(response.status).toBe(403)
    })

    it('returns empty array when no admins exist', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockListAppAdmins.mockResolvedValue([])

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.admins).toEqual([])
    })

    it('returns admins with enriched data', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockListAppAdmins.mockResolvedValue([
        {
          user_id: 'user-1',
          email: 'admin@example.com',
          display_name: 'AdminUser',
          guild_code: 'GUILD1',
          cluster_code: 'EOT',
          role: 'leader',
          player_id: 'player-1',
          is_app_admin: true
        }
      ])

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.admins).toHaveLength(1)
      expect(body.admins[0]).toMatchObject({
        user_id: 'user-1',
        email: 'admin@example.com',
        display_name: 'AdminUser',
        is_app_admin: true
      })
    })

    it('returns 500 on database error', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockListAppAdmins.mockRejectedValue(Errors.database('DB error'))

      const response = await GET()

      expect(response.status).toBe(500)
    })

    it('returns 500 on unexpected error', async () => {
      mockRequireAppAdmin.mockRejectedValue(new Error('Auth service down'))

      const response = await GET()

      expect(response.status).toBe(500)
    })
  })
})
