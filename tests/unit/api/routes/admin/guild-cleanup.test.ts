import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockRequireAppAdmin: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockSessionFrom: ReturnType<typeof vi.fn>
let mockRateLimit: ReturnType<typeof vi.fn>
let mockAddRateLimitHeaders: ReturnType<typeof vi.fn>
let POST: (request: NextRequest) => Promise<Response>

describe('POST /api/admin/guild-cleanup', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockRequireAppAdmin = vi.fn().mockResolvedValue({ user_id: 'app-admin-1' })
    // Cleanup writes run on the service client; the poisoned session client makes any session access fail loudly.
    mockSessionFrom = vi.fn(() => {
      throw new Error(
        'guild-cleanup must not touch tables via the RLS-bound session client'
      )
    })
    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockRateLimit = vi.fn().mockResolvedValue(undefined)
    mockAddRateLimitHeaders = vi.fn((response) => response)

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      requireAppAdmin: mockRequireAppAdmin
    }))

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      rateLimit: mockRateLimit,
      addRateLimitHeaders: mockAddRateLimitHeaders
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    }))

    vi.doMock('@tacticus/app-core/error-handler', () => ({
      createError: vi.fn((code, message) => new Error(`${code}: ${message}`))
    }))

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockCreateClient.mockResolvedValue({ from: mockSessionFrom })
    mockCreateServiceClient.mockReturnValue(mockSupabase)

    const routeModule = await import('@/app/api/admin/guild-cleanup/route')
    POST = routeModule.POST
  })

  it('returns 403 before cleanup work when caller is not an app admin', async () => {
    const { Errors } = await import('@/app/lib/errors/AppError')
    mockRequireAppAdmin.mockRejectedValue(
      Errors.forbidden('Admin access required')
    )

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { guild_code: 'LIVE', display_name: 'Live Guild', enabled: true },
        error: null
      }),
      delete: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
    })

    const request = new NextRequest(
      'http://localhost/api/admin/guild-cleanup',
      {
        method: 'POST',
        body: JSON.stringify({ action: 'delete_guild', guild_ids: [123] })
      }
    )

    const response = await POST(request)
    const body = await response.json()

    expect(response.status).toBe(403)
    expect(body.error.message).toBe('Admin access required')
    expect(mockSupabase.from).not.toHaveBeenCalled()
    expect(mockCreateServiceClient).not.toHaveBeenCalled()
  })

  it('returns 500 for invalid action type', async () => {
    const request = new NextRequest(
      'http://localhost/api/admin/guild-cleanup',
      {
        method: 'POST',
        body: JSON.stringify({ action: 'invalid_action' })
      }
    )

    const response = await POST(request)
    expect(response.status).toBe(500)
  })

  describe('service-authority regressions', () => {
    it('runs delete_guild with SERVICE authority — the RLS-bound session client is never used', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          guild_id: 42,
          guild_code: 'DEAD1',
          deleted_mapping_count: 3,
          deleted_invite_count: 1,
          revoked_attestations: 2,
          authority_cleared: true,
          guild_deleted: true
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'delete_guild', guild_ids: [42] })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].success).toBe(true)
      expect(mockCreateServiceClient).toHaveBeenCalled()
      expect(mockSupabase.rpc).toHaveBeenCalledWith('delete_player_guild', {
        p_guild_id: 42,
        p_reason: 'guild_delete',
        p_source: 'app.admin.guild-cleanup'
      })
      expect(mockSupabase.from).not.toHaveBeenCalled()
      // Session-side guarded writes fail with 42501 and RLS would silently no-op cleanup.
      expect(mockSessionFrom).not.toHaveBeenCalled()
    })

    it('still refuses protected-guild deletion under service authority (no RLS backstop remains)', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: false,
          error: 'Protected system guild cannot be deleted',
          error_code: 'PROTECTED_GUILD'
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'delete_guild', guild_ids: [1] })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].success).toBe(false)
      expect(body.results[0].error).toMatch(/protected/iu)
      expect(body.results[0].error_code).toBe('PROTECTED_GUILD')
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('still refuses deleting a CLAIMED player mapping under service authority', async () => {
      const deleteMock = vi.fn()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            player_id: 'player-9',
            user_id: 'claimed-user-1',
            display_name: 'Claimed Player'
          },
          error: null
        }),
        delete: deleteMock
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'fix_orphaned_players',
            player_ids: ['player-9']
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].success).toBe(false)
      expect(body.results[0].error).toContain('claimed account')
      expect(deleteMock).not.toHaveBeenCalled()
    })

    it('keeps the unclaimed-only (user_id IS NULL) filter on the service-authority player delete', async () => {
      const isMock = vi.fn().mockResolvedValue({ error: null })
      const deleteChain = {
        eq: vi.fn().mockReturnThis(),
        is: isMock
      }
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null }),
        delete: vi.fn().mockReturnValue(deleteChain)
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'fix_orphaned_players',
            player_ids: ['orphan-1']
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].success).toBe(true)
      // Without RLS this WHERE backstop alone stops a read-then-delete race on a claimed mapping.
      expect(isMock).toHaveBeenCalledWith('user_id', null)
      expect(mockSessionFrom).not.toHaveBeenCalled()
    })

    it('stamps INDEPENDENT for unassigned enabled guilds via service authority (guarded cluster_code write)', async () => {
      let updatePayload: Record<string, string> | null = null
      const updateMock = vi.fn((payload: Record<string, string>) => {
        updatePayload = payload
        return { eq: vi.fn().mockResolvedValue({ error: null }) }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            guild_code: 'LOST1',
            display_name: 'Lost Guild',
            enabled: true,
            cluster_code: null,
            cluster_id: null
          },
          error: null
        }),
        update: updateMock
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'clean_corrupted_data',
            guild_ids: [7]
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].success).toBe(true)
      expect(updatePayload).toEqual({ cluster_code: 'INDEPENDENT' })
      expect(mockSessionFrom).not.toHaveBeenCalled()
    })
  })

  describe('delete_guild action', () => {
    it('deletes guild successfully', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          guild_id: 123,
          guild_code: 'TEST1',
          deleted_mapping_count: 2,
          deleted_invite_count: 1,
          revoked_attestations: 1,
          authority_cleared: true,
          guild_deleted: true
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'delete_guild', guild_ids: [123] })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.action).toBe('delete_guild')
      expect(body.results[0]).toMatchObject({
        success: true,
        deleted_mapping_count: 2,
        deleted_invite_count: 1,
        revoked_attestations: 1
      })
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('prevents deletion of protected guilds', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: false,
          error: 'Protected system guild cannot be deleted',
          error_code: 'PROTECTED_GUILD'
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'delete_guild', guild_ids: [1] })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].success).toBe(false)
      expect(body.results[0].error).toMatch(/protected/iu)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('returns error when guild not found', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: false,
          error: 'Guild not found',
          error_code: 'NOT_FOUND'
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'delete_guild', guild_ids: [999] })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].success).toBe(false)
      expect(body.results[0].error).toBe('Guild not found')
      expect(body.results[0].error_code).toBe('NOT_FOUND')
    })

    it('fails closed when the owner RPC returns a partial success proof', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: {
          success: true,
          guild_id: 123,
          guild_code: 'PARTIAL',
          guild_deleted: true
        },
        error: null
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'delete_guild', guild_ids: [123] })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0]).toEqual({
        guild_id: 123,
        success: false,
        error: 'Guild deletion returned an invalid proof'
      })
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })
  })

  describe('fix_orphaned_players action', () => {
    it('removes orphaned player mappings', async () => {
      mockSupabase.from.mockReturnValue({
        delete: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnThis()
        })
      })

      const deleteMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      })

      mockSupabase.from.mockReturnValue({
        delete: deleteMock
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'fix_orphaned_players',
            player_ids: ['player-1', 'player-2']
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.action).toBe('fix_orphaned_players')
    })
  })

  describe('merge_guilds action', () => {
    it('returns not implemented error', async () => {
      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'merge_guilds',
            source_guild_id: 1,
            target_guild_id: 2
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].success).toBe(false)
      expect(body.results[0].error).toContain('not yet implemented')
    })
  })

  describe('clean_corrupted_data action', () => {
    it('fixes guild with missing display name', async () => {
      const selectMock = vi.fn().mockReturnThis()
      const eqMock = vi.fn().mockReturnThis()
      const singleMock = vi.fn().mockResolvedValue({
        data: {
          id: 1,
          guild_code: 'TEST1',
          display_name: '',
          enabled: true,
          cluster_code: 'EOT',
          cluster_id: 'cluster-1'
        },
        error: null
      })
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })

      mockSupabase.from.mockReturnValue({
        select: selectMock,
        eq: eqMock,
        single: singleMock,
        update: updateMock
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'clean_corrupted_data',
            guild_ids: [1]
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.results[0].success).toBe(true)
    })

    it('reports no corruption when guild is clean', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 1,
            guild_code: 'TEST1',
            display_name: 'Valid Name',
            enabled: true,
            cluster_code: 'EOT',
            cluster_id: 'cluster-1'
          },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'clean_corrupted_data',
            guild_ids: [1]
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].success).toBe(true)
      expect(body.results[0].message).toContain('No corruption found')
    })
  })

  describe('validation', () => {
    it('rejects guild_ids exceeding max limit', async () => {
      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({
            action: 'delete_guild',
            guild_ids: Array.from({ length: 15 }, (_, i) => i + 1)
          })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(500)
    })

    it('rejects empty guild_ids array', async () => {
      const request = new NextRequest(
        'http://localhost/api/admin/guild-cleanup',
        {
          method: 'POST',
          body: JSON.stringify({ action: 'delete_guild', guild_ids: [] })
        }
      )

      const response = await POST(request)
      expect(response.status).toBe(500)
    })
  })
})
