import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockServiceIn: ReturnType<typeof vi.fn>
let mockGuildConfigGetBasic: ReturnType<typeof vi.fn>
let mockRequireGuildOfficerOrClusterLeader: ReturnType<typeof vi.fn>

describe('/api/webhooks/save', () => {
  let POST: (request: Request) => Promise<Response>
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockServiceIn = vi
      .fn()
      .mockImplementation(async (_column, ids: string[]) => ({
        data: ids.map((id) => ({
          id,
          webhook_url: 'https://discord.com/api/webhooks/1001/test-token'
        })),
        error: null
      }))
    mockGuildConfigGetBasic = vi.fn().mockResolvedValue(null)
    mockRequireGuildOfficerOrClusterLeader = vi.fn().mockResolvedValue({
      role: 'officer',
      guild_code: 'GUILD1',
      display_name: 'Officer'
    })

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getFull: vi.fn().mockResolvedValue(null),
        getBasic: mockGuildConfigGetBasic,
        exists: vi.fn().mockResolvedValue(false)
      }
    }))

    vi.doMock('@/app/lib/auth/guild-permissions', () => ({
      requireGuildOfficerOrClusterLeader: mockRequireGuildOfficerOrClusterLeader
    }))

    mockSupabase = {
      auth: {
        getUser: vi.fn()
      },
      from: vi.fn(),
      rpc: vi.fn()
    }
    mockSupabase.rpc.mockResolvedValue({
      data: { has_access: true },
      error: null
    })
    mockServiceSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
      rpc: vi.fn()
    }
    mockServiceSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnValue({ in: mockServiceIn })
    })

    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)

    const routeModule = await import('@/app/api/webhooks/save/route')
    POST = routeModule.POST
    GET = routeModule.GET
  })

  describe('POST /api/webhooks/save', () => {
    describe('authentication', () => {
      it('returns error when not authenticated', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'leaderboard',
            guild_code: 'GUILD1'
          })
        })

        const response = await POST(request)
        const body = await response.json()

        expect(body.error).toBeDefined()
        expect(body.error.code).toBe(1004)
      })
    })

    describe('validation', () => {
      beforeEach(() => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
      })

      it('returns error when webhook_type is missing', async () => {
        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: 'GUILD1'
          })
        })

        const response = await POST(request)
        const body = await response.json()

        expect(body.error).toBeDefined()
        expect(body.error.code).toBe(2001)
      })

      it('returns 400 when neither guild_code nor cluster_id provided', async () => {
        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'leaderboard'
          })
        })

        const response = await POST(request)

        expect(response.status).toBe(400)
      })
    })

    describe('permission checks - guild webhooks', () => {
      beforeEach(() => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
      })

      it('returns 403 when user is not an officer/leader of the guild', async () => {
        const { Errors } = await import('@/app/lib/errors/AppError')
        mockRequireGuildOfficerOrClusterLeader.mockRejectedValue(
          Errors.forbidden(
            'You must be an officer/leader of this guild or a cluster leader to perform this action',
            { endpoint: '/api/webhooks/save', guild_code: 'GUILD1' }
          )
        )
        const mockPlayerMapping = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role: 'member', guild_code: 'GUILD1' },
            error: null
          })
        }

        mockSupabase.from.mockReturnValue(mockPlayerMapping)

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'leaderboard',
            guild_code: 'GUILD1'
          })
        })

        const response = await POST(request)

        expect(response.status).toBe(403)
        expect(mockRequireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
          mockSupabase,
          'user-123',
          'GUILD1',
          '/api/webhooks/save'
        )
      })

      it('allows officer to manage guild webhooks', async () => {
        const insertSelect = vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({
            data: { id: 'new-webhook', webhook_type: 'leaderboard' },
            error: null
          })
        })
        const mockPlayerMapping = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role: 'officer', guild_code: 'GUILD1' },
            error: null
          })
        }
        const mockWebhookQuery = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi
            .fn()
            .mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
        }
        const mockInsertQuery = {
          insert: vi.fn().mockReturnThis(),
          select: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { id: 'new-webhook', webhook_type: 'leaderboard' },
            error: null
          })
        }
        const mockGuildUpdate = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          update: vi.fn().mockReturnThis(),
          limit: vi.fn().mockResolvedValue({ data: [], error: null })
        }

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') return mockPlayerMapping
          if (table === 'webhook_config') {
            return {
              ...mockWebhookQuery,
              ...mockInsertQuery,
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi
                .fn()
                .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
              insert: vi.fn().mockReturnValue({
                select: insertSelect
              }),
              limit: vi.fn().mockResolvedValue({ data: [], error: null })
            }
          }
          if (table === 'guild_config') return mockGuildUpdate
          return mockWebhookQuery
        })

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'leaderboard',
            webhook_url: 'https://discord.com/api/webhooks/123/abc',
            guild_code: 'GUILD1'
          })
        })

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.webhook.webhook_url).toBe(
          'https://discord.com/api/webhooks/123/abc'
        )
        expect(insertSelect).toHaveBeenCalledWith(
          expect.not.stringContaining('webhook_url')
        )
        expect(insertSelect).not.toHaveBeenCalledWith('*')
        expect(insertSelect).not.toHaveBeenCalledWith()
        expect(mockRequireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
          mockSupabase,
          'user-123',
          'GUILD1',
          '/api/webhooks/save'
        )
      })
    })

    describe('proactive token management access', () => {
      beforeEach(() => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
      })

      it('returns 403 when proactive token management alpha access is missing', async () => {
        mockSupabase.rpc.mockResolvedValue({
          data: { has_access: false },
          error: null
        })

        const mockPlayerMapping = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role: 'officer', guild_code: 'GUILD1' },
            error: null
          })
        }

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') return mockPlayerMapping
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'token_cap_notification',
            webhook_url: 'https://discord.com/api/webhooks/123/abc',
            guild_code: 'GUILD1'
          })
        })

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(403)
        expect(body.error.message).toContain('currently in alpha')
        expect(mockSupabase.rpc).toHaveBeenCalledWith('check_feature_access', {
          p_user_id: 'user-123',
          p_feature_key: 'proactive_token_management'
        })
      })
    })

    describe('permission checks - cluster webhooks', () => {
      beforeEach(() => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
      })

      it('returns 403 when user is not a leader for cluster webhooks', async () => {
        const mockPlayerMapping = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: {
              role: 'officer',
              guild_code: 'GUILD1',
              is_app_admin: false
            },
            error: null
          })
        }

        mockSupabase.from.mockReturnValue(mockPlayerMapping)

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'leaderboard',
            cluster_id: 'cluster-1'
          })
        })

        const response = await POST(request)

        expect(response.status).toBe(403)
        expect(mockRequireGuildOfficerOrClusterLeader).not.toHaveBeenCalled()
      })

      it('returns 403 when cluster webhook caller has no current profile', async () => {
        const mockPlayerMapping = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({
            data: null,
            error: null
          })
        }

        mockSupabase.from.mockReturnValue(mockPlayerMapping)

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'leaderboard',
            cluster_id: 'cluster-1'
          })
        })

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(403)
        expect(body.error.message).toContain(
          'Only cluster leaders can manage cluster webhooks'
        )
        expect(mockRequireGuildOfficerOrClusterLeader).not.toHaveBeenCalled()
      })
    })

    describe('webhook creation and update', () => {
      beforeEach(() => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
      })

      it('normalizes empty webhook_url to null', async () => {
        let insertData: Record<string, unknown> | null = null

        const mockPlayerMapping = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role: 'officer', guild_code: 'GUILD1' },
            error: null
          })
        }

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') return mockPlayerMapping
          if (table === 'webhook_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi
                .fn()
                .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
              insert: vi
                .fn()
                .mockImplementation((data: Record<string, unknown>) => {
                  insertData = data
                  return {
                    select: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: { id: 'new-webhook', ...data },
                        error: null
                      })
                    })
                  }
                }),
              limit: vi.fn().mockResolvedValue({ data: [], error: null })
            }
          }
          if (table === 'guild_config') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'leaderboard',
            webhook_url: '   ',
            guild_code: 'GUILD1'
          })
        })

        await POST(request)

        expect(insertData).not.toBeNull()
        expect(insertData!.webhook_url).toBeNull()
      })

      it('stores the canonical (lower-cased scheme/host) webhook URL', async () => {
        let insertData: Record<string, unknown> | null = null

        const mockPlayerMapping = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role: 'officer', guild_code: 'GUILD1' },
            error: null
          })
        }

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') return mockPlayerMapping
          if (table === 'webhook_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi
                .fn()
                .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
              insert: vi
                .fn()
                .mockImplementation((data: Record<string, unknown>) => {
                  insertData = data
                  return {
                    select: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: { id: 'new-webhook', ...data },
                        error: null
                      })
                    })
                  }
                }),
              limit: vi.fn().mockResolvedValue({ data: [], error: null })
            }
          }
          if (table === 'guild_config') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'leaderboard',
            webhook_url: '  HTTPS://DISCORD.COM/api/webhooks/123/Tok-EN  ',
            guild_code: 'GUILD1'
          })
        })

        await POST(request)

        expect(insertData).not.toBeNull()
        expect(insertData!.webhook_url).toBe(
          'https://discord.com/api/webhooks/123/Tok-EN'
        )
      })

      it('defaults diagnostic_messages webhook to disabled when enabled is omitted', async () => {
        let insertData: Record<string, unknown> | null = null

        const mockPlayerMapping = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role: 'officer', guild_code: 'GUILD1' },
            error: null
          })
        }

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') return mockPlayerMapping
          if (table === 'webhook_config') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi
                .fn()
                .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
              insert: vi
                .fn()
                .mockImplementation((data: Record<string, unknown>) => {
                  insertData = data
                  return {
                    select: vi.fn().mockReturnValue({
                      single: vi.fn().mockResolvedValue({
                        data: { id: 'diag-webhook', ...data },
                        error: null
                      })
                    })
                  }
                }),
              limit: vi.fn().mockResolvedValue({ data: [], error: null })
            }
          }
          if (table === 'guild_config') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'diagnostic_messages',
            webhook_url: 'https://discord.com/api/webhooks/123/abc',
            guild_code: 'GUILD1'
          })
        })

        await POST(request)

        expect(insertData).not.toBeNull()
        expect(insertData!.enabled).toBe(false)
      })

      it('normalizes legacy proactive webhook type to token_cap_notification on insert', async () => {
        let insertData: Record<string, unknown> | null = null

        const mockPlayerMapping = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role: 'officer', guild_code: 'GUILD1' },
            error: null
          })
        }

        const webhookFilters: Record<string, unknown> = {}
        const webhookConfigQuery = {
          select: vi.fn().mockReturnThis(),
          eq: vi
            .fn()
            .mockImplementation(
              (column: string, value: string | number | boolean | null) => {
                webhookFilters[column] = value
                return webhookConfigQuery
              }
            ),
          single: vi
            .fn()
            .mockResolvedValue({ data: null, error: { code: 'PGRST116' } }),
          insert: vi
            .fn()
            .mockImplementation((data: Record<string, unknown>) => {
              insertData = data
              return {
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({
                    data: { id: 'new-webhook', ...data },
                    error: null
                  })
                })
              }
            }),
          limit: vi.fn().mockResolvedValue({
            data: [{ id: 'enabled-webhook' }],
            error: null
          })
        }

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') return mockPlayerMapping
          if (table === 'webhook_config') return webhookConfigQuery
          if (table === 'guild_config') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'token_cap_alerts',
            webhook_url: 'https://discord.com/api/webhooks/123/abc',
            guild_code: 'GUILD1'
          })
        })

        const response = await POST(request)

        expect(response.status).toBe(200)
        expect(insertData).not.toBeNull()
        expect(insertData!.webhook_type).toBe('token_cap_notification')
        expect(webhookFilters.webhook_type).toBe('token_cap_alerts')
      })

      it('upgrades existing legacy proactive webhook rows to token_cap_notification on update', async () => {
        let updateData: Record<string, unknown> | null = null

        const mockPlayerMapping = {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role: 'officer', guild_code: 'GUILD1' },
            error: null
          })
        }

        const webhookFilters: Record<string, unknown> = {}
        const webhookConfigQuery = {
          select: vi.fn().mockReturnThis(),
          eq: vi
            .fn()
            .mockImplementation(
              (column: string, value: string | number | boolean | null) => {
                webhookFilters[column] = value
                return webhookConfigQuery
              }
            ),
          single: vi.fn().mockImplementation(async () => {
            if (webhookFilters.webhook_type === 'token_cap_notification') {
              return { data: null, error: { code: 'PGRST116' } }
            }
            if (webhookFilters.webhook_type === 'token_cap_alerts') {
              return {
                data: {
                  id: 'legacy-webhook',
                  webhook_type: 'token_cap_alerts'
                },
                error: null
              }
            }
            return { data: null, error: { code: 'PGRST116' } }
          }),
          update: vi
            .fn()
            .mockImplementation((data: Record<string, unknown>) => {
              updateData = data
              return {
                eq: vi.fn().mockReturnValue({
                  select: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({
                      data: { id: 'legacy-webhook', ...data },
                      error: null
                    })
                  })
                })
              }
            }),
          limit: vi.fn().mockResolvedValue({
            data: [{ id: 'enabled-webhook' }],
            error: null
          })
        }

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') return mockPlayerMapping
          if (table === 'webhook_config') return webhookConfigQuery
          if (table === 'guild_config') {
            return {
              update: vi.fn().mockReturnThis(),
              eq: vi.fn().mockResolvedValue({ error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'token_cap_notification',
            webhook_url: 'https://discord.com/api/webhooks/123/abc',
            guild_code: 'GUILD1'
          })
        })

        const response = await POST(request)

        expect(response.status).toBe(200)
        expect(updateData).not.toBeNull()
        expect(updateData!.webhook_type).toBe('token_cap_notification')
      })
    })
  })

  describe('GET /api/webhooks/save', () => {
    describe('authentication', () => {
      it('returns error when not authenticated', async () => {
        mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

        const request = new Request('http://localhost/api/webhooks/save', {
          method: 'GET'
        })

        const response = await GET(request)
        const body = await response.json()

        expect(body.error).toBeDefined()
        expect(body.error.code).toBe(1004)
      })
    })

    describe('fetching webhooks', () => {
      beforeEach(() => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
      })

      it('returns webhooks filtered by guild_code query param', async () => {
        const mockWebhooks = [
          { id: '1', webhook_type: 'leaderboard', guild_code: 'GUILD1' },
          { id: '2', webhook_type: 'sync_status', guild_code: 'GUILD1' }
        ]

        const webhookConfigQuery = {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: mockWebhooks, error: null })
        }

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { role: 'officer', guild_code: 'GUILD1' },
                error: null
              })
            }
          }
          if (table === 'webhook_config') return webhookConfigQuery
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const request = new Request(
          'http://localhost/api/webhooks/save?guild_code=GUILD1',
          {
            method: 'GET'
          }
        )

        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.success).toBe(true)
        expect(body.webhooks).toHaveLength(2)
        expect(webhookConfigQuery.select).toHaveBeenCalledWith(
          expect.not.stringContaining('webhook_url')
        )
        expect(webhookConfigQuery.select).not.toHaveBeenCalledWith('*')
        expect(webhookConfigQuery.select).not.toHaveBeenCalledWith()
        expect(mockServiceIn).toHaveBeenCalledWith('id', ['1', '2'])
        expect(body.webhooks[0].webhook_url).toBe(
          'https://discord.com/api/webhooks/1001/test-token'
        )
      })

      it('returns 403 before reading webhook_config for unauthorized explicit guild scope', async () => {
        const { Errors } = await import('@/app/lib/errors/AppError')
        mockRequireGuildOfficerOrClusterLeader.mockRejectedValue(
          Errors.forbidden(
            'You must be an officer/leader of this guild or a cluster leader to perform this action',
            { endpoint: '/api/webhooks/save', guild_code: 'VICTIM' }
          )
        )
        const webhookConfigQuery = {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: [
              {
                id: '1',
                webhook_type: 'leaderboard',
                guild_code: 'VICTIM',
                webhook_url: 'https://discord.com/api/webhooks/secret/token'
              }
            ],
            error: null
          })
        }

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { role: 'member', guild_code: 'GUILD1' },
                error: null
              }),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { role: 'member', guild_code: 'GUILD1' },
                error: null
              })
            }
          }
          if (table === 'webhook_config') return webhookConfigQuery
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const request = new Request(
          'http://localhost/api/webhooks/save?guild_code=VICTIM',
          {
            method: 'GET'
          }
        )

        const response = await GET(request)

        expect(response.status).toBe(403)
        expect(webhookConfigQuery.select).not.toHaveBeenCalled()
        expect(mockCreateServiceClient).not.toHaveBeenCalled()
        expect(mockRequireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
          mockSupabase,
          'user-123',
          'VICTIM',
          '/api/webhooks/save'
        )
      })

      it('returns webhooks filtered by cluster_id query param', async () => {
        const mockWebhooks = [
          { id: '1', webhook_type: 'leaderboard', cluster_id: 'cluster-1' }
        ]

        mockGuildConfigGetBasic.mockResolvedValue({
          guild_code: 'GUILD1',
          cluster_code: 'EOT'
        })

        const webhookConfigQuery = {
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({ data: mockWebhooks, error: null })
        }

        mockSupabase.from.mockImplementation((table: string) => {
          if (table === 'player_mapping') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              maybeSingle: vi.fn().mockResolvedValue({
                data: { role: 'leader', guild_code: 'GUILD1' },
                error: null
              })
            }
          }
          if (table === 'clusters') {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              single: vi.fn().mockResolvedValue({
                data: { cluster_code: 'EOT' },
                error: null
              })
            }
          }
          if (table === 'webhook_config') return webhookConfigQuery
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis()
          }
        })

        const request = new Request(
          'http://localhost/api/webhooks/save?cluster_id=cluster-1',
          {
            method: 'GET'
          }
        )

        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.webhooks).toHaveLength(1)
      })

      it.each(['http://localhost/api/webhooks/save'])(
        'requires explicit guild or cluster scope before any table query: %s',
        async (requestUrl) => {
          const response = await GET(new Request(requestUrl, { method: 'GET' }))
          const body = await response.json()

          expect(response.status).toBe(400)
          expect(body.error.message).toContain(
            'Either guild_code or cluster_id must be provided'
          )
          expect(mockSupabase.from).not.toHaveBeenCalled()
          expect(mockGuildConfigGetBasic).not.toHaveBeenCalled()
          expect(mockCreateServiceClient).not.toHaveBeenCalled()
        }
      )
    })

    describe('error handling', () => {
      beforeEach(() => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } }
        })
      })

      it('returns error response on database failure', async () => {
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          order: vi.fn().mockReturnThis(),
          eq: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Database error' }
          })
        })

        const request = new Request(
          'http://localhost/api/webhooks/save?guild_code=GUILD1',
          {
            method: 'GET'
          }
        )

        const response = await GET(request)
        const body = await response.json()

        // legacyError FETCH_FAILED maps to 502 and normalizes to EXTERNAL_SERVICE_FAILURE (5004).
        expect(response.status).toBe(502)
        expect(body.error).toBeDefined()
        expect(body.error.code).toBe(5004) // EXTERNAL_SERVICE_FAILURE code
      })
    })
  })
})
