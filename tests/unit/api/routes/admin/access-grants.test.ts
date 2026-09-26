import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Errors as ErrorsType } from '@/app/lib/errors/AppError'

let mockRequireAppAdmin: ReturnType<typeof vi.fn>
let mockListAccessGrants: ReturnType<typeof vi.fn>
let Errors: typeof ErrorsType

describe.each([
  {
    route: 'beta-testers',
    accessLevel: 'beta_tester',
    includesAccessLevel: true
  },
  {
    route: 'alpha-testers',
    accessLevel: 'alpha_tester',
    includesAccessLevel: false
  }
])('/api/admin/$route', ({ route, accessLevel, includesAccessLevel }) => {
  let GET: () => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    // Same module instance withErrorHandler uses.
    const errorModule = await import('@/app/lib/errors/AppError')
    Errors = errorModule.Errors

    mockRequireAppAdmin = vi.fn()
    mockListAccessGrants = vi.fn()

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      requireAppAdmin: mockRequireAppAdmin,
      listAccessGrants: mockListAccessGrants
    }))

    const routeModule = await import(`@/app/api/admin/${route}/route`)
    GET = routeModule.GET
  })

  describe(`GET /api/admin/${route}`, () => {
    it('returns 403 when user is not admin', async () => {
      mockRequireAppAdmin.mockRejectedValue(
        Errors.forbidden('Admin access required')
      )

      const response = await GET()

      expect(response.status).toBe(403)
    })

    it('returns empty array when no grants exist', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockListAccessGrants.mockResolvedValue([])

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.testers).toEqual([])
    })

    it(`queries for ${accessLevel} access level`, async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockListAccessGrants.mockResolvedValue([])

      await GET()

      expect(mockListAccessGrants).toHaveBeenCalledWith(accessLevel)
    })

    it('returns testers with enriched data', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockListAccessGrants.mockResolvedValue([
        {
          user_id: 'user-1',
          email: 'test@example.com',
          display_name: 'TestPlayer',
          guild_code: 'GUILD1',
          cluster_code: 'EOT',
          role: null,
          access_level: accessLevel,
          granted_at: '2026-01-01',
          expires_at: null,
          notes: 'Test'
        }
      ])

      const response = await GET()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.testers).toHaveLength(1)
      const expectedData: Record<string, unknown> = {
        user_id: 'user-1',
        email: 'test@example.com',
        display_name: 'TestPlayer'
      }
      if (includesAccessLevel) {
        expectedData.access_level = accessLevel
      }
      expect(body.testers[0]).toMatchObject(expectedData)
    })

    it('returns 500 on database error', async () => {
      mockRequireAppAdmin.mockResolvedValue({ user_id: 'admin-1' })
      mockListAccessGrants.mockRejectedValue(Errors.database('DB error'))

      const response = await GET()

      expect(response.status).toBe(500)
    })
  })
})
