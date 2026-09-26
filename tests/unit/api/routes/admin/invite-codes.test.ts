import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireAuth: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

describe('/api/admin/invite-codes', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let POST: (request: NextRequest) => Promise<Response>
  let DELETE: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockRequireAuth = vi.fn()
    mockCreateServiceClient = vi.fn()

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
      createServiceClient: mockCreateServiceClient,
      createClient: vi.fn().mockResolvedValue(mockSupabase)
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: { error: vi.fn(), info: vi.fn() }
    }))

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/admin/invite-codes/route')
    GET = routeModule.GET
    POST = routeModule.POST
    DELETE = routeModule.DELETE
  })

  describe('GET /api/admin/invite-codes', () => {
    it('returns 403 when user is not admin', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: false },
        user: { id: 'user-123' }
      })

      const request = new NextRequest('http://localhost/api/admin/invite-codes')

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.metadata.error).toBe('Admin access required')
    })

    it('returns invite codes for admin', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      const mockCodes = [
        { id: '1', code: 'ABC123', player_id: 'p1', guild_code: 'GUILD1' },
        { id: '2', code: 'DEF456', player_id: 'p2', guild_code: 'GUILD1' }
      ]

      mockSupabase.rpc.mockResolvedValue({ data: mockCodes, error: null })

      const request = new NextRequest('http://localhost/api/admin/invite-codes')

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.codes).toHaveLength(2)
    })

    it('filters by guild_code when provided', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes?guild_code=GUILD1'
      )

      await GET(request)

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'list_player_invite_codes',
        { p_guild_code: 'GUILD1' }
      )
    })

    it('returns 500 on database error', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'DB error' }
      })

      const request = new NextRequest('http://localhost/api/admin/invite-codes')

      const response = await GET(request)

      expect(response.status).toBe(500)
    })
  })

  describe('POST /api/admin/invite-codes', () => {
    it('returns 403 when user is not admin', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: false },
        user: { id: 'user-123' }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_id: 'p1',
            display_name: 'Player1',
            guild_code: 'GUILD1'
          })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(403)
    })

    it('returns 400 when required fields are missing', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ player_id: 'p1' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Missing required fields')
    })

    it('returns 404 when player not found in guild', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_id: 'p1',
            display_name: 'Player1',
            guild_code: 'GUILD1'
          })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(404)
    })

    it('returns 400 when player already claimed', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            player_id: 'p1',
            user_id: 'existing-user',
            display_name: 'Player1'
          },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_id: 'p1',
            display_name: 'Player1',
            guild_code: 'GUILD1'
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('already claimed')
    })

    it('creates invite code successfully', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 42,
                player_id: 'p1',
                user_id: null,
                display_name: 'Player1'
              },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          invite_id: 'invite-1',
          code: 'NEW-CODE-123',
          expires_at: '2026-01-20T00:00:00Z',
          player_name: 'Player1',
          guild_code: 'GUILD1'
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            player_id: 'p1',
            display_name: 'Player1',
            guild_code: 'GUILD1'
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.code).toBe('NEW-CODE-123')
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'create_player_invite_code',
        expect.objectContaining({ p_mapping_id: 42 })
      )
    })
  })

  describe('DELETE /api/admin/invite-codes', () => {
    it('returns 403 when user is not admin', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: false },
        user: { id: 'user-123' }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes?id=code-1',
        {
          method: 'DELETE'
        }
      )

      const response = await DELETE(request)

      expect(response.status).toBe(403)
    })

    it('returns 400 when code ID is missing', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes',
        {
          method: 'DELETE'
        }
      )

      const response = await DELETE(request)

      expect(response.status).toBe(400)
    })

    it('returns 404 when code not found', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: false,
          error: 'Invite code not found',
          error_code: 'NOT_FOUND'
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes?id=nonexistent',
        {
          method: 'DELETE'
        }
      )

      const response = await DELETE(request)

      expect(response.status).toBe(404)
    })

    it('returns 400 when trying to revoke used code', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: false,
          error: 'Cannot revoke a used invite code',
          error_code: 'ALREADY_USED'
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes?id=code-1',
        {
          method: 'DELETE'
        }
      )

      const response = await DELETE(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Cannot revoke a used invite code')
    })

    it('revokes invite code successfully', async () => {
      mockRequireAuth.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-123' }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: true },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/invite-codes?id=code-1',
        {
          method: 'DELETE'
        }
      )

      const response = await DELETE(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'revoke_player_invite_code',
        {
          p_invite_id: 'code-1',
          p_reason: 'admin_revoked'
        }
      )
    })
  })
})
