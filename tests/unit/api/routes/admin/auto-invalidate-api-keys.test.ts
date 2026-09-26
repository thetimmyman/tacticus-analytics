import { describe, it, expect, vi, beforeEach } from 'vitest'

// Touches every guild's config, so it gates on app admin, not guild rank.
let mockRequireActiveMembership: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>

const GUILD_LEADER_NOT_APP_ADMIN = {
  user: { id: 'leader-1', role: 'leader' },
  profile: { user_id: 'leader-1', role: 'leader', is_app_admin: false }
}

const APP_ADMIN = {
  user: { id: 'admin-1', role: 'member' },
  profile: { user_id: 'admin-1', role: 'member', is_app_admin: true }
}

describe('Auto Invalidate API Keys', () => {
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockRequireActiveMembership = vi.fn()
    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireActiveMembershipForApi: mockRequireActiveMembership
      }
    })

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn()
      }
    }))

    mockSupabase = {
      from: vi.fn()
    }
    mockServiceSupabase = {
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)
  })

  describe('POST /api/admin/auto-invalidate-api-keys', () => {
    let POST: () => Promise<Response>

    beforeEach(async () => {
      const routeModule =
        await import('@/app/api/admin/auto-invalidate-api-keys/route')
      POST = routeModule.POST
    })

    it('rejects a guild leader who is not an app admin with 403', async () => {
      mockRequireActiveMembership.mockResolvedValue(GUILD_LEADER_NOT_APP_ADMIN)

      const response = await POST()

      expect(response.status).toBe(403)
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('lets an app admin through', async () => {
      mockRequireActiveMembership.mockResolvedValue(APP_ADMIN)
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const response = await POST()

      expect(response.status).toBe(200)
      expect(mockSupabase.from).toHaveBeenCalledWith('guild_config')
    })

    it('returns 500 when the caller cannot be resolved', async () => {
      mockRequireActiveMembership.mockRejectedValue(new Error('Not authorized'))

      const response = await POST()
      expect(response.status).toBe(500)
    })

    it('returns 500 when query fails', async () => {
      mockRequireActiveMembership.mockResolvedValue(APP_ADMIN)

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        or: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: 'Query failed' } })
      })

      const response = await POST()
      expect(response.status).toBe(500)
    })

    it('returns success with no updates when no problematic guilds', async () => {
      mockRequireActiveMembership.mockResolvedValue(APP_ADMIN)

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const response = await POST()
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.updates).toHaveLength(0)
      expect(body.message).toContain('0 API keys')
    })

    it('invalidates guilds with 5+ failures and valid key', async () => {
      mockRequireActiveMembership.mockResolvedValue(APP_ADMIN)

      const problematicGuilds = [
        {
          guild_code: 'GUILD1',
          display_name: 'Guild One',
          consecutive_sync_failures: 5,
          api_key_is_valid: true,
          api_key_last_validated: null,
          last_successful_sync: null
        }
      ]

      const updateMock = vi.fn().mockReturnThis()
      const inMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: problematicGuilds, error: null })
      }))
      mockServiceSupabase.from.mockImplementation(() => ({
        update: updateMock,
        in: inMock
      }))

      const response = await POST()
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.success).toBe(true)
      expect(body.updates).toHaveLength(1)
      expect(body.updates[0].guild_code).toBe('GUILD1')
      expect(body.updates[0].action).toBe('invalidated_due_to_failures')
    })

    it('invalidates guilds with 10+ failures and null valid status', async () => {
      mockRequireActiveMembership.mockResolvedValue(APP_ADMIN)

      const problematicGuilds = [
        {
          guild_code: 'GUILD2',
          display_name: 'Guild Two',
          consecutive_sync_failures: 10,
          api_key_is_valid: null,
          api_key_last_validated: null,
          last_successful_sync: null
        }
      ]

      const updateMock = vi.fn().mockReturnThis()
      const inMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: problematicGuilds, error: null })
      }))
      mockServiceSupabase.from.mockImplementation(() => ({
        update: updateMock,
        in: inMock
      }))

      const response = await POST()
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.updates).toHaveLength(1)
      expect(body.updates[0].guild_code).toBe('GUILD2')
      expect(body.updates[0].previous_status).toBeNull()
    })

    it('performs the cross-guild update on the service client, not the RLS-bound one', async () => {
      // RLS would filter an app admin's update to zero rows, so the write is privileged.
      mockRequireActiveMembership.mockResolvedValue(APP_ADMIN)

      const problematicGuilds = [
        {
          guild_code: 'OTHERGUILD',
          display_name: 'Some Other Guild',
          consecutive_sync_failures: 9,
          api_key_is_valid: true,
          api_key_last_validated: null,
          last_successful_sync: null
        }
      ]

      const rlsUpdate = vi.fn()
      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: problematicGuilds, error: null }),
        update: rlsUpdate
      }))

      const serviceUpdate = vi.fn().mockReturnThis()
      const serviceIn = vi.fn().mockResolvedValue({ error: null })
      mockServiceSupabase.from.mockImplementation(() => ({
        update: serviceUpdate,
        in: serviceIn
      }))

      const response = await POST()

      expect(response.status).toBe(200)
      expect(rlsUpdate).not.toHaveBeenCalled()
      expect(mockServiceSupabase.from).toHaveBeenCalledWith('guild_config')
      expect(serviceUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_is_valid: false,
          auto_sync_enabled: false
        })
      )
      expect(serviceIn).toHaveBeenCalledWith('guild_code', ['OTHERGUILD'])
    })

    it('returns 500 when update fails', async () => {
      mockRequireActiveMembership.mockResolvedValue(APP_ADMIN)

      const problematicGuilds = [
        {
          guild_code: 'GUILD1',
          display_name: 'Guild One',
          consecutive_sync_failures: 5,
          api_key_is_valid: true,
          api_key_last_validated: null,
          last_successful_sync: null
        }
      ]

      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: problematicGuilds, error: null })
      }))
      mockServiceSupabase.from.mockImplementation(() => ({
        update: vi.fn().mockReturnThis(),
        in: vi.fn().mockResolvedValue({ error: { message: 'Update failed' } })
      }))

      const response = await POST()
      expect(response.status).toBe(500)
    })

    it('handles multiple problematic guilds', async () => {
      mockRequireActiveMembership.mockResolvedValue(APP_ADMIN)

      const problematicGuilds = [
        {
          guild_code: 'GUILD1',
          display_name: 'Guild One',
          consecutive_sync_failures: 5,
          api_key_is_valid: true,
          api_key_last_validated: null,
          last_successful_sync: null
        },
        {
          guild_code: 'GUILD2',
          display_name: 'Guild Two',
          consecutive_sync_failures: 15,
          api_key_is_valid: null,
          api_key_last_validated: null,
          last_successful_sync: null
        },
        {
          guild_code: 'GUILD3',
          display_name: 'Guild Three',
          consecutive_sync_failures: 7,
          api_key_is_valid: true,
          api_key_last_validated: null,
          last_successful_sync: null
        }
      ]

      const inMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation(() => ({
        select: vi.fn().mockReturnThis(),
        or: vi.fn().mockResolvedValue({ data: problematicGuilds, error: null })
      }))
      mockServiceSupabase.from.mockImplementation(() => ({
        update: vi.fn().mockReturnThis(),
        in: inMock
      }))

      const response = await POST()
      expect(response.status).toBe(200)

      const body = await response.json()
      expect(body.updates).toHaveLength(3)
      expect(inMock).toHaveBeenCalledWith('guild_code', [
        'GUILD1',
        'GUILD2',
        'GUILD3'
      ])
    })
  })
})
