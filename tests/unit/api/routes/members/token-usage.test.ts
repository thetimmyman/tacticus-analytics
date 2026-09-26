import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockGetTokenUsage: ReturnType<typeof vi.fn>
let mockGetTokenAvailability: ReturnType<typeof vi.fn>
let mockGuildConfigGetBasic: ReturnType<typeof vi.fn>
let mockLoadGuildTokenStatuses: ReturnType<typeof vi.fn>

describe('GET /api/members/token-usage', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockGetTokenUsage = vi.fn()
    mockGetTokenAvailability = vi.fn()
    mockLoadGuildTokenStatuses = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/data/token-usage', () => ({
      getTokenUsage: mockGetTokenUsage
    }))

    vi.doMock('@/app/lib/calculations/token-calculation', () => ({
      getTokenAvailability: mockGetTokenAvailability
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockGuildConfigGetBasic = vi
      .fn()
      .mockResolvedValue({ guild_code: 'TEST', cluster_code: 'EOT' })

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getFull: vi.fn().mockResolvedValue(null),
        getBasic: mockGuildConfigGetBasic,
        exists: vi.fn().mockResolvedValue(true)
      }
    }))

    vi.doMock('@/app/api/guild-tokens/token-service', () => ({
      loadGuildTokenStatuses: mockLoadGuildTokenStatuses
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockServiceSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)

    mockGetTokenAvailability.mockReturnValue({
      tokensAvailable: 3,
      tokenNextSeconds: null,
      bombsAvailable: 1,
      bombNextSeconds: 3600,
      dataSource: 'calculated'
    })
    mockLoadGuildTokenStatuses.mockResolvedValue({
      players: [],
      debug: {
        total_battles: 0,
        current_season_battles: 0,
        previous_season_battles: 0,
        seasons_checked: ['45']
      }
    })

    const routeModule = await import('@/app/api/members/token-usage/route')
    GET = routeModule.GET
  })

  describe('validation', () => {
    it('returns 400 when guild parameter is missing', async () => {
      const request = new Request(
        'http://localhost/api/members/token-usage?season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Guild and season parameters re')
    })

    it('returns 400 when season parameter is missing', async () => {
      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Guild and season parameters re')
    })
  })

  describe('authentication', () => {
    beforeEach(() => {
      mockServiceSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { cluster_code: 'EOT' },
          error: null
        })
      })
    })

    it('allows members to view token usage for their own guild', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'member', cluster_code: 'EOT' },
          error: null
        })
      })
      mockGetTokenUsage.mockResolvedValue([])
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            player_id: 'player-1',
            display_name: 'Player1',
            tokens_available: 2,
            token_next_in_seconds: 3600,
            bombs_available: 1,
            next_bomb_seconds: 1800,
            data_source: 'live',
            tokens_used: 3,
            max_possible: 21
          }
        ],
        debug: {
          total_battles: 3,
          current_season_battles: 3,
          previous_season_battles: 0,
          seasons_checked: ['45']
        }
      })

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual([
        expect.objectContaining({
          display_name: 'Player1',
          player_id: 'player-1',
          tokens_available: 2,
          data_source: 'live'
        })
      ])
    })

    it('returns 403 when member tries to access a different guild in the same cluster', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            guild_code: 'MYGUILD',
            role: 'member',
            cluster_code: 'EOT'
          },
          error: null
        })
      })

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
    })

    it('returns 403 when officer tries to access different guild/cluster', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            guild_code: 'MYGUILD',
            role: 'officer',
            cluster_code: 'OTHER'
          },
          error: null
        })
      })

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
    })

    it('returns 403 when leader tries to access a different cluster', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            guild_code: 'MYGUILD',
            role: 'leader',
            cluster_code: 'OTHER'
          },
          error: null
        })
      })

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('different cluster')
      expect(mockGetTokenUsage).not.toHaveBeenCalled()
      expect(mockLoadGuildTokenStatuses).not.toHaveBeenCalled()
    })

    it('allows officers to view token usage for a same-cluster guild', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            guild_code: 'MYGUILD',
            role: 'officer',
            cluster_code: 'EOT'
          },
          error: null
        })
      })
      mockGetTokenUsage.mockResolvedValue([])
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            player_id: 'player-1',
            display_name: 'Player1',
            tokens_available: 2,
            token_next_in_seconds: 3600,
            bombs_available: 1,
            next_bomb_seconds: 1800,
            data_source: 'live',
            tokens_used: 3,
            max_possible: 21
          }
        ],
        debug: {}
      })

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual([
        expect.objectContaining({
          display_name: 'Player1',
          player_id: 'player-1'
        })
      ])
      expect(mockGetTokenUsage).toHaveBeenCalledWith(
        'TEST',
        '45',
        expect.anything()
      )
      expect(mockLoadGuildTokenStatuses).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          guildCode: 'TEST',
          season: '45',
          clusterCode: 'EOT',
          verifyLiveRoster: false,
          skipLiveOverlay: false
        })
      )
    })
  })

  describe('guild validation', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'officer', cluster_code: 'EOT' },
          error: null
        })
      })
    })

    it('returns 404 when guild is not found', async () => {
      mockGuildConfigGetBasic.mockResolvedValue(null)

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=NOTFOUND&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error.message).toBe('Guild not found')
    })
  })

  describe('successful queries', () => {
    const mockUsageData = [
      {
        display_name: 'Player1',
        player_id: 'player-1',
        tokens_used: 15,
        max_possible: 21,
        bombs_used: 2,
        bombs_available: 1
      }
    ]

    const mockMembers = [
      {
        player_id: 'player-1',
        display_name: 'Player1',
        user_id: 'user-1',
        last_sync_tokens: 2,
        last_sync_bombs: 1,
        last_sync_at: '2025-01-15T10:00:00Z',
        api_key_is_valid: true,
        tacticus_api_key_encrypted: 'encrypted'
      },
      {
        player_id: 'player-2',
        display_name: 'Player2',
        user_id: 'user-2',
        last_sync_tokens: null,
        last_sync_bombs: null,
        last_sync_at: null,
        api_key_is_valid: null,
        tacticus_api_key_encrypted: null
      }
    ]

    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'officer', cluster_code: 'EOT' },
          error: null
        })
      })

      mockGetTokenUsage.mockResolvedValue(mockUsageData)
    })

    it('returns an empty array when both token sources succeed with no data', async () => {
      mockGetTokenUsage.mockResolvedValue([])
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [],
        debug: {
          total_battles: 0,
          current_season_battles: 0,
          previous_season_battles: 0,
          seasons_checked: ['45']
        }
      })

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual([])
    })

    it('returns token usage for all guild members', async () => {
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            player_id: 'player-1',
            display_name: 'Player1',
            tokens_available: 2,
            token_next_in_seconds: 3600,
            bombs_available: 1,
            next_bomb_seconds: 1800,
            data_source: 'live',
            tokens_used: 15,
            max_possible: 21,
            burned_tokens: 0,
            time_over_cap_seconds: 0
          },
          {
            player_id: 'player-2',
            display_name: 'Player2',
            tokens_available: 3,
            token_next_in_seconds: null,
            bombs_available: 0,
            next_bomb_seconds: null,
            data_source: 'calculated',
            tokens_used: 0,
            max_possible: 21,
            burned_tokens: 0,
            time_over_cap_seconds: 0
          }
        ],
        debug: {
          total_battles: 15,
          current_season_battles: 15,
          previous_season_battles: 0,
          seasons_checked: ['45']
        }
      })
      mockServiceSupabase.rpc.mockResolvedValue({ data: null, error: null })

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(Array.isArray(body)).toBe(true)
      expect(body.length).toBe(2)
    })

    it('uses canonical lowercase UUID guild code for downstream reads', async () => {
      const inputGuild = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF'
      const canonicalGuild = 'abcdefab-cdef-4abc-8def-abcdefabcdef'

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            guild_code: inputGuild,
            role: 'officer',
            cluster_code: 'EOT'
          },
          error: null
        })
      })
      mockGuildConfigGetBasic.mockResolvedValue({
        guild_code: canonicalGuild,
        cluster_code: 'EOT'
      })
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            player_id: 'player-1',
            display_name: 'Player1',
            tokens_available: 2,
            token_next_in_seconds: 3600,
            bombs_available: 1,
            next_bomb_seconds: 1800,
            data_source: 'live',
            tokens_used: 15,
            max_possible: 21
          }
        ],
        debug: {
          total_battles: 15,
          current_season_battles: 15,
          previous_season_battles: 0,
          seasons_checked: ['100']
        }
      })

      const request = new Request(
        `http://localhost/api/members/token-usage?guild=${inputGuild}&season=100`
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(mockGuildConfigGetBasic).toHaveBeenCalledWith(
        expect.anything(),
        inputGuild
      )
      expect(mockGetTokenUsage).toHaveBeenCalledWith(
        canonicalGuild,
        '100',
        expect.anything()
      )
      expect(mockLoadGuildTokenStatuses).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          guildCode: canonicalGuild,
          season: '100',
          clusterCode: 'EOT',
          verifyLiveRoster: false,
          skipLiveOverlay: false
        })
      )
    })

    it('matches usage by player id before display name aliases', async () => {
      mockGetTokenUsage.mockResolvedValue([
        {
          display_name: 'Bravo',
          player_id: 'player-2',
          tokens_used: 10,
          max_possible: 21,
          bombs_used: 2,
          bombs_available: 1
        },
        {
          display_name: 'player-2',
          player_id: 'player-1',
          tokens_used: 1,
          max_possible: 21,
          bombs_used: 0,
          bombs_available: 0
        }
      ])
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            player_id: 'player-2',
            display_name: 'Bravo',
            tokens_available: 2,
            token_next_in_seconds: 3600,
            bombs_available: 1,
            next_bomb_seconds: 1800,
            data_source: 'live',
            tokens_used: 0,
            max_possible: 21
          }
        ],
        debug: {
          total_battles: 11,
          current_season_battles: 11,
          previous_season_battles: 0,
          seasons_checked: ['146']
        }
      })

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=146'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toHaveLength(1)
      expect(body[0]).toEqual(
        expect.objectContaining({
          player_id: 'player-2',
          display_name: 'Bravo',
          tokens_used: 10
        })
      )
    })

    it('includes token availability calculations', async () => {
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [
          {
            player_id: 'player-1',
            display_name: 'Player1',
            tokens_available: 2,
            token_next_in_seconds: 3600,
            bombs_available: 1,
            next_bomb_seconds: 1800,
            data_source: 'live',
            tokens_used: 15,
            max_possible: 21,
            burned_tokens: 0,
            time_over_cap_seconds: 0
          }
        ],
        debug: {
          total_battles: 15,
          current_season_battles: 15,
          previous_season_battles: 0,
          seasons_checked: ['45']
        }
      })
      mockServiceSupabase.rpc.mockResolvedValue({ data: null, error: null })

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body[0]).toEqual(
        expect.objectContaining({
          tokens_available: 2,
          token_next_in_seconds: 3600,
          bombs_available_live: 1,
          bomb_next_in_seconds: 1800,
          data_source: 'live',
          burned_tokens: null,
          time_over_cap_seconds: null
        })
      )
      expect(mockLoadGuildTokenStatuses).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          guildCode: 'TEST',
          season: '45',
          clusterCode: 'EOT',
          verifyLiveRoster: false,
          skipLiveOverlay: false
        })
      )
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'officer', cluster_code: 'EOT' },
          error: null
        })
      })
    })

    it('returns retryable 503 when token usage fetch fails on cold cache', async () => {
      const createThenable = (result: { data: unknown; error: unknown }) => {
        const chainable: Record<string, unknown> = {}
        chainable.select = vi.fn().mockReturnValue(chainable)
        chainable.eq = vi.fn().mockReturnValue(chainable)
        chainable.single = vi.fn().mockResolvedValue(result)
        chainable.then = (
          onFulfilled?: (value: { data: unknown; error: unknown }) => unknown,
          onRejected?: (reason: unknown) => unknown
        ) => {
          return Promise.resolve(result).then(onFulfilled, onRejected)
        }
        return chainable
      }

      mockServiceSupabase.from.mockReturnValue(
        createThenable({ data: { cluster_code: 'EOT' }, error: null })
      )
      mockGetTokenUsage.mockRejectedValue(new Error('Database error'))

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error.message).toBe(
        'Token usage data temporarily unavailable'
      )
      expect(body.error.retryable).toBe(true)
    })

    it('returns retryable 503 when guild token statuses fail on cold cache', async () => {
      mockLoadGuildTokenStatuses.mockRejectedValue(
        new Error('Members fetch failed')
      )
      mockGetTokenUsage.mockResolvedValue([])

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error.message).toBe(
        'Token usage data temporarily unavailable'
      )
      expect(body.error.retryable).toBe(true)
    })

    it('serves stale cached token usage when refresh fails', async () => {
      const nowSpy = vi.spyOn(Date, 'now')
      nowSpy.mockReturnValue(1_000_000)

      mockGetTokenUsage.mockResolvedValue([
        {
          display_name: 'Player1',
          player_id: 'player-1',
          tokens_used: 12,
          max_possible: 21,
          bombs_used: 2,
          bombs_available: 1
        }
      ])
      mockLoadGuildTokenStatuses.mockResolvedValueOnce({
        players: [
          {
            player_id: 'player-1',
            display_name: 'Player1',
            tokens_available: 2,
            token_next_in_seconds: 3600,
            bombs_available: 1,
            next_bomb_seconds: 1800,
            data_source: 'live',
            tokens_used: 12,
            max_possible: 21
          }
        ],
        debug: {}
      })

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const firstResponse = await GET(request)
      const firstBody = await firstResponse.json()

      expect(firstResponse.status).toBe(200)
      expect(firstBody).toHaveLength(1)

      nowSpy.mockReturnValue(1_000_000 + 5 * 60 * 1000 + 1)
      mockLoadGuildTokenStatuses.mockRejectedValueOnce(
        new Error('Members fetch failed')
      )

      const staleResponse = await GET(request)
      const staleBody = await staleResponse.json()

      expect(staleResponse.status).toBe(200)
      expect(staleBody).toEqual(firstBody)
      expect(mockLoadGuildTokenStatuses).toHaveBeenCalledTimes(2)
    })

    it('fails closed when auth lookup errors before service-role reads', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Unexpected error'))

      const request = new Request(
        'http://localhost/api/members/token-usage?guild=TEST&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error.message).toBe('Authentication check failed')
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
    })
  })
})
