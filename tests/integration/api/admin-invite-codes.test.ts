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

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

describe('Admin Invite Codes Routes', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let requireAuthForApi: ReturnType<typeof vi.fn>
  let createClient: ReturnType<typeof vi.fn>
  let createServiceClient: ReturnType<typeof vi.fn>

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
    createServiceClient = vi.mocked(serverModule.createServiceClient)

    createClient.mockResolvedValue(mockSupabase)
    createServiceClient.mockReturnValue(mockSupabase)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET /api/admin/invite-codes', () => {
    function createRequest(url: string): NextRequest {
      return new NextRequest(url, { method: 'GET' })
    }

    it('returns 403 when user is not an admin', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: false, user_id: 'user-123' }
      })

      const { GET } = await import('@/app/api/admin/invite-codes/route')

      const response = await GET(
        createRequest('http://localhost:3000/api/admin/invite-codes')
      )

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toBe('Admin access required')
    })

    it('returns invite codes list for admin', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })

      const mockCodes = [{ code: 'ABC-123', player_id: 'p1' }]

      mockSupabase.rpc.mockResolvedValue({
        data: mockCodes,
        error: null
      })

      const { GET } = await import('@/app/api/admin/invite-codes/route')

      const response = await GET(
        createRequest('http://localhost:3000/api/admin/invite-codes')
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.codes).toEqual(mockCodes)
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'list_player_invite_codes',
        { p_guild_code: null }
      )
    })

    it('filters by guild_code when provided', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true, user_id: 'admin-123' }
      })

      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const { GET } = await import('@/app/api/admin/invite-codes/route')

      const response = await GET(
        createRequest(
          'http://localhost:3000/api/admin/invite-codes?guild_code=TEST'
        )
      )

      expect(response.status).toBe(200)
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'list_player_invite_codes',
        { p_guild_code: 'TEST' }
      )
    })
  })

  describe('POST /api/admin/invite-codes', () => {
    function createRequest(body: object): NextRequest {
      return new NextRequest('http://localhost:3000/api/admin/invite-codes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })
    }

    it('returns 400 for missing fields', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-1' }
      })

      const { POST } = await import('@/app/api/admin/invite-codes/route')
      const req = createRequest({ player_id: 'p1' }) // missing others

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Missing required fields')
    })

    it('returns 404 if player not found in guild', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-1' }
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: { message: 'Not found' }
                })
              })
            })
          })
        })
      })

      const { POST } = await import('@/app/api/admin/invite-codes/route')
      const req = createRequest({
        player_id: 'p1',
        display_name: 'Player 1',
        guild_code: 'TEST'
      })

      const response = await POST(req)

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error.message).toBe('Player not found in guild')
    })

    it('returns 400 if player already claimed', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-1' }
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { user_id: 'existing-user' },
                  error: null
                })
              })
            })
          })
        })
      })

      const { POST } = await import('@/app/api/admin/invite-codes/route')
      const req = createRequest({
        player_id: 'p1',
        display_name: 'Player 1',
        guild_code: 'TEST'
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('already claimed')
    })

    it('successfully creates invite code', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-1' }
      })

      const playerCheckChain = {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: {
                    id: 42,
                    user_id: null,
                    display_name: 'Player 1'
                  },
                  error: null
                })
              })
            })
          })
        })
      }

      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          invite_id: 'invite-1',
          code: 'NEW-CODE',
          expires_at: '2026-01-20T00:00:00Z',
          player_name: 'Player 1',
          guild_code: 'TEST'
        },
        error: null
      })

      mockSupabase.from.mockImplementation((table) => {
        if (table === 'player_mapping') return playerCheckChain
        return {}
      })

      const { POST } = await import('@/app/api/admin/invite-codes/route')
      const req = createRequest({
        player_id: 'p1',
        display_name: 'Player 1',
        guild_code: 'TEST'
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.code).toBe('NEW-CODE')
      expect(body.success).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'create_player_invite_code',
        expect.objectContaining({ p_mapping_id: 42 })
      )
    })
  })

  describe('DELETE /api/admin/invite-codes', () => {
    function createRequest(url: string): NextRequest {
      return new NextRequest(url, { method: 'DELETE' })
    }

    it('returns 400 if id missing', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-1' }
      })

      const { DELETE } = await import('@/app/api/admin/invite-codes/route')

      const response = await DELETE(
        createRequest('http://localhost:3000/api/admin/invite-codes')
      )

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toBe('Code ID is required')
    })

    it('returns 404 if code not found', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-1' }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: false,
          error: 'Invite code not found',
          error_code: 'NOT_FOUND'
        },
        error: null
      })

      const { DELETE } = await import('@/app/api/admin/invite-codes/route')

      const response = await DELETE(
        createRequest('http://localhost:3000/api/admin/invite-codes?id=123')
      )

      expect(response.status).toBe(404)
    })

    it('returns 400 if code already used', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-1' }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: false,
          error: 'Cannot revoke a used invite code',
          error_code: 'ALREADY_USED'
        },
        error: null
      })

      const { DELETE } = await import('@/app/api/admin/invite-codes/route')

      const response = await DELETE(
        createRequest('http://localhost:3000/api/admin/invite-codes?id=123')
      )

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Cannot revoke a used invite co')
    })

    it('successfully revokes code', async () => {
      requireAuthForApi.mockResolvedValue({
        profile: { is_app_admin: true },
        user: { id: 'admin-1' }
      })

      mockSupabase.rpc.mockResolvedValue({
        data: { success: true },
        error: null
      })

      const { DELETE } = await import('@/app/api/admin/invite-codes/route')

      const response = await DELETE(
        createRequest('http://localhost:3000/api/admin/invite-codes?id=123')
      )

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'revoke_player_invite_code',
        {
          p_invite_id: '123',
          p_reason: 'admin_revoked'
        }
      )
    })
  })
})
