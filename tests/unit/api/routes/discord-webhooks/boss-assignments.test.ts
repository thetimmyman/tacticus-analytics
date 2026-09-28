import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockFormatBossAssignmentEmbed: ReturnType<typeof vi.fn>
let mockPostToWebhook: ReturnType<typeof vi.fn>
let mockLogDiscordWebhookDelivery: ReturnType<typeof vi.fn>
let mockLoadWebhookUrlById: ReturnType<typeof vi.fn>
const webhookId = '10000000-0000-4000-8000-000000000001'
const webhookUrl = 'https://discord.com/api/webhooks/1001/test-token'

describe('POST /api/discord-webhooks/boss-assignments', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockFormatBossAssignmentEmbed = vi.fn()
    mockPostToWebhook = vi.fn()
    mockLogDiscordWebhookDelivery = vi.fn()
    mockLoadWebhookUrlById = vi.fn().mockResolvedValue(webhookUrl)
    vi.doMock('@/app/lib/webhooks/webhook-url-lookup', () => ({
      loadWebhookUrlById: mockLoadWebhookUrlById
    }))

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))
    vi.doMock('@/app/lib/discord/formatters', () => ({
      formatBossAssignmentEmbed: mockFormatBossAssignmentEmbed
    }))
    vi.doMock('@/app/lib/discord/webhook-service', () => ({
      postToWebhook: mockPostToWebhook,
      logDiscordWebhookDelivery: mockLogDiscordWebhookDelivery
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))
    vi.doMock('@tacticus/app-core/error-handler', () => ({
      createError: vi
        .fn()
        .mockImplementation((code, message) => ({ code, message })),
      formatErrorForUser: vi.fn().mockImplementation((err) => ({
        code: err?.code || 'ERROR',
        message: err?.message || 'Error',
        supportMessage: 'Contact support'
      })),
      getVersionInfo: vi.fn().mockReturnValue({ version: '1.0.0' })
    }))
    vi.doMock('@tacticus/app-core/api-errors', () => ({
      createErrorResponse: vi.fn().mockImplementation((code, message) => {
        return new Response(JSON.stringify({ error: { code, message } }), {
          status:
            code === 'UNAUTHORIZED'
              ? 401
              : code === 'INSUFFICIENT_PERMISSIONS'
                ? 403
                : 400
        })
      }),
      ErrorCode: {
        UNAUTHORIZED: 'UNAUTHORIZED',
        USER_NOT_FOUND: 'USER_NOT_FOUND',
        DATABASE_ERROR: 'DATABASE_ERROR',
        INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
        INVALID_REQUEST_FORMAT: 'INVALID_REQUEST_FORMAT'
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
      await import('@/app/api/discord-webhooks/boss-assignments/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createRequest = (body: object) => {
    return new NextRequest(
      'http://localhost/api/discord-webhooks/boss-assignments',
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

      const request = createRequest({ assignments: [] })
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

      const request = createRequest({ assignments: [] })
      const response = await POST(request)

      expect(response.status).toBe(403)
    })

    it('returns error when no active guild membership found', async () => {
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

      const request = createRequest({ assignments: [] })
      const response = await POST(request)
      const body = await response.json()

      expect(body.error).toBeDefined()
    })
  })

  describe('validation', () => {
    it('returns 400 for invalid payload format', async () => {
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

      const request = createRequest({ not_assignments: 'invalid' })
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 when assignments array is empty', async () => {
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

      const request = createRequest({ assignments: [] })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('No assignments provided')
    })
  })

  describe('webhook configuration', () => {
    it('returns 400 when no webhooks configured', async () => {
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
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({ data: null, error: null })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = createRequest({
        assignments: [{ tier: 'T1', boss_name: 'Boss', boss_code: 'BOSS' }],
        guild_code: 'TEST'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain(
        'No boss assignments webhooks configured'
      )
    })
  })

  describe('successful webhook posting', () => {
    it('posts to guild webhook successfully', async () => {
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
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: webhookId
              },
              error: null
            }),
            update: vi.fn().mockReturnThis()
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      mockFormatBossAssignmentEmbed.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({ ok: true })

      const request = createRequest({
        assignments: [{ tier: 'T1', boss_name: 'Boss', boss_code: 'BOSS' }],
        guild_code: 'TEST',
        season: 'Season 10'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.webhooks_sent).toBe(1)
      expect(body.webhooks_failed).toBe(0)
      expect(mockLoadWebhookUrlById).toHaveBeenCalledExactlyOnceWith(webhookId)
      expect(mockPostToWebhook).toHaveBeenCalledWith(
        webhookUrl,
        expect.anything(),
        expect.anything()
      )
      const webhookQueryIndex = mockSupabase.from.mock.calls.findIndex(
        ([table]) => table === 'webhook_config'
      )
      expect(
        mockSupabase.from.mock.results[webhookQueryIndex].value.select
      ).toHaveBeenCalledWith('id')
    })

    it('returns 207 for partial success', async () => {
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
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: webhookId
              },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      mockFormatBossAssignmentEmbed.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({
        ok: false,
        status: 500,
        error: { message: 'Discord error' }
      })

      const request = createRequest({
        assignments: [{ tier: 'T1', boss_name: 'Boss', boss_code: 'BOSS' }],
        guild_code: 'TEST'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(207)
      // Partial failure is success: false, not an error.
      expect(body.success).toBe(false)
      expect(body.webhooks_failed).toBe(1)
      expect(body.results[0].error).toBe(
        'Boss assignment webhook delivery failed'
      )
      expect(JSON.stringify(body)).not.toContain('Discord error')
    })

    it('does not expose raw webhook exceptions in partial failure results', async () => {
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
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: webhookId
              },
              error: null
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      mockFormatBossAssignmentEmbed.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockRejectedValue(
        new Error('raw discord provider secret')
      )

      const request = createRequest({
        assignments: [{ tier: 'T1', boss_name: 'Boss', boss_code: 'BOSS' }],
        guild_code: 'TEST'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(207)
      expect(body.success).toBe(false)
      expect(body.webhooks_failed).toBe(1)
      expect(body.results[0].error).toBe(
        'Boss assignment webhook delivery failed'
      )
      expect(JSON.stringify(body)).not.toContain('raw discord provider secret')
    })
  })

  describe('cluster webhook', () => {
    it('posts to cluster webhook when cluster_code provided', async () => {
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
        if (table === 'clusters') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { id: 1, display_name: 'Test Cluster' },
              error: null
            })
          }
        }
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            is: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: webhookId
              },
              error: null
            }),
            update: vi.fn().mockReturnThis()
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      mockFormatBossAssignmentEmbed.mockReturnValue({ embeds: [] })
      mockPostToWebhook.mockResolvedValue({ ok: true })

      const request = createRequest({
        assignments: [{ tier: 'T1', boss_name: 'Boss', boss_code: 'BOSS' }],
        cluster_code: 'EOT'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockLoadWebhookUrlById).toHaveBeenCalledExactlyOnceWith(webhookId)
    })
  })

  describe('error handling', () => {
    it('returns 500 for unexpected errors', async () => {
      mockCreateClient.mockRejectedValue(
        new Error('Database connection failed')
      )

      const request = createRequest({ assignments: [] })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })
  })
})
