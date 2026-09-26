import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockFormatTokenCapAlert: ReturnType<typeof vi.fn>
let mockPostToWebhook: ReturnType<typeof vi.fn>
let mockLogDiscordWebhookDelivery: ReturnType<typeof vi.fn>
let mockLoadGuildTokenStatuses: ReturnType<typeof vi.fn>
let mockValidateWebhookManagementAccess: ReturnType<typeof vi.fn>
let mockGuildConfigServiceGetBasic: ReturnType<typeof vi.fn>

describe('POST /api/discord-webhooks/cap-notification', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockFormatTokenCapAlert = vi.fn()
    mockPostToWebhook = vi.fn()
    mockLogDiscordWebhookDelivery = vi.fn()
    mockLoadGuildTokenStatuses = vi.fn()
    mockValidateWebhookManagementAccess = vi.fn()
    mockGuildConfigServiceGetBasic = vi
      .fn()
      .mockResolvedValue({ display_name: 'Test Guild' })

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))
    vi.doMock('@/app/lib/discord/formatters', () => ({
      formatTokenCapAlert: mockFormatTokenCapAlert
    }))
    vi.doMock('@/app/lib/discord/webhook-service', () => ({
      postToWebhook: mockPostToWebhook,
      logDiscordWebhookDelivery: mockLogDiscordWebhookDelivery
    }))
    vi.doMock('@/app/api/guild-tokens/token-service', () => ({
      loadGuildTokenStatuses: mockLoadGuildTokenStatuses
    }))
    vi.doMock('@/app/lib/utils/cluster-validation', () => ({
      validateWebhookManagementAccess: mockValidateWebhookManagementAccess
    }))
    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getBasic: mockGuildConfigServiceGetBasic
      }
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))
    vi.doMock('@tacticus/app-core/api-errors', () => ({
      createErrorResponse: vi.fn().mockImplementation((code, message, opts) => {
        const status =
          code === 'UNAUTHORIZED'
            ? 401
            : code === 'USER_NOT_FOUND'
              ? 404
              : code === 'INSUFFICIENT_PERMISSIONS'
                ? 403
                : code === 'RATE_LIMITED'
                  ? 429
                  : code === 'WEBHOOK_NOT_CONFIGURED'
                    ? 503
                    : 400
        return new Response(JSON.stringify({ error: { code, message } }), {
          status
        })
      }),
      createSuccessResponse: vi.fn().mockImplementation((data, message) => {
        return new Response(JSON.stringify({ data, message }), { status: 200 })
      }),
      ErrorCode: {
        UNAUTHORIZED: 'UNAUTHORIZED',
        USER_NOT_FOUND: 'USER_NOT_FOUND',
        DATABASE_ERROR: 'DATABASE_ERROR',
        INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
        INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT',
        WEBHOOK_NOT_CONFIGURED: 'WEBHOOK_NOT_CONFIGURED',
        RATE_LIMITED: 'RATE_LIMITED',
        DISCORD_WEBHOOK_INVALID: 'DISCORD_WEBHOOK_INVALID',
        EXTERNAL_API_ERROR: 'EXTERNAL_API_ERROR',
        NOTIFICATION_SEND_FAILED: 'NOTIFICATION_SEND_FAILED'
      }
    }))

    mockSupabase = {
      auth: {
        getUser: vi.fn()
      },
      from: vi.fn(),
      rpc: vi.fn().mockResolvedValue({ data: '83', error: null })
    }
    mockServiceSupabase = {
      from: vi.fn()
    }
    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)
    mockLoadGuildTokenStatuses.mockResolvedValue({
      players: [],
      debug: {
        total_battles: 0,
        current_season_battles: 0,
        previous_season_battles: 0,
        seasons_checked: ['83']
      }
    })

    const routeModule =
      await import('@/app/api/discord-webhooks/cap-notification/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createRequest = (body: object) => {
    return new NextRequest(
      'http://localhost/api/discord-webhooks/cap-notification',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      }
    )
  }

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(401)
    })
  })

  describe('authorization', () => {
    it('returns 404 when no active guild membership found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' }
        })
      })

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(404)
    })

    it('returns 403 when user is not officer or leader', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'member', guild_code: 'TEST' },
          error: null
        })
      })

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(403)
    })

    // SQL compares `lower(pm.role)`, so a stored `Officer` is a real officer.
    it.each(['Officer', 'Leader'])(
      'admits a caller stored as %s past the role gate',
      async (role) => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user123' } }
        })
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role, guild_code: 'MYGUILD' },
            error: null
          })
        })
        mockValidateWebhookManagementAccess.mockResolvedValue({
          valid: false,
          error: 'Not in same cluster'
        })

        const request = createRequest({ guild_code: 'OTHERGUILD' })
        const response = await POST(request)

        // Reaching the cluster check proves the role gate passed.
        expect(mockValidateWebhookManagementAccess).toHaveBeenCalled()
        expect(response.status).toBe(403)
      }
    )

    it('returns 403 for a caller stored as `Member`', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'Member', guild_code: 'TEST' },
          error: null
        })
      })

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(403)
      expect(mockValidateWebhookManagementAccess).not.toHaveBeenCalled()
    })

    it('validates cluster access for cross-guild posting', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'MYGUILD' },
          error: null
        })
      })
      mockValidateWebhookManagementAccess.mockResolvedValue({
        valid: false,
        error: 'Not in same cluster'
      })

      const request = createRequest({ guild_code: 'OTHERGUILD' })
      const response = await POST(request)

      expect(response.status).toBe(403)
      expect(mockValidateWebhookManagementAccess).toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('returns 400 for invalid JSON body', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: 'TEST' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/discord-webhooks/cap-notification',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'invalid-json'
        }
      )
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('no battles case', () => {
    it('returns success with empty capped_players when no battles found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { role: 'leader', guild_code: 'TEST' },
              error: null
            })
          }
        }
        if (table === 'EOT_GR_data') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockReturnThis(),
            limit: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: { Season: '83' }, error: null })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          order: vi.fn().mockResolvedValue({ data: [], error: null })
        }
      })

      const request = createRequest({})
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.capped_players).toEqual([])
    })
  })

  describe('no capped players case', () => {
    it('returns success with empty capped_players when no players at cap', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })

      let eotGrCallCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { role: 'leader', guild_code: 'TEST' },
              error: null
            })
          }
        }
        if (table === 'EOT_GR_data') {
          eotGrCallCount++
          if (eotGrCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { Season: '83' }, error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  displayName: 'Player1',
                  damageType: 'prime',
                  startedOn: new Date().toISOString()
                }
              ],
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            display_name: 'Player1',
            player_id: 'player-1',
            tokens_available: 2,
            last_battle_time: new Date().toISOString()
          }
        ],
        debug: {
          total_battles: 1,
          current_season_battles: 1,
          previous_season_battles: 0,
          seasons_checked: ['83']
        }
      })

      const request = createRequest({})
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.capped_players).toEqual([])
    })
  })

  describe('webhook configuration', () => {
    it('returns 503 when no webhook configured', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })

      let eotGrCallCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { role: 'leader', guild_code: 'TEST' },
              error: null
            })
          }
        }
        if (table === 'EOT_GR_data') {
          eotGrCallCount++
          if (eotGrCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { Season: '83' }, error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  displayName: 'Player1',
                  damageType: 'prime',
                  startedOn: new Date().toISOString()
                }
              ],
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            display_name: 'Player1',
            player_id: 'player-1',
            tokens_available: 3,
            last_battle_time: new Date().toISOString()
          }
        ],
        debug: {
          total_battles: 1,
          current_season_battles: 1,
          previous_season_battles: 0,
          seasons_checked: ['83']
        }
      })

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(503)
    })
  })

  describe('successful posting', () => {
    it('posts cap notification successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })

      let eotGrCallCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { role: 'leader', guild_code: 'TEST' },
              error: null
            })
          }
        }
        if (table === 'EOT_GR_data') {
          eotGrCallCount++
          if (eotGrCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { Season: '83' }, error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  displayName: 'Player1',
                  damageType: 'prime',
                  startedOn: new Date().toISOString()
                }
              ],
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://discord.com/api/webhooks/123/token'
              },
              error: null
            })
          }
        }
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { display_name: 'Test Guild' },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            display_name: 'Player1',
            player_id: 'player-1',
            tokens_available: 3,
            last_battle_time: new Date().toISOString()
          }
        ],
        debug: {
          total_battles: 1,
          current_season_battles: 1,
          previous_season_battles: 0,
          seasons_checked: ['83']
        }
      })
      mockFormatTokenCapAlert.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({ ok: true })

      const request = createRequest({})
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.success).toBe(true)
      expect(body.data.capped_players).toHaveLength(1)
    })
  })

  describe('Discord API errors', () => {
    it('handles rate limiting', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })

      let eotGrCallCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { role: 'leader', guild_code: 'TEST' },
              error: null
            })
          }
        }
        if (table === 'EOT_GR_data') {
          eotGrCallCount++
          if (eotGrCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { Season: '83' }, error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  displayName: 'Player1',
                  damageType: 'prime',
                  startedOn: new Date().toISOString()
                }
              ],
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://discord.com/api/webhooks/123/token'
              },
              error: null
            })
          }
        }
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { display_name: 'Test Guild' },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            display_name: 'Player1',
            player_id: 'player-1',
            tokens_available: 3,
            last_battle_time: new Date().toISOString()
          }
        ],
        debug: {
          total_battles: 1,
          current_season_battles: 1,
          previous_season_battles: 0,
          seasons_checked: ['83']
        }
      })
      mockFormatTokenCapAlert.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({
        ok: false,
        error: { type: 'rate_limited' }
      })

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(429)
    })

    it('handles invalid webhook (404)', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })

      let eotGrCallCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { role: 'leader', guild_code: 'TEST' },
              error: null
            })
          }
        }
        if (table === 'EOT_GR_data') {
          eotGrCallCount++
          if (eotGrCallCount === 1) {
            return {
              select: vi.fn().mockReturnThis(),
              eq: vi.fn().mockReturnThis(),
              order: vi.fn().mockReturnThis(),
              limit: vi.fn().mockReturnThis(),
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: { Season: '83' }, error: null })
            }
          }
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({
              data: [
                {
                  displayName: 'Player1',
                  damageType: 'prime',
                  startedOn: new Date().toISOString()
                }
              ],
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                webhook_url: 'https://discord.com/api/webhooks/123/token'
              },
              error: null
            })
          }
        }
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { display_name: 'Test Guild' },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            display_name: 'Player1',
            player_id: 'player-1',
            tokens_available: 3,
            last_battle_time: new Date().toISOString()
          }
        ],
        debug: {
          total_battles: 1,
          current_season_battles: 1,
          previous_season_battles: 0,
          seasons_checked: ['83']
        }
      })
      mockFormatTokenCapAlert.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({
        ok: false,
        status: 404,
        error: { type: 'invalid_webhook' }
      })

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('error handling', () => {
    it('handles unexpected errors gracefully', async () => {
      mockCreateClient.mockRejectedValue(
        new Error('Database connection failed')
      )

      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(500)
    })
  })
})
