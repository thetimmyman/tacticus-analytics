import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockFindActivelyBannedAuthUserIds: ReturnType<typeof vi.fn>
let mockWithUserBanLocks: ReturnType<typeof vi.fn>
let mockWithUserBanLocksAfterLeaseLoss: ReturnType<typeof vi.fn>
let mockEnqueueUserBanReconciliation: ReturnType<typeof vi.fn>

class MockUserBanLockLostError extends Error {}

describe('/api/admin/users/bulk', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockRequireAuth = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockFindActivelyBannedAuthUserIds = vi.fn().mockResolvedValue([])
    mockEnqueueUserBanReconciliation = vi
      .fn()
      .mockResolvedValue('user-ban-reconcile:test')
    mockWithUserBanLocks = vi.fn(
      async (
        _supabase: unknown,
        userIds: string[],
        operation: (
          leases: Array<{ assertHeld: () => Promise<void> }>
        ) => unknown
      ) =>
        operation(
          userIds.map(() => ({
            assertHeld: vi.fn().mockResolvedValue(undefined)
          }))
        )
    )
    mockWithUserBanLocksAfterLeaseLoss = vi.fn(
      async (
        _supabase: unknown,
        userIds: string[],
        operation: (
          leases: Array<{ assertHeld: () => Promise<void> }>
        ) => unknown
      ) =>
        operation(
          userIds.map(() => ({
            assertHeld: vi.fn().mockResolvedValue(undefined)
          }))
        )
    )

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
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/auth/user-bans', async () => {
      const actual = await vi.importActual<
        typeof import('@/app/lib/auth/user-bans')
      >('@/app/lib/auth/user-bans')
      return {
        ...actual,
        findActivelyBannedAuthUserIds: mockFindActivelyBannedAuthUserIds
      }
    })

    vi.doMock('@/app/lib/auth/user-ban-lock', () => ({
      UserBanLockLostError: MockUserBanLockLostError,
      UserBanOperationInProgressError: class extends Error {},
      withUserBanLocks: (...args: unknown[]) => mockWithUserBanLocks(...args),
      withUserBanLocksAfterLeaseLoss: (...args: unknown[]) =>
        mockWithUserBanLocksAfterLeaseLoss(...args)
    }))

    vi.doMock('@/app/lib/auth/user-ban-reconciliation', () => ({
      enqueueUserBanReconciliation: mockEnqueueUserBanReconciliation
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: { error: vi.fn(), info: vi.fn() }
    }))

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/admin/users/bulk/route')
    POST = routeModule.POST
  })

  describe('POST /api/admin/users/bulk', () => {
    describe('authorization', () => {
      it('returns 403 when user is not admin', async () => {
        mockRequireAuth.mockResolvedValue({
          profile: { is_app_admin: false }
        })

        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'beta_tester',
              user_ids: ['user-1']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(403)
        expect(body.error.metadata.error).toBe('Admin access required')
      })
    })

    describe('validation', () => {
      beforeEach(() => {
        mockRequireAuth.mockResolvedValue({
          profile: { is_app_admin: true, user_id: 'admin-123' }
        })
      })

      it('returns 400 when action is missing', async () => {
        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role_type: 'beta_tester',
              user_ids: ['user-1']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('Action')
      })

      it('returns 400 when role_type is missing', async () => {
        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'add', user_ids: ['user-1'] })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('role_type')
      })

      it('returns 400 for invalid action', async () => {
        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'invalid',
              role_type: 'beta_tester',
              user_ids: ['user-1']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('Invalid action')
      })

      it('returns 400 for invalid role_type', async () => {
        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'invalid_role',
              user_ids: ['user-1']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('Invalid role_type')
      })

      it('returns 400 when no valid users found', async () => {
        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'beta_tester',
              user_ids: []
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('No valid users')
      })
    })

    describe('guild-based bulk operations', () => {
      beforeEach(() => {
        mockRequireAuth.mockResolvedValue({
          profile: { is_app_admin: true, user_id: 'admin-123' }
        })
      })

      it('fetches users from guild when guild_code provided', async () => {
        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              not: vi.fn().mockResolvedValue({
                data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
                error: null
              })
            }
          }
          if (table === 'feature_access_grants') {
            return {
              upsert: vi.fn().mockResolvedValue({ error: null })
            }
          }
          return { select: vi.fn().mockReturnThis() }
        })

        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'beta_tester',
              guild_code: 'GUILD1'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.totalProcessed).toBe(2)
      })
    })

    describe('access grant operations', () => {
      beforeEach(() => {
        mockRequireAuth.mockResolvedValue({
          profile: { is_app_admin: true, user_id: 'admin-123' }
        })
      })

      it('adds access grants for specified users', async () => {
        mockSupabase.from.mockReturnValue({
          upsert: vi.fn().mockResolvedValue({ error: null })
        })

        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'alpha_tester',
              user_ids: ['user-1', 'user-2'],
              notes: 'Test grant'
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.successCount).toBe(2)
      })

      it('removes access grants for specified users', async () => {
        mockSupabase.from.mockReturnValue({
          delete: vi.fn().mockReturnThis(),
          in: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ error: null })
        })

        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'remove',
              role_type: 'beta_tester',
              user_ids: ['user-1']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
      })
    })

    describe('admin role operations', () => {
      beforeEach(() => {
        mockRequireAuth.mockResolvedValue({
          profile: { is_app_admin: true, user_id: 'admin-123' }
        })
      })

      it('adds admin role to users', async () => {
        mockSupabase.rpc.mockResolvedValue({
          data: [{ user_id: 'user-1' }],
          error: null
        })

        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'admin',
              user_ids: ['user-1']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(mockSupabase.rpc).toHaveBeenCalledWith(
          'set_player_app_admin_bulk',
          { p_user_ids: ['user-1'], p_is_app_admin: true }
        )
      })

      it('rejects admin promotion for an actively banned user', async () => {
        mockFindActivelyBannedAuthUserIds.mockResolvedValue(['user-1'])

        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'admin',
              user_ids: ['user-1']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(409)
        expect(body.error.message).toContain('actively banned')
        expect(mockSupabase.rpc).not.toHaveBeenCalled()
      })

      it('revokes a newly granted admin role when the final lease check is lost', async () => {
        let originalScopeReleased = false
        const retainedAssertHeld = vi.fn().mockResolvedValue(undefined)
        const lostAssertHeld = vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new MockUserBanLockLostError('lease lost'))
        mockWithUserBanLocks.mockImplementation(
          async (
            _supabase: unknown,
            _userIds: string[],
            operation: (
              leases: Array<{ assertHeld: () => Promise<void> }>
            ) => unknown
          ) => {
            try {
              return await operation([
                { assertHeld: retainedAssertHeld },
                { assertHeld: lostAssertHeld }
              ])
            } finally {
              originalScopeReleased = true
            }
          }
        )
        mockWithUserBanLocksAfterLeaseLoss.mockImplementation(
          async (
            _supabase: unknown,
            userIds: string[],
            operation: (
              leases: Array<{ assertHeld: () => Promise<void> }>
            ) => unknown
          ) => {
            expect(originalScopeReleased).toBe(true)
            return operation(
              userIds.map(() => ({
                assertHeld: vi.fn().mockResolvedValue(undefined)
              }))
            )
          }
        )
        mockFindActivelyBannedAuthUserIds
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(['user-1'])
        mockSupabase.rpc
          .mockResolvedValueOnce({
            data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
            error: null
          })
          .mockResolvedValueOnce({
            data: [{ user_id: 'user-1' }],
            error: null
          })

        const response = await POST(
          new NextRequest('http://localhost/api/admin/users/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'admin',
              user_ids: ['user-1', 'user-2']
            })
          })
        )

        expect(response.status).toBe(500)
        expect(mockSupabase.rpc).toHaveBeenNthCalledWith(
          2,
          'set_player_app_admin_bulk',
          { p_user_ids: ['user-1'], p_is_app_admin: false }
        )
        expect(mockWithUserBanLocksAfterLeaseLoss).toHaveBeenCalledOnce()
        expect(mockEnqueueUserBanReconciliation).toHaveBeenCalledWith(
          mockSupabase,
          {
            lockUserIds: ['user-1', 'user-2'],
            adminCandidateUserIds: ['user-1', 'user-2']
          }
        )
        expect(
          mockEnqueueUserBanReconciliation.mock.invocationCallOrder[0]
        ).toBeLessThan(
          mockWithUserBanLocksAfterLeaseLoss.mock.invocationCallOrder[0]!
        )
      })

      it('fails loudly when the compensating admin revocation is not proved', async () => {
        const assertHeld = vi
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce(new MockUserBanLockLostError('lease lost'))
        mockWithUserBanLocks.mockImplementation(
          async (
            _supabase: unknown,
            _userIds: string[],
            operation: (
              leases: Array<{ assertHeld: () => Promise<void> }>
            ) => unknown
          ) => operation([{ assertHeld }])
        )
        mockFindActivelyBannedAuthUserIds
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce(['user-1'])
        mockSupabase.rpc
          .mockResolvedValueOnce({
            data: [{ user_id: 'user-1' }],
            error: null
          })
          .mockResolvedValueOnce({
            data: null,
            error: { message: 'revocation failed' }
          })

        const response = await POST(
          new NextRequest('http://localhost/api/admin/users/bulk', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'admin',
              user_ids: ['user-1']
            })
          })
        )

        expect(response.status).toBe(500)
        await expect(response.json()).resolves.toMatchObject({
          error: { message: 'revocation failed' }
        })
      })

      it('prevents admin from removing themselves', async () => {
        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'remove',
              role_type: 'admin',
              user_ids: ['admin-123']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('Cannot remove yourself')
      })

      it('removes admin role from other users but not self', async () => {
        mockSupabase.rpc.mockResolvedValue({
          data: [{ user_id: 'user-1' }, { user_id: 'user-2' }],
          error: null
        })

        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'remove',
              role_type: 'admin',
              user_ids: ['admin-123', 'user-1', 'user-2']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.successCount).toBe(2)
        expect(mockSupabase.rpc).toHaveBeenCalledWith(
          'set_player_app_admin_bulk',
          {
            p_user_ids: ['user-1', 'user-2'],
            p_is_app_admin: false
          }
        )
      })

      it('does not report success when an admin grant updates no exact row', async () => {
        mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'admin',
              user_ids: ['unproved-user']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body).toMatchObject({
          success: false,
          successCount: 0,
          errorCount: 1
        })
        expect(body.errors[0]).toMatch(/exact requested user set/u)
      })
    })

    describe('error handling', () => {
      beforeEach(() => {
        mockRequireAuth.mockResolvedValue({
          profile: { is_app_admin: true, user_id: 'admin-123' }
        })
      })

      it('handles partial failures gracefully', async () => {
        let callCount = 0
        mockSupabase.from.mockReturnValue({
          upsert: vi.fn().mockImplementation(() => {
            callCount++
            if (callCount === 2) {
              return Promise.resolve({
                error: { message: 'Constraint violation' }
              })
            }
            return Promise.resolve({ error: null })
          })
        })

        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'beta_tester',
              user_ids: ['user-1', 'user-2', 'user-3']
            })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(false) // Not all succeeded
        expect(body.successCount).toBe(2)
        expect(body.errorCount).toBe(1)
        expect(body.errors).toBeDefined() // Contains array of error messages
      })

      it('returns 500 on unexpected errors', async () => {
        mockRequireAuth.mockRejectedValue(new Error('Auth service down'))

        const request = new NextRequest(
          'http://localhost/api/admin/users/bulk',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              role_type: 'beta_tester',
              user_ids: ['user-1']
            })
          }
        )

        const response = await POST(request)

        expect(response.status).toBe(500)
      })
    })
  })
})
