import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockFormatLeaderboardEmbed: ReturnType<typeof vi.fn>
let mockPostToWebhook: ReturnType<typeof vi.fn>
let mockLogDiscordWebhookDelivery: ReturnType<typeof vi.fn>
let mockValidateWebhookManagementAccess: ReturnType<typeof vi.fn>
let mockFindWebhookForGuild: ReturnType<typeof vi.fn>

describe('POST /api/discord-webhooks/leaderboard', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockFormatLeaderboardEmbed = vi.fn()
    mockPostToWebhook = vi.fn()
    mockLogDiscordWebhookDelivery = vi.fn()
    mockValidateWebhookManagementAccess = vi.fn()
    mockFindWebhookForGuild = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))
    vi.doMock('@/app/lib/discord/formatters', () => ({
      formatLeaderboardEmbed: mockFormatLeaderboardEmbed
    }))
    vi.doMock('@/app/lib/discord/webhook-service', () => ({
      postToWebhook: mockPostToWebhook,
      logDiscordWebhookDelivery: mockLogDiscordWebhookDelivery
    }))
    vi.doMock('@/app/lib/utils/cluster-validation', () => ({
      validateWebhookManagementAccess: mockValidateWebhookManagementAccess
    }))
    vi.doMock('@/app/lib/webhooks/webhook-helper', () => ({
      findWebhookForGuild: mockFindWebhookForGuild
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
            : code === 'INSUFFICIENT_PERMISSIONS'
              ? 403
              : code === 'RATE_LIMITED'
                ? 429
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
        MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
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
      from: vi.fn()
    }
    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule =
      await import('@/app/api/discord-webhooks/leaderboard/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createRequest = (body: object) => {
    return new NextRequest(
      'http://localhost/api/discord-webhooks/leaderboard',
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

      const request = createRequest({
        type: 'overall_leaderboard',
        season: 'Season 10',
        data: []
      })
      const response = await POST(request)

      expect(response.status).toBe(401)
    })
  })

  describe('authorization', () => {
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

      const request = createRequest({
        type: 'overall_leaderboard',
        season: 'Season 10',
        data: []
      })
      const response = await POST(request)

      expect(response.status).toBe(403)
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

      const request = createRequest({
        type: 'overall_leaderboard',
        season: 'Season 10',
        data: [],
        guild: 'OTHERGUILD'
      })
      const response = await POST(request)

      expect(response.status).toBe(403)
      expect(mockValidateWebhookManagementAccess).toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('returns 400 for invalid leaderboard type', async () => {
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

      const request = createRequest({
        type: 'invalid_type',
        season: 'Season 10',
        data: []
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 when season is missing', async () => {
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

      const request = createRequest({
        type: 'overall_leaderboard',
        data: []
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 when data is not an array', async () => {
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

      const request = createRequest({
        type: 'overall_leaderboard',
        season: 'Season 10',
        data: 'not-an-array'
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 when guild code is missing and user has none', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'leader', guild_code: null },
          error: null
        })
      })

      const request = createRequest({
        type: 'overall_leaderboard',
        season: 'Season 10',
        data: []
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('webhook configuration', () => {
    it('returns error when no webhook configured', async () => {
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
      mockFindWebhookForGuild.mockResolvedValue(null)

      const request = createRequest({
        type: 'overall_leaderboard',
        season: 'Season 10',
        data: []
      })
      const response = await POST(request)

      expect(response.status).toBe(503)
    })
  })

  describe('successful posting', () => {
    it('posts overall leaderboard successfully', async () => {
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
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )
      mockFormatLeaderboardEmbed.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({ ok: true })

      const request = createRequest({
        type: 'overall_leaderboard',
        season: 'Season 10',
        data: [
          {
            display_name: 'Player1',
            total_damage: 100000,
            battle_count: 10,
            guild_code: 'TEST'
          }
        ]
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.type).toBe('overall_leaderboard')
    })

    it('posts boss leaderboard successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'officer', guild_code: 'TEST' },
          error: null
        })
      })
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )
      mockFormatLeaderboardEmbed.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({ ok: true })

      const request = createRequest({
        type: 'boss_leaderboard',
        season: 'Season 10',
        data: [{ display_name: 'Player1', boss_name: 'Boss', damage: 50000 }]
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.type).toBe('boss_leaderboard')
    })

    it('posts prime leaderboard successfully', async () => {
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
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )
      mockFormatLeaderboardEmbed.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({ ok: true })

      const request = createRequest({
        type: 'prime_leaderboard',
        season: 'Season 10',
        data: [
          {
            display_name: 'Player1',
            prime1_damage: 30000,
            prime2_damage: 25000
          }
        ]
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.type).toBe('prime_leaderboard')
    })
  })

  describe('Discord API errors', () => {
    it('handles rate limiting', async () => {
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
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )
      mockFormatLeaderboardEmbed.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({
        ok: false,
        error: { type: 'rate_limited' }
      })

      const request = createRequest({
        type: 'overall_leaderboard',
        season: 'Season 10',
        data: []
      })
      const response = await POST(request)

      expect(response.status).toBe(429)
    })

    it('handles invalid webhook', async () => {
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
      mockFindWebhookForGuild.mockResolvedValue(
        'https://discord.com/api/webhooks/123/token'
      )
      mockFormatLeaderboardEmbed.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({
        ok: false,
        error: { type: 'invalid_webhook' }
      })

      const request = createRequest({
        type: 'overall_leaderboard',
        season: 'Season 10',
        data: []
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('error handling', () => {
    it('handles invalid JSON body', async () => {
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
        'http://localhost/api/discord-webhooks/leaderboard',
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
})
