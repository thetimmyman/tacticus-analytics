import { describe, it, expect, vi, beforeEach, type Mock } from 'vitest'

// vitest 5 types a bare vi.fn() as function-or-constructor; these mocks are called.
type AnyMock = Mock<(...args: any[]) => any>
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))

let mockCreateClient: AnyMock
let mockFetch: AnyMock
let mockResolveVerifiedPlayers: AnyMock
let mockResolveVerifiedDiscordIdentities: AnyMock
let mockFindVerifiedDiscordForMapping: AnyMock

describe('POST /api/members/request-api-key', () => {
  let POST: (request: Request) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: AnyMock }
    from: AnyMock
  }
  const originalEnv = process.env

  beforeEach(async () => {
    vi.resetModules()

    process.env = { ...originalEnv, DISCORD_BOT_TOKEN: 'test-bot-token' }

    mockCreateClient = vi.fn()
    mockFetch = vi.fn()
    mockResolveVerifiedPlayers = vi.fn().mockResolvedValue([
      {
        mappingId: 1,
        playerId: 'officer-player',
        userId: 'user-123',
        guildCode: 'TEST'
      }
    ])
    mockResolveVerifiedDiscordIdentities = vi.fn(
      async (_service: object, discordUserIds: string[]) =>
        discordUserIds.map((discordUserId) => ({ discordUserId }))
    )
    mockFindVerifiedDiscordForMapping = vi.fn(
      (rows: Array<{ discordUserId: string }>) => rows[0] ?? null
    )
    global.fetch = mockFetch

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: vi.fn(() => mockSupabase)
    }))

    vi.doMock('@/app/lib/auth/verified-player-authority', () => ({
      resolveVerifiedPlayers: mockResolveVerifiedPlayers,
      resolveVerifiedDiscordIdentities: mockResolveVerifiedDiscordIdentities,
      findVerifiedDiscordForMapping: mockFindVerifiedDiscordForMapping
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/members/request-api-key/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = originalEnv
  })

  const createRequest = () =>
    new Request('http://localhost/api/members/request-api-key', {
      method: 'POST',
      body: JSON.stringify({ playerId: 'player-123' })
    })

  const configureAuthorizedDiscordTarget = () => {
    let callCount = 0
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return Promise.resolve({
            data: {
              role: 'officer',
              guild_code: 'TEST',
              cluster_code: null,
              display_name: 'Officer'
            },
            error: null
          })
        }
        return Promise.resolve({
          data: {
            player_id: 'player-123',
            display_name: 'Target Player',
            guild_code: 'TEST',
            cluster_code: null,
            discord_user_id: 'discord-123'
          },
          error: null
        })
      })
    })
  }

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })

    it('returns 401 when auth errors', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Auth error' }
      })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('canonical player authority', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
    })

    it('rejects a caller without immutable player ownership', async () => {
      mockResolveVerifiedPlayers.mockResolvedValue([])

      const response = await POST(createRequest())

      expect(response.status).toBe(403)
      expect(mockSupabase.from).not.toHaveBeenCalled()
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('rejects a stored Discord candidate when canonical matching denies it', async () => {
      configureAuthorizedDiscordTarget()
      mockResolveVerifiedDiscordIdentities.mockResolvedValue([])

      const response = await POST(createRequest())
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe(
        'This player does not have Discord linked'
      )
      expect(mockFetch).not.toHaveBeenCalled()
    })

    it('sends only to the resolver-proven Discord snowflake', async () => {
      const canonicalDiscordId = '700000000000000007'
      configureAuthorizedDiscordTarget()
      mockResolveVerifiedDiscordIdentities.mockResolvedValue([
        { discordUserId: canonicalDiscordId }
      ])
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'dm-channel-123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'message-123' })
        })

      const response = await POST(createRequest())

      expect(response.status).toBe(200)
      expect(JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body))).toEqual({
        recipient_id: canonicalDiscordId
      })
    })
  })

  describe('validation', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 400 when playerId is missing', async () => {
      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({})
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('player_id is required')
    })

    it('returns 403 when user is not officer or leader', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'member', guild_code: 'TEST' },
          error: null
        })
      })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.code).toBe(1002) // FORBIDDEN
    })

    it('returns 404 when target player is not found', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockImplementation(() => {
              const calls = mockSupabase.from.mock.calls.length
              if (calls <= 1) {
                return Promise.resolve({
                  data: { role: 'officer', guild_code: 'TEST' },
                  error: null
                })
              }
              return Promise.resolve({ data: null, error: null })
            })
          }
        }
        return {}
      })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error.code).toBe(3001) // NOT_FOUND
    })
  })

  describe('guild access validation', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 403 when target player is in different guild', async () => {
      let callCount = 0
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              data: {
                role: 'officer',
                guild_code: 'MYGUILD',
                cluster_code: null
              },
              error: null
            })
          }
          return Promise.resolve({
            data: {
              player_id: 'player-123',
              display_name: 'Target Player',
              guild_code: 'OTHERGUILD',
              cluster_code: null,
              discord_user_id: 'discord-123'
            },
            error: null
          })
        })
      })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.code).toBe(1002) // FORBIDDEN
    })

    it('allows leader to message player in same cluster', async () => {
      let callCount = 0
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              data: {
                role: 'leader',
                guild_code: 'MYGUILD',
                cluster_code: 'EOT'
              },
              error: null
            })
          }
          return Promise.resolve({
            data: {
              player_id: 'player-123',
              display_name: 'Target Player',
              guild_code: 'OTHERGUILD',
              cluster_code: 'EOT',
              discord_user_id: 'discord-123'
            },
            error: null
          })
        })
      })

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'dm-channel-123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'message-123' })
        })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })
  })

  describe('Discord integration', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('aborts a hung Discord DM channel creation request', async () => {
      vi.useFakeTimers()
      const { SERVICE_TIMEOUTS } = await import('@/app/lib/utils/async-timeout')
      let aborted = false
      configureAuthorizedDiscordTarget()
      mockFetch.mockImplementationOnce(
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

      const responsePromise = POST(createRequest())

      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.DISCORD_WEBHOOK)

      expect(aborted).toBe(true)
      const response = await responsePromise
      expect(response.status).toBe(500)
      expect(mockFetch).toHaveBeenCalledWith(
        'https://discord.com/api/v10/users/@me/channels',
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      )
    })

    it('aborts a hung Discord DM message send request', async () => {
      vi.useFakeTimers()
      const { SERVICE_TIMEOUTS } = await import('@/app/lib/utils/async-timeout')
      let aborted = false
      configureAuthorizedDiscordTarget()
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'dm-channel-123' })
        })
        .mockImplementationOnce(
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

      const responsePromise = POST(createRequest())

      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2)
      })
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.DISCORD_WEBHOOK)

      expect(aborted).toBe(true)
      const response = await responsePromise
      expect(response.status).toBe(500)
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        'https://discord.com/api/v10/channels/dm-channel-123/messages',
        expect.objectContaining({
          signal: expect.any(AbortSignal)
        })
      )
    })

    it('returns 400 when player has no Discord linked', async () => {
      let callCount = 0
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              data: { role: 'officer', guild_code: 'TEST', cluster_code: null },
              error: null
            })
          }
          return Promise.resolve({
            data: {
              player_id: 'player-123',
              display_name: 'Target Player',
              guild_code: 'TEST',
              cluster_code: null,
              discord_user_id: null
            },
            error: null
          })
        })
      })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001) // VALIDATION
    })

    it('returns 500 when Discord bot token is missing', async () => {
      delete process.env.DISCORD_BOT_TOKEN

      let callCount = 0
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              data: { role: 'officer', guild_code: 'TEST', cluster_code: null },
              error: null
            })
          }
          return Promise.resolve({
            data: {
              player_id: 'player-123',
              display_name: 'Target Player',
              guild_code: 'TEST',
              cluster_code: null,
              discord_user_id: 'discord-123'
            },
            error: null
          })
        })
      })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.code).toBe(5001)
    })

    it('returns 400 when DM channel creation fails', async () => {
      let callCount = 0
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              data: {
                role: 'officer',
                guild_code: 'TEST',
                cluster_code: null,
                display_name: 'Officer'
              },
              error: null
            })
          }
          return Promise.resolve({
            data: {
              player_id: 'player-123',
              display_name: 'Target Player',
              guild_code: 'TEST',
              cluster_code: null,
              discord_user_id: 'discord-123'
            },
            error: null
          })
        })
      })

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 403,
        json: () => Promise.resolve({ message: 'Cannot send DM' })
      })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001) // VALIDATION
    })

    it('returns 400 when message send fails', async () => {
      let callCount = 0
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              data: {
                role: 'officer',
                guild_code: 'TEST',
                cluster_code: null,
                display_name: 'Officer'
              },
              error: null
            })
          }
          return Promise.resolve({
            data: {
              player_id: 'player-123',
              display_name: 'Target Player',
              guild_code: 'TEST',
              cluster_code: null,
              discord_user_id: 'discord-123'
            },
            error: null
          })
        })
      })

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'dm-channel-123' })
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: () => Promise.resolve({ message: 'Message failed' })
        })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001) // VALIDATION
    })
  })

  describe('successful message send', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('sends Discord message successfully', async () => {
      let callCount = 0
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockImplementation(() => {
          callCount++
          if (callCount === 1) {
            return Promise.resolve({
              data: {
                role: 'officer',
                guild_code: 'TEST',
                cluster_code: null,
                display_name: 'Officer Name'
              },
              error: null
            })
          }
          return Promise.resolve({
            data: {
              player_id: 'player-123',
              display_name: 'Target Player',
              guild_code: 'TEST',
              cluster_code: null,
              discord_user_id: 'discord-123'
            },
            error: null
          })
        })
      })

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'dm-channel-123' })
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({ id: 'message-123' })
        })

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.message).toContain('Target Player')
    })
  })

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Unexpected error'))

      const request = new Request(
        'http://localhost/api/members/request-api-key',
        {
          method: 'POST',
          body: JSON.stringify({ playerId: 'player-123' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('An unexpected error occurred')
    })
  })
})
