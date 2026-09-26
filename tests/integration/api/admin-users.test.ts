import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth', async () => {
  const actual =
    await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
  const mockRequireAuth = vi.fn()
  return {
    ...actual,
    requireAuth: mockRequireAuth,
    requireAuthForApi: mockRequireAuth,
    requireActiveMembershipForApi: mockRequireAuth
  }
})

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: vi.fn()
}))

vi.mock('@/app/lib/auth/user-bans', async () => {
  const actual = await vi.importActual<
    typeof import('@/app/lib/auth/user-bans')
  >('@/app/lib/auth/user-bans')
  return {
    ...actual,
    findActivelyBannedAuthUserIds: async () => []
  }
})

vi.mock('@/app/lib/auth/user-ban-lock', () => ({
  UserBanOperationInProgressError: class extends Error {},
  withUserBanLocks: async (
    _supabase: unknown,
    userIds: string[],
    operation: (leases: Array<{ assertHeld: () => Promise<void> }>) => unknown
  ) =>
    operation(
      userIds.map(() => ({
        assertHeld: async () => undefined
      }))
    )
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

describe('Admin Users Bulk Route', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let requireAuth: ReturnType<typeof vi.fn>
  let serviceDb: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    const authModule = await import('@/app/lib/auth')
    const dbModule = await import('@/app/lib/db')

    requireAuth = vi.mocked(authModule.requireAuth)
    serviceDb = vi.mocked(dbModule.serviceDb)

    serviceDb.mockReturnValue(mockSupabase)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function createRequest(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/admin/users/bulk', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  describe('Authentication', () => {
    it('returns 403 when user is not an admin', async () => {
      requireAuth.mockResolvedValue({
        profile: { is_app_admin: false, user_id: 'user-123' }
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({ action: 'add', role_type: 'alpha_tester' })

      const response = await POST(req)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toBe('Admin access required')
    })

    it('returns 403 when profile is null', async () => {
      requireAuth.mockResolvedValue({ profile: null })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({ action: 'add', role_type: 'alpha_tester' })

      const response = await POST(req)

      expect(response.status).toBe(403)
    })

    it('allows access for admin users', async () => {
      requireAuth.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({
                data: [{ user_id: 'user-1' }],
                error: null
              })
            })
          })
        }),
        upsert: vi.fn().mockResolvedValue({ error: null })
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'alpha_tester',
        guild_code: 'TEST'
      })

      const response = await POST(req)

      expect(response.status).not.toBe(403)
    })
  })

  describe('Validation', () => {
    beforeEach(() => {
      requireAuth.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })
    })

    it('returns 400 when action is missing', async () => {
      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({ role_type: 'alpha_tester' })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Action and role_type are requi')
    })

    it('returns 400 when role_type is missing', async () => {
      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({ action: 'add' })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Action and role_type are requi')
    })

    it('returns 400 for invalid action', async () => {
      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'invalid',
        role_type: 'alpha_tester'
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toBe('Invalid action')
    })

    it('returns 400 for invalid role_type', async () => {
      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({ action: 'add', role_type: 'invalid_role' })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toBe('Invalid role_type')
    })

    it('returns 400 when no users found', async () => {
      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'alpha_tester',
        user_ids: []
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toBe('No valid users found')
    })

    it.each(['add', 'remove'])('accepts %s as valid action', async (action) => {
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null }),
        delete: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null })
          })
        })
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action,
        role_type: 'alpha_tester',
        user_ids: ['user-1']
      })

      const response = await POST(req)

      expect(response.status).not.toBe(400)
    })

    it.each(['alpha_tester', 'beta_tester', 'admin'])(
      'accepts %s as valid role_type',
      async (role_type) => {
        mockSupabase.from.mockReturnValue({
          upsert: vi.fn().mockResolvedValue({ error: null }),
          update: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockResolvedValue({
                  data: [{ user_id: 'user-1' }],
                  error: null
                })
              })
            })
          })
        })

        const { POST } = await import('@/app/api/admin/users/bulk/route')
        const req = createRequest({
          action: 'add',
          role_type,
          user_ids: ['user-1']
        })

        const response = await POST(req)

        expect(response.status).not.toBe(400)
      }
    )
  })

  describe('Guild-based targeting', () => {
    beforeEach(() => {
      requireAuth.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })
    })

    it('fetches users from guild when guild_code is provided', async () => {
      const selectMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            not: vi.fn().mockResolvedValue({
              data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
              error: null
            })
          })
        })
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return { select: selectMock }
        }
        return {
          upsert: vi.fn().mockResolvedValue({ error: null })
        }
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'alpha_tester',
        guild_code: 'TEST'
      })

      await POST(req)

      expect(mockSupabase.from).toHaveBeenCalledWith('player_mapping')
    })

    it('returns 500 when guild query fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              not: vi.fn().mockResolvedValue({
                data: null,
                error: { message: 'Database error' }
              })
            })
          })
        })
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'alpha_tester',
        guild_code: 'TEST'
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('Database error')
    })

    it('filters out null user_ids from guild members', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  not: vi.fn().mockResolvedValue({
                    data: [
                      { user_id: 'user-1' },
                      { user_id: null },
                      { user_id: 'user-2' }
                    ],
                    error: null
                  })
                })
              })
            })
          }
        }
        return {
          upsert: vi.fn().mockResolvedValue({ error: null })
        }
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'alpha_tester',
        guild_code: 'TEST'
      })

      const response = await POST(req)
      const body = await response.json()

      expect(body.totalProcessed).toBe(2)
    })
  })

  describe('Admin role operations', () => {
    beforeEach(() => {
      requireAuth.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })
    })

    it('updates the exact admin set through the transactional RPC', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
        error: null
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'admin',
        user_ids: ['user-1', 'user-2']
      })

      await POST(req)

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'set_player_app_admin_bulk',
        {
          p_user_ids: ['user-1', 'user-2'],
          p_is_app_admin: true
        }
      )
    })

    it('prevents admin from removing themselves', async () => {
      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'remove',
        role_type: 'admin',
        user_ids: ['admin-123']
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Cannot remove yourself as admi')
    })

    it('allows removing other admins', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [{ user_id: 'user-other' }],
        error: null
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'remove',
        role_type: 'admin',
        user_ids: ['admin-123', 'user-other']
      })

      const response = await POST(req)
      const body = await response.json()

      expect(body.successCount).toBe(1)
    })

    it('reports error when admin update fails', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Update failed' }
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'admin',
        user_ids: ['user-1']
      })

      const response = await POST(req)
      const body = await response.json()

      expect(body.errors).toBeDefined()
      expect(body.errorCount).toBe(1)
    })
  })

  describe('Feature access operations', () => {
    beforeEach(() => {
      requireAuth.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })
    })

    it('creates feature_access_grants for add action', async () => {
      const upsertMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockReturnValue({ upsert: upsertMock })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'alpha_tester',
        user_ids: ['user-1'],
        notes: 'Test grant'
      })

      await POST(req)

      expect(mockSupabase.from).toHaveBeenCalledWith('feature_access_grants')
      expect(upsertMock).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 'user-1',
          access_level: 'alpha_tester',
          notes: 'Test grant'
        }),
        { onConflict: 'user_id,access_level' }
      )
    })

    it('deletes feature_access_grants for remove action', async () => {
      const eqMock = vi.fn().mockResolvedValue({ error: null })
      const inMock = vi.fn().mockReturnValue({ eq: eqMock })
      const deleteMock = vi.fn().mockReturnValue({ in: inMock })

      mockSupabase.from.mockReturnValue({ delete: deleteMock })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'remove',
        role_type: 'beta_tester',
        user_ids: ['user-1', 'user-2']
      })

      await POST(req)

      expect(mockSupabase.from).toHaveBeenCalledWith('feature_access_grants')
      expect(inMock).toHaveBeenCalledWith('user_id', ['user-1', 'user-2'])
      expect(eqMock).toHaveBeenCalledWith('access_level', 'beta_tester')
    })

    it('tracks individual upsert failures', async () => {
      let callCount = 0
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 2) {
            return Promise.resolve({ error: { message: 'Upsert failed' } })
          }
          return Promise.resolve({ error: null })
        })
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'alpha_tester',
        user_ids: ['user-1', 'user-2', 'user-3']
      })

      const response = await POST(req)
      const body = await response.json()

      expect(body.successCount).toBe(2)
      expect(body.errorCount).toBe(1)
      expect(body.errors).toHaveLength(1)
    })

    it('reports delete error', async () => {
      mockSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          in: vi.fn().mockReturnValue({
            eq: vi
              .fn()
              .mockResolvedValue({ error: { message: 'Delete failed' } })
          })
        })
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'remove',
        role_type: 'beta_tester',
        user_ids: ['user-1']
      })

      const response = await POST(req)
      const body = await response.json()

      expect(body.errors).toBeDefined()
      expect(body.errors).toContain('Delete failed')
    })
  })

  describe('Response format', () => {
    beforeEach(() => {
      requireAuth.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })
    })

    it('returns success counts for successful operations', async () => {
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockResolvedValue({ error: null })
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'alpha_tester',
        user_ids: ['user-1', 'user-2', 'user-3']
      })

      const response = await POST(req)
      const body = await response.json()

      expect(body.success).toBe(true)
      expect(body.successCount).toBe(3)
      expect(body.errorCount).toBe(0)
      expect(body.totalProcessed).toBe(3)
    })

    it('limits errors array to 5 items', async () => {
      let callCount = 0
      mockSupabase.from.mockReturnValue({
        upsert: vi.fn().mockImplementation(() => {
          callCount++
          return Promise.resolve({ error: { message: `Error ${callCount}` } })
        })
      })

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({
        action: 'add',
        role_type: 'alpha_tester',
        user_ids: ['u1', 'u2', 'u3', 'u4', 'u5', 'u6', 'u7']
      })

      const response = await POST(req)
      const body = await response.json()

      expect(body.errors.length).toBeLessThanOrEqual(5)
    })
  })

  describe('Error handling', () => {
    it('returns 500 for unexpected errors', async () => {
      requireAuth.mockRejectedValue(new Error('Auth system failed'))

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({ action: 'add', role_type: 'alpha_tester' })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('An unexpected error occurred')
    })

    it('handles non-Error exceptions', async () => {
      requireAuth.mockRejectedValue('String error')

      const { POST } = await import('@/app/api/admin/users/bulk/route')
      const req = createRequest({ action: 'add', role_type: 'alpha_tester' })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('An unexpected error occurred')
    })
  })
})
