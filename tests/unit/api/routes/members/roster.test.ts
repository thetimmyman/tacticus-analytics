import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { UserAccessLevels } from '@/app/lib/services/feature-release-service'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockGetPlayerApiKey: ReturnType<typeof vi.fn>
let mockTacticusAPI: { getPlayer: ReturnType<typeof vi.fn> }
let mockGetUserAccessLevels: ReturnType<typeof vi.fn>
let mockCreateLokiClient: ReturnType<typeof vi.fn>
let mockCheckActionRateLimit: ReturnType<typeof vi.fn>

const createNextRequest = (url: string) => {
  const urlObj = new URL(url)
  return {
    nextUrl: {
      searchParams: urlObj.searchParams
    }
  } as unknown as Request
}

describe('GET /api/members/roster', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    from: ReturnType<typeof vi.fn>
    auth: { admin: { getUserById: ReturnType<typeof vi.fn> } }
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockGetPlayerApiKey = vi.fn()
    mockTacticusAPI = { getPlayer: vi.fn() }
    mockGetUserAccessLevels = vi.fn()
    mockCreateLokiClient = vi.fn(() => ({
      getPlayerInfo: vi.fn().mockResolvedValue({ ok: false })
    }))
    mockCheckActionRateLimit = vi.fn().mockResolvedValue({ allowed: true })

    vi.doMock('@/app/lib/db', () => ({
      db: mockCreateClient,
      serviceDb: mockCreateServiceClient
    }))

    vi.doMock('@tacticus/app-core/api-key-helper', () => ({
      getPlayerApiKey: mockGetPlayerApiKey
    }))

    vi.doMock('@/app/lib/api/tacticus-client', async (importOriginal) => ({
      // resolveMachinesOfWar stays real (MoW parity); only the API client is mocked.
      ...(await importOriginal<
        typeof import('@/app/lib/api/tacticus-client')
      >()),
      tacticusAPI: mockTacticusAPI
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      getUserAccessLevels: mockGetUserAccessLevels
    }))

    vi.doMock('@/app/lib/loki/client', () => ({
      createLokiClient: mockCreateLokiClient
    }))

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      checkActionRateLimit: mockCheckActionRateLimit
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

    mockServiceSupabase = {
      from: vi.fn(),
      auth: { admin: { getUserById: vi.fn() } }
    }

    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)

    const routeModule = await import('@/app/api/members/roster/route')
    GET = routeModule.GET
  })

  const makeSingleChain = (
    data: Record<string, unknown> | null,
    error: { message: string; code?: string } | null = null
  ) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error })
  })

  const mockTargetPlayerQueries = (
    targetPlayer: Record<string, unknown>,
    guildConfigs: Array<{ guild_code: string; cluster_code: string | null }> = [
      { guild_code: 'TEST', cluster_code: null }
    ]
  ) => {
    mockServiceSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return makeSingleChain(targetPlayer)
      }
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({
              data: guildConfigs,
              error: null
            }),
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: null,
                error: null
              })
            })
          })
        }
      }
      return {}
    })
  }

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })

    it('returns 401 when auth errors', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Auth error' }
      })

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('validation', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 400 when player_id is missing', async () => {
      const request = createNextRequest('http://localhost/api/members/roster')

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('player_id is required')
    })

    it('returns 403 when user is not officer or leader', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'member', guild_code: 'TEST', cluster_code: null },
          error: null
        })
      })

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.code).toBe(1002) // FORBIDDEN
    })

    // SQL compares `lower(pm.role)`, so a stored `Officer` is a real officer.
    it.each(['Officer', 'Leader'])(
      'lets a caller stored as %s past the role gate',
      async (role) => {
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { role, guild_code: 'TEST', cluster_code: null },
            error: null
          })
        })

        mockServiceSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null })
        })

        const request = createNextRequest(
          'http://localhost/api/members/roster?player_id=player-123'
        )

        const response = await GET(request)
        const body = await response.json()

        // 404 (target lookup), not 403: the role gate admitted them.
        expect(response.status).toBe(404)
        expect(body.error.code).toBe(3001)
      }
    )

    it('returns 403 for a caller stored as `Member`', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'Member', guild_code: 'TEST', cluster_code: null },
          error: null
        })
      })

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.code).toBe(1002)
    })

    it('returns 404 when target player is not found', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'officer', guild_code: 'TEST', cluster_code: null },
          error: null
        })
      })

      mockServiceSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      })

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
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

    it('returns 403 when player is outside the caller cluster', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'officer', guild_code: 'MYGUILD', cluster_code: null },
          error: null
        })
      })

      mockTargetPlayerQueries(
        {
          user_id: 'target-user',
          player_id: 'player-123',
          display_name: 'Target Player',
          guild_code: 'OTHERGUILD',
          cluster_code: null,
          tacticus_api_key_encrypted: 'encrypted-key',
          discord_user_id: 'discord-123'
        },
        [
          { guild_code: 'MYGUILD', cluster_code: 'A' },
          { guild_code: 'OTHERGUILD', cluster_code: 'B' }
        ]
      )

      mockGetUserAccessLevels.mockResolvedValue({
        is_alpha_tester: false,
        has_premium: false,
        cluster_code: null,
        guild_code: null,
        max_access_level: 'public'
      } satisfies UserAccessLevels)

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.code).toBe(1002) // FORBIDDEN
    })

    it('allows access for same guild', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'officer', guild_code: 'TEST', cluster_code: null },
          error: null
        })
      })

      mockTargetPlayerQueries({
        user_id: 'target-user',
        player_id: 'player-123',
        display_name: 'Target Player',
        guild_code: 'TEST',
        cluster_code: null,
        tacticus_api_key_encrypted: 'encrypted-key'
      })

      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.getPlayer.mockResolvedValue({
        details: { powerLevel: 50000 },
        units: [{ id: 'unit-1' }],
        progress: {}
      })

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })
  })

  describe('API key handling', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'officer', guild_code: 'TEST', cluster_code: null },
          error: null
        })
      })
    })

    it('returns 400 when player has no API key', async () => {
      mockTargetPlayerQueries({
        user_id: null,
        player_id: 'player-123',
        display_name: 'Target Player',
        guild_code: 'TEST',
        cluster_code: null,
        tacticus_api_key_encrypted: null,
        discord_user_id: 'discord-123'
      })

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001) // VALIDATION
      expect(body.error.metadata.hasDiscord).toBe(false)
      expect(mockCheckActionRateLimit).toHaveBeenCalledWith(
        'member-roster:loki:player-123',
        60
      )
    })

    it('returns 429 without a provider call when the player fallback is rate limited', async () => {
      mockTargetPlayerQueries({
        user_id: null,
        player_id: 'player-123',
        display_name: 'Target Player',
        guild_code: 'TEST',
        cluster_code: null,
        tacticus_api_key_encrypted: null,
        discord_user_id: 'discord-123'
      })
      mockCheckActionRateLimit.mockResolvedValue({
        allowed: false,
        remainingTime: 42
      })

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(429)
      expect(body.error.message).toBe(
        'Please wait before refreshing this roster again'
      )
      expect(mockCreateLokiClient).not.toHaveBeenCalled()
    })

    it('returns 500 when API key decryption fails', async () => {
      mockTargetPlayerQueries({
        user_id: 'target-user',
        player_id: 'player-123',
        display_name: 'Target Player',
        guild_code: 'TEST',
        cluster_code: null,
        tacticus_api_key_encrypted: 'encrypted-key'
      })

      mockGetPlayerApiKey.mockResolvedValue(null)

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.code).toBe(5001)
    })

    it('returns 502 when Tacticus API fails', async () => {
      mockTargetPlayerQueries({
        user_id: 'target-user',
        player_id: 'player-123',
        display_name: 'Target Player',
        guild_code: 'TEST',
        cluster_code: null,
        tacticus_api_key_encrypted: 'encrypted-key'
      })

      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.getPlayer.mockResolvedValue(null)

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(502)
      expect(body.error.code).toBe(4001) // EXTERNAL_API_ERROR
    })
  })

  describe('successful roster fetch', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { role: 'officer', guild_code: 'TEST', cluster_code: null },
          error: null
        })
      })
    })

    it('returns player roster data', async () => {
      const mockPlayerData = {
        details: { powerLevel: 75000 },
        units: [
          { id: 'unit-1', name: 'Hero 1' },
          { id: 'unit-2', name: 'Hero 2' }
        ],
        progress: { campaign: 50 }
      }

      mockTargetPlayerQueries({
        user_id: 'target-user',
        player_id: 'player-123',
        display_name: 'Target Player',
        guild_code: 'TEST',
        cluster_code: null,
        tacticus_api_key_encrypted: 'encrypted-key',
        tacticus_share_url: 'https://share.url'
      })

      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.getPlayer.mockResolvedValue(mockPlayerData)

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.playerName).toBe('Target Player')
      expect(body.powerLevel).toBe(75000)
      expect(body.units).toEqual(mockPlayerData.units)
      expect(body.progress).toEqual(mockPlayerData.progress)
      expect(body.guildCode).toBe('TEST')
      expect(body.tacticusShareUrl).toBe('https://share.url')
    })
  })

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Unexpected error'))

      const request = createNextRequest(
        'http://localhost/api/members/roster?player_id=player-123'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('An unexpected error occurred')
    })
  })
})
