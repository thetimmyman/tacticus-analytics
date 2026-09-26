import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockPostToWebhook: ReturnType<typeof vi.fn>
let mockDirectClient: {
  query: ReturnType<typeof vi.fn>
  rpc: ReturnType<typeof vi.fn>
  invoke: ReturnType<typeof vi.fn>
  mutate: ReturnType<typeof vi.fn>
  count: ReturnType<typeof vi.fn>
}

type ReminderRow = {
  id: string
  guild_code: string | null
  webhook_url: string | null
  webhook_type: string
  enabled: boolean
  updated_at?: string | null
}

describe('/api/cron/token-reminders', () => {
  let POST: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockPostToWebhook = vi
      .fn()
      .mockResolvedValue({ ok: true, status: 204, attempts: 1 })

    mockDirectClient = {
      query: vi.fn().mockResolvedValue({ data: [], error: null }),
      rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
      invoke: vi.fn().mockResolvedValue({ data: null, error: null }),
      mutate: vi.fn().mockResolvedValue({ data: null, error: null }),
      count: vi.fn().mockResolvedValue({ count: 0, error: null })
    }

    vi.doMock('@/app/lib/network/direct-supabase', () => ({
      createDirectClient: () => mockDirectClient
    }))

    vi.doMock('@/app/lib/scheduler/cron-guard', () => ({
      cronGuard: vi
        .fn()
        .mockResolvedValue({ shouldExecute: true, reason: 'primary' })
    }))

    vi.doMock('@/app/lib/scheduler/require-cron-secret', () => ({
      requireCronSecret: vi.fn()
    }))

    vi.doMock('@/app/lib/discord/webhook-service', () => ({
      postToWebhook: mockPostToWebhook,
      logDiscordWebhookDelivery: vi.fn()
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    vi.doMock('@/app/lib/middleware/errorHandler', () => ({
      withErrorHandler: (fn: Function) => fn
    }))

    vi.doMock('@/app/lib/errors/AppError', () => ({
      Errors: {
        fromResponse: (status: number, body: unknown) => {
          const err = new Error(JSON.stringify(body)) as any
          err.status = status
          err.body = body
          return err
        }
      },
      rethrowIfAppError: (error: unknown) => {
        if ((error as any)?.status) throw error
      }
    }))

    vi.stubEnv('CRON_SECRET', 'test-cron-secret')

    const routeModule = await import('@/app/api/cron/token-reminders/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  function mockStandardTables(overrides?: {
    reminders?: ReminderRow[]
    officers?: Array<{ guild_code: string; user_id: string }>
    logs?: Array<{ guild_code: string; delivered_at: string | null }>
    guildConfigs?: Array<{
      guild_code: string
      display_name: string
      cluster_code: string | null
    }>
    reminderLoadError?: string | null
    featureAccess?: boolean
    tokenState?: Array<{
      player_id: string
      display_name: string
      tokens_available: number
      token_next_in_seconds: number | null
    }>
    tokenReminderPrefs?: Array<{
      game_guild_code: string | null
      enabled: boolean | null
    }>
  }) {
    const reminders = overrides?.reminders ?? [
      {
        id: 'reminder-1',
        guild_code: 'GUILD1',
        webhook_url: 'https://discord.com/api/webhooks/1/abc',
        webhook_type: 'token_cap_notification',
        enabled: true,
        updated_at: null
      }
    ]

    const officers = overrides?.officers ?? [
      { guild_code: 'GUILD1', user_id: 'user-1' }
    ]
    const logs = overrides?.logs ?? []
    const guildConfigs = overrides?.guildConfigs ?? [
      { guild_code: 'GUILD1', display_name: 'Test Guild', cluster_code: null }
    ]
    const reminderLoadError = overrides?.reminderLoadError ?? null
    const featureAccess = overrides?.featureAccess ?? true
    const tokenState = overrides?.tokenState ?? [
      {
        player_id: 'player-1',
        display_name: 'Player One',
        tokens_available: 3,
        token_next_in_seconds: null
      }
    ]

    mockDirectClient.query.mockImplementation((path: string) => {
      if (path.startsWith('webhook_config')) {
        return Promise.resolve({
          data: reminderLoadError ? null : reminders,
          error: reminderLoadError
        })
      }
      if (path.startsWith('guild_config')) {
        return Promise.resolve({ data: guildConfigs, error: null })
      }
      if (path.startsWith('player_mapping')) {
        return Promise.resolve({ data: officers, error: null })
      }
      if (path.startsWith('discord_webhook_logs')) {
        return Promise.resolve({ data: logs, error: null })
      }
      if (path.startsWith('discord_token_reminders')) {
        return Promise.resolve({
          data: overrides?.tokenReminderPrefs ?? [],
          error: null
        })
      }
      return Promise.resolve({ data: null, error: null })
    })

    mockDirectClient.rpc.mockImplementation((fn: string) => {
      if (fn === 'get_latest_season') {
        return Promise.resolve({ data: '83', error: null })
      }
      if (fn === 'get_player_token_state') {
        return Promise.resolve({ data: tokenState, error: null })
      }
      if (fn === 'check_feature_access') {
        return Promise.resolve({
          data: { has_access: featureAccess },
          error: null
        })
      }
      return Promise.resolve({ data: null, error: null })
    })
  }

  describe('POST - Send token reminders', () => {
    it('returns success when no enabled reminders', async () => {
      mockStandardTables({ reminders: [] })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.processed).toBe(0)
      expect(body.message).toBe('No enabled reminders configured')
    })

    it('skips reminders when feature access is locked', async () => {
      mockStandardTables({ featureAccess: false })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].status).toBe('skipped')
      expect(body.results[0].reason).toBe('feature_locked')
      expect(mockPostToWebhook).not.toHaveBeenCalled()
    })

    it('skips reminders on cooldown', async () => {
      const recentTime = new Date(Date.now() - 1000 * 60 * 60).toISOString() // 1 hour ago
      mockStandardTables({
        logs: [{ guild_code: 'GUILD1', delivered_at: recentTime }]
      })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].status).toBe('skipped')
      expect(body.results[0].reason).toBe('cooldown')
      expect(mockPostToWebhook).not.toHaveBeenCalled()
    })

    it('skips reminders when no players are capped or near cap', async () => {
      mockStandardTables({
        tokenState: [
          {
            player_id: 'player-1',
            display_name: 'Player One',
            tokens_available: 1,
            token_next_in_seconds: 36000
          }
        ]
      })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].status).toBe('skipped')
      expect(body.results[0].reason).toBe('no_targets')
      expect(mockPostToWebhook).not.toHaveBeenCalled()
    })

    it('sends Discord message through webhook service', async () => {
      mockStandardTables()

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.results[0].status).toBe('sent')
      expect(mockPostToWebhook).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/1/abc',
        expect.objectContaining({
          content: expect.stringContaining('Test Guild')
        }),
        expect.objectContaining({
          guildCode: 'GUILD1',
          webhookType: 'token_cap_notification'
        })
      )
    })

    it('handles webhook delivery errors', async () => {
      mockStandardTables()
      mockPostToWebhook.mockResolvedValueOnce({
        ok: false,
        status: 403,
        attempts: 1,
        error: { type: 'invalid_webhook', message: 'forbidden' }
      })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].status).toBe('failed')
      expect(body.results[0].reason).toBe('discord_403')
    })

    // Display names are attacker-controlled.
    it('suppresses all mentions via allowed_mentions parse: []', async () => {
      mockStandardTables({
        tokenState: [
          {
            player_id: 'player-1',
            display_name: '@everyone',
            tokens_available: 3,
            token_next_in_seconds: null
          }
        ]
      })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].status).toBe('sent')
      expect(mockPostToWebhook).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/1/abc',
        expect.objectContaining({
          allowed_mentions: { parse: [] }
        }),
        expect.anything()
      )
    })

    it('continues with the next guild when postToWebhook throws mid-batch', async () => {
      mockStandardTables({
        reminders: [
          {
            id: 'reminder-1',
            guild_code: 'GUILD1',
            webhook_url: 'https://discord.com/api/webhooks/1/abc',
            webhook_type: 'token_cap_notification',
            enabled: true,
            updated_at: null
          },
          {
            id: 'reminder-2',
            guild_code: 'GUILD2',
            webhook_url: 'https://discord.com/api/webhooks/2/def',
            webhook_type: 'token_cap_notification',
            enabled: true,
            updated_at: null
          }
        ],
        officers: [
          { guild_code: 'GUILD1', user_id: 'user-1' },
          { guild_code: 'GUILD2', user_id: 'user-2' }
        ],
        guildConfigs: [
          {
            guild_code: 'GUILD1',
            display_name: 'Guild One',
            cluster_code: null
          },
          {
            guild_code: 'GUILD2',
            display_name: 'Guild Two',
            cluster_code: null
          }
        ]
      })
      mockPostToWebhook.mockRejectedValueOnce(
        new Error('Discord webhook failed: Discord server error')
      )

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.results).toHaveLength(2)
      expect(body.results[0].status).toBe('failed')
      expect(body.results[0].reason).toContain('discord_exception')
      expect(body.results[1].status).toBe('sent')
      expect(mockPostToWebhook).toHaveBeenCalledTimes(2)
    })

    it('disables the webhook_config row on a permanent Discord 404', async () => {
      mockStandardTables()
      mockPostToWebhook.mockResolvedValueOnce({
        ok: false,
        status: 404,
        attempts: 1,
        error: { type: 'invalid_webhook', message: 'Unknown Webhook' }
      })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].status).toBe('failed')
      expect(mockDirectClient.mutate).toHaveBeenCalledWith(
        'webhook_config?id=eq.reminder-1',
        'PATCH',
        { enabled: false }
      )
    })

    it('does NOT disable the webhook_config row on transient failures (429)', async () => {
      mockStandardTables()
      mockPostToWebhook.mockResolvedValueOnce({
        ok: false,
        status: 429,
        attempts: 4,
        error: { type: 'rate_limited', message: 'rate limited' }
      })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].status).toBe('failed')
      expect(mockDirectClient.mutate).not.toHaveBeenCalled()
    })

    it('skips a guild whose /token-reminder preferences are ALL disabled', async () => {
      mockStandardTables({
        tokenReminderPrefs: [
          { game_guild_code: 'GUILD1', enabled: false },
          { game_guild_code: 'GUILD1', enabled: false }
        ]
      })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].status).toBe('skipped_disabled')
      expect(mockPostToWebhook).not.toHaveBeenCalled()
    })

    it('still sends when at least one /token-reminder preference row is enabled', async () => {
      mockStandardTables({
        tokenReminderPrefs: [
          { game_guild_code: 'GUILD1', enabled: false },
          { game_guild_code: 'GUILD1', enabled: true }
        ]
      })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].status).toBe('sent')
      expect(mockPostToWebhook).toHaveBeenCalledTimes(1)
    })

    it('sends normally when a guild has NO /token-reminder preference rows', async () => {
      mockStandardTables({ tokenReminderPrefs: [] })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.results[0].status).toBe('sent')
    })

    it('throws when loading reminders fails', async () => {
      mockStandardTables({ reminderLoadError: 'Database error' })

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      // withErrorHandler is mocked as passthrough.
      await expect(POST(request)).rejects.toMatchObject({ status: 500 })
    })

    it('throws on unexpected errors', async () => {
      mockDirectClient.query.mockRejectedValue(new Error('Connection failed'))

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      await expect(POST(request)).rejects.toMatchObject({ status: 500 })
    })

    it('includes timestamp in response when reminders are processed', async () => {
      mockStandardTables()

      const request = new NextRequest(
        'http://localhost/api/cron/token-reminders',
        {
          method: 'POST',
          headers: { Authorization: 'Bearer test-cron-secret' }
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(body.timestamp).toBeDefined()
      expect(new Date(body.timestamp).getTime()).not.toBeNaN()
    })
  })
})
