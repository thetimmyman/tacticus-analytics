import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockServiceSelect: ReturnType<typeof vi.fn>
let mockServiceIn: ReturnType<typeof vi.fn>
let mockGuildConfigGetBasic: ReturnType<typeof vi.fn>
let mockFetch: ReturnType<typeof vi.fn>
let mockRequireGuildOfficerOrClusterLeader: ReturnType<typeof vi.fn>

describe('POST /api/webhooks/test', () => {
  let POST: (request: Request) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    delete process.env.DISABLE_DIAGNOSTIC_MESSAGES

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
    mockServiceSelect = vi.fn().mockReturnValue({ in: mockServiceIn })
    mockGuildConfigGetBasic = vi
      .fn()
      .mockResolvedValue({ display_name: 'Guild' })
    mockCreateServiceClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ select: mockServiceSelect })
    })
    mockFetch = vi.fn()
    mockRequireGuildOfficerOrClusterLeader = vi.fn().mockResolvedValue({
      role: 'officer',
      guild_code: 'GUILD1',
      display_name: 'Officer'
    })

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/auth/guild-permissions', () => ({
      requireGuildOfficerOrClusterLeader: mockRequireGuildOfficerOrClusterLeader
    }))
    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: { getBasic: mockGuildConfigGetBasic }
    }))

    vi.stubGlobal('fetch', mockFetch)

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

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/webhooks/test/route')
    POST = routeModule.POST
  })

  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: 'abc123' })
      })

      const response = await POST(request)

      expect(response.status).toBe(401)
    })
  })

  describe('validation', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 400 when neither webhook_id nor webhook_type/url provided', async () => {
      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain(
        'webhook_id or both webhook_type and webhook_url required'
      )
    })

    it('returns 404 when webhook_id not found', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: 'Not found' } })
      }
      mockSupabase.from.mockReturnValue(mockQuery)

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: 'nonexistent' })
      })

      const response = await POST(request)

      expect(response.status).toBe(404)
    })

    it('returns 400 when webhook URL is not configured', async () => {
      const mockQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'abc',
            webhook_type: 'leaderboard',
            guild_code: 'GUILD1'
          },
          error: null
        })
      }
      mockSupabase.from.mockReturnValue(mockQuery)
      mockServiceIn.mockResolvedValue({
        data: [{ id: 'abc', webhook_url: null }],
        error: null
      })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: 'abc' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Webhook URL is not configured')
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

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'token_cap_notification',
          webhook_url: 'https://discord.com/api/webhooks/123/abc'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('currently in alpha')
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockSupabase.rpc).toHaveBeenCalledWith('check_feature_access', {
        p_user_id: 'user-123',
        p_feature_key: 'proactive_token_management'
      })
    })

    it('enforces alpha access for legacy token_cap_alerts type and normalizes it', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: { has_access: true },
        error: null
      })
      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'token_cap_alerts',
          webhook_url: 'https://discord.com/api/webhooks/123/abc'
        })
      })

      const response = await POST(request)
      const body = await response.json()
      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body)

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(fetchBody.embeds[0].title).toContain(
        'Proactive Token Management Test'
      )
      expect(mockSupabase.rpc).toHaveBeenCalledWith('check_feature_access', {
        p_user_id: 'user-123',
        p_feature_key: 'proactive_token_management'
      })
    })
  })

  describe('test_only mode', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('validates URL format without sending', async () => {
      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'leaderboard',
          webhook_url: 'https://discord.com/api/webhooks/123/abc',
          test_only: true
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.message).toBe('Webhook URL is valid')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects invalid Discord webhook URL format', async () => {
      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'leaderboard',
          webhook_url: 'https://example.com/webhook',
          test_only: true
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(body.error).toBeDefined()
      expect(body.error.message).toContain('URL must be a Discord webhook URL')
    })
  })

  describe('Discord webhook testing', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 500 when the Discord webhook request hangs', async () => {
      vi.useFakeTimers()
      try {
        let aborted = false
        mockFetch.mockImplementation(
          (_url: string, init?: RequestInit): Promise<Response> =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener(
                'abort',
                () => {
                  aborted = true
                  reject(new DOMException('Aborted', 'AbortError'))
                },
                { once: true }
              )
            })
        )

        const request = new Request('http://localhost/api/webhooks/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'leaderboard',
            webhook_url: 'https://discord.com/api/webhooks/123/abc'
          })
        })
        const responsePromise = POST(request)

        await vi.waitFor(() => {
          expect(mockFetch).toHaveBeenCalled()
        })
        await vi.advanceTimersByTimeAsync(10_000)

        expect(aborted).toBe(true)
        const response = await responsePromise
        expect(response.status).toBe(500)
        expect(mockFetch).toHaveBeenCalledWith(
          'https://discord.com/api/webhooks/123/abc',
          expect.objectContaining({
            signal: expect.any(AbortSignal)
          })
        )
      } finally {
        vi.useRealTimers()
      }
    })

    it('returns 500 when the Discord webhook error body hangs', async () => {
      vi.useFakeTimers()
      try {
        let aborted = false
        mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              aborted = true
            },
            { once: true }
          )
          return Promise.resolve({
            ok: false,
            status: 400,
            text: () => new Promise(() => {})
          } as Response)
        })

        const request = new Request('http://localhost/api/webhooks/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            webhook_type: 'leaderboard',
            webhook_url: 'https://discord.com/api/webhooks/123/abc'
          })
        })
        const responsePromise = POST(request)
        responsePromise.catch(() => undefined)

        await vi.waitFor(() => {
          expect(mockFetch).toHaveBeenCalled()
        })
        await vi.advanceTimersByTimeAsync(10_000)

        expect(aborted).toBe(true)
        const response = await responsePromise
        expect(response.status).toBe(500)
      } finally {
        vi.useRealTimers()
      }
    })

    it('sends test message successfully with direct webhook_type and webhook_url', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'leaderboard',
          webhook_url: 'https://discord.com/api/webhooks/123/abc'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.message).toBe('Test message sent successfully!')
      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/123/abc',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' }
        })
      )
    })

    it('sends custom message when provided', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'leaderboard',
          webhook_url: 'https://discord.com/api/webhooks/123/abc',
          custom_message: 'Hello from test!'
        })
      })

      await POST(request)

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(fetchBody.content).toBe('Hello from test!')
    })

    it('uses predefined template for known webhook types', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'sync_status',
          webhook_url: 'https://discord.com/api/webhooks/123/abc'
        })
      })

      await POST(request)

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(fetchBody.embeds).toBeDefined()
      expect(fetchBody.embeds[0].title).toContain('Sync Status Test')
    })

    it('uses diagnostic template for opted-in diagnostic_messages webhook type', async () => {
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
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'diag-1',
                webhook_type: 'diagnostic_messages',
                webhook_url: 'https://discord.com/api/webhooks/123/abc',
                enabled: true,
                guild_code: 'GUILD1'
              },
              error: null
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ error: null })
            })
          }
        }

        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { display_name: 'Guild One' },
              error: null
            })
          }
        }

        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      })

      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_id: 'diag-1'
        })
      })

      await POST(request)

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(fetchBody.embeds).toBeDefined()
      expect(fetchBody.embeds[0].title).toContain('Diagnostic Messages Test')
      expect(mockRequireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
        mockSupabase,
        'user-123',
        'GUILD1',
        '/api/webhooks/test'
      )
    })

    it('blocks direct diagnostic_messages tests without saved guild opt-in config', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'diagnostic_messages',
          webhook_url: 'https://discord.com/api/webhooks/123/abc'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain('saved guild webhook configuration')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('blocks diagnostic_messages tests when guild opt-in is disabled', async () => {
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
        if (table === 'webhook_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'diag-2',
                webhook_type: 'diagnostic_messages',
                webhook_url: 'https://discord.com/api/webhooks/123/abc',
                enabled: false,
                guild_code: 'GUILD1'
              },
              error: null
            })
          }
        }
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { display_name: 'Guild One' },
              error: null
            })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      })

      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: 'diag-2' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain(
        'Enable guild Diagnostic Messages webhook'
      )
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('blocks diagnostic_messages tests when global kill switch is enabled', async () => {
      process.env.DISABLE_DIAGNOSTIC_MESSAGES = 'true'
      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'diagnostic_messages',
          webhook_url: 'https://discord.com/api/webhooks/123/abc'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain('globally disabled')
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('uses fallback message for unknown webhook types', async () => {
      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'unknown_type',
          webhook_url: 'https://discord.com/api/webhooks/123/abc'
        })
      })

      await POST(request)

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(fetchBody.content).toContain('unknown_type')
    })

    it('returns 400 when Discord returns error', async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limited'
      })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          webhook_type: 'leaderboard',
          webhook_url: 'https://discord.com/api/webhooks/123/abc'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain('Discord returned error')
    })
  })

  describe('webhook_id lookup and update', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('fetches webhook config by ID and gets guild display name', async () => {
      mockGuildConfigGetBasic.mockResolvedValue({ display_name: 'My Guild' })
      const mockWebhookQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'webhook-1',
            webhook_type: 'leaderboard',
            webhook_url: 'https://discord.com/api/webhooks/123/abc',
            guild_code: 'GUILD1'
          },
          error: null
        })
      }
      const mockGuildQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { display_name: 'My Guild' },
          error: null
        })
      }
      const mockUpdateQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null })
      }

      const mockProfileQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'officer', guild_code: 'GUILD1' },
          error: null
        })
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return mockProfileQuery
        }
        if (table === 'webhook_config') {
          return mockWebhookQuery
        }
        if (table === 'guild_config') {
          return mockGuildQuery
        }
        return mockUpdateQuery
      })

      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: 'webhook-1' })
      })

      await POST(request)

      const fetchBody = JSON.parse(mockFetch.mock.calls[0][1].body)
      expect(fetchBody.embeds[0].title).toContain('My Guild')
      expect(mockWebhookQuery.select).toHaveBeenCalledWith(
        expect.not.stringContaining('webhook_url')
      )
      expect(mockWebhookQuery.select).not.toHaveBeenCalledWith('*')
      expect(mockWebhookQuery.select).not.toHaveBeenCalledWith()
      expect(mockServiceIn).toHaveBeenCalledWith('id', ['webhook-1'])
      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/webhooks/1001/test-token',
        expect.anything()
      )
      expect(mockRequireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
        mockSupabase,
        'user-123',
        'GUILD1',
        '/api/webhooks/test'
      )
    })

    it('requires guild officer authorization for a stored proactive webhook', async () => {
      const { Errors } = await import('@/app/lib/errors/AppError')
      mockRequireGuildOfficerOrClusterLeader.mockRejectedValue(
        Errors.forbidden('Officer access required', {
          endpoint: '/api/webhooks/test'
        })
      )
      const updateEq = vi.fn().mockResolvedValue({ error: null })
      const mockWebhookQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'proactive-1',
            webhook_type: 'token_cap_notification',
            webhook_url: 'https://discord.com/api/webhooks/123/abc',
            guild_code: 'GUILD1',
            enabled: true
          },
          error: null
        }),
        update: vi.fn().mockReturnValue({ eq: updateEq })
      }
      const mockGuildQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { display_name: 'Guild One' },
          error: null
        })
      }

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') return mockWebhookQuery
        if (table === 'guild_config') return mockGuildQuery
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      })
      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: 'proactive-1' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error).toBeDefined()
      expect(mockRequireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
        mockSupabase,
        'user-123',
        'GUILD1',
        '/api/webhooks/test'
      )
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
      expect(updateEq).not.toHaveBeenCalled()
    })

    it('rejects test-firing a webhook for a guild the caller does not manage', async () => {
      const { Errors } = await import('@/app/lib/errors/AppError')
      mockRequireGuildOfficerOrClusterLeader.mockRejectedValue(
        Errors.forbidden(
          'You must be an officer/leader of this guild or a cluster leader to perform this action',
          { endpoint: '/api/webhooks/test', guild_code: 'GUILD2' }
        )
      )
      const mockWebhookQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'webhook-x',
            webhook_type: 'leaderboard',
            webhook_url: 'https://discord.com/api/webhooks/123/abc',
            guild_code: 'GUILD2'
          },
          error: null
        })
      }
      // Officer of GUILD1 only: the cross-tenant test-fire must be blocked.
      const mockProfileQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'officer', guild_code: 'GUILD1' },
          error: null
        })
      }
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') return mockProfileQuery
        if (table === 'webhook_config') return mockWebhookQuery
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      })

      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: 'webhook-x' })
      })

      const response = await POST(request)

      expect(response.status).toBe(403)
      expect(mockFetch).not.toHaveBeenCalled()
      expect(mockRequireGuildOfficerOrClusterLeader).toHaveBeenCalledWith(
        mockSupabase,
        'user-123',
        'GUILD2',
        '/api/webhooks/test'
      )
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })

    it('rejects a stored webhook without a guild or cluster scope', async () => {
      const mockWebhookQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'unscoped-webhook', webhook_type: 'leaderboard' },
          error: null
        })
      }
      mockSupabase.from.mockReturnValue(mockWebhookQuery)

      const response = await POST(
        new Request('http://localhost/api/webhooks/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ webhook_id: 'unscoped-webhook' })
        })
      )

      expect(response.status).toBe(403)
      expect(mockWebhookQuery.select).toHaveBeenCalledWith(
        expect.not.stringContaining('webhook_url')
      )
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('updates last_tested timestamp after successful test', async () => {
      const mockWebhookQuery = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'webhook-1',
            webhook_type: 'leaderboard',
            guild_code: 'GUILD1'
          },
          error: null
        })
      }
      const mockUpdateQuery = {
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockResolvedValue({ error: null })
      }

      let updateCalled = false
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'webhook_config') {
          const query = {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                id: 'webhook-1',
                webhook_type: 'leaderboard',
                guild_code: 'GUILD1'
              },
              error: null
            }),
            update: vi.fn().mockImplementation(() => {
              updateCalled = true
              return { eq: vi.fn().mockResolvedValue({ error: null }) }
            })
          }
          return query
        }
        return mockUpdateQuery
      })

      mockFetch.mockResolvedValue({ ok: true })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: 'webhook-1' })
      })

      await POST(request)

      expect(updateCalled).toBe(true)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 500 on unexpected errors', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Database connection failed')
      })

      const request = new Request('http://localhost/api/webhooks/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ webhook_id: 'abc' })
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
    })
  })
})
