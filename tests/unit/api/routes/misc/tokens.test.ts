import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockGetPlayerApiKey: ReturnType<typeof vi.fn>
let mockTacticusAPI: { getPlayer: ReturnType<typeof vi.fn> }
let mockRequireTokenUsageGuildAccess: ReturnType<typeof vi.fn>

describe('GET /api/tokens', () => {
  let GET: (req: NextRequest) => Promise<Response>
  let POST: (req: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceClient: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockGetPlayerApiKey = vi.fn()
    mockTacticusAPI = { getPlayer: vi.fn() }
    mockRequireTokenUsageGuildAccess = vi.fn().mockResolvedValue(undefined)

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))
    vi.doMock('@/app/api/members/token-usage/access', () => ({
      requireTokenUsageGuildAccess: mockRequireTokenUsageGuildAccess
    }))
    vi.doMock('@tacticus/app-core/api-key-helper', () => ({
      getPlayerApiKey: mockGetPlayerApiKey
    }))
    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: mockTacticusAPI
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
    mockServiceClient = {
      from: vi.fn()
    }
    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceClient)

    const routeModule = await import('@/app/api/tokens/route')
    GET = routeModule.GET
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createRequest = (playerId?: string, method: 'GET' | 'POST' = 'GET') => {
    const url = playerId
      ? `http://localhost/api/tokens?playerId=${playerId}`
      : 'http://localhost/api/tokens'
    return new NextRequest(url, { method })
  }

  describe('authentication', () => {
    it('returns 401 when not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'No session' }
      })

      const request = createRequest('player-123')
      const response = await GET(request)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error.message).toBe('Unauthorized')
    })
  })

  describe('validation', () => {
    it('returns 400 when playerId is missing', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })

      const request = createRequest()
      const response = await GET(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toBe('Player ID required')
    })
  })

  describe('player lookup', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
    })

    it('returns 404 when player not found', async () => {
      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      })

      const request = createRequest('nonexistent')
      const response = await GET(request)

      expect(response.status).toBe(404)
      const body = await response.json()
      expect(body.error.message).toBe('Player not found')
    })

    it('returns fallback data on database error', async () => {
      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST500', message: 'Database error' }
        })
      })

      const request = createRequest('player-123')
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.warnings).toContain('token_data_unavailable')
      expect(body.data.tokenSource).toBe('fallback')
    })
  })

  describe('authorization (IDOR guard)', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
    })

    it('returns 403 and performs no decrypt/refresh when the caller lacks guild access', async () => {
      const { Errors } = await import('@/app/lib/errors/AppError')
      mockRequireTokenUsageGuildAccess.mockRejectedValue(
        Errors.fromResponse(403, { error: 'Access denied - guild mismatch' })
      )

      const mockUpdate = vi.fn()
      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            display_name: 'VictimPlayer',
            guild_code: 'OTHERGUILD',
            cluster_code: 'OTHERCLUSTER',
            api_tokens: null,
            last_tokens_refresh: null,
            last_sync_tokens: 0,
            last_sync_bombs: 0,
            tacticus_api_key_encrypted: 'encrypted-victim-key',
            api_key_is_valid: true
          },
          error: null
        }),
        update: mockUpdate
      })

      const request = createRequest('victim-player-id')
      const response = await GET(request)

      expect(response.status).toBe(403)
      expect(mockRequireTokenUsageGuildAccess).toHaveBeenCalledWith(
        'OTHERGUILD'
      )
      expect(mockGetPlayerApiKey).not.toHaveBeenCalled()
      expect(mockTacticusAPI.getPlayer).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('returns 403 when the requested player has no guild association', async () => {
      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            display_name: 'OrphanPlayer',
            guild_code: null,
            cluster_code: null,
            api_tokens: null,
            last_tokens_refresh: null,
            last_sync_tokens: 0,
            last_sync_bombs: 0,
            tacticus_api_key_encrypted: 'encrypted-orphan-key',
            api_key_is_valid: true
          },
          error: null
        })
      })

      const request = createRequest('orphan-player-id')
      const response = await GET(request)

      expect(response.status).toBe(403)
      expect(mockRequireTokenUsageGuildAccess).not.toHaveBeenCalled()
      expect(mockGetPlayerApiKey).not.toHaveBeenCalled()
    })
  })

  describe('token data retrieval', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
    })

    it('returns cached token data when available', async () => {
      const cachedTokens = {
        tokensAvailable: 2,
        bombsAvailable: 1,
        nextTokenSeconds: 3600,
        nextBombSeconds: 7200
      }

      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            display_name: 'TestPlayer',
            guild_code: 'TESTGUILD',
            cluster_code: 'CLUSTER1',
            api_tokens: JSON.stringify(cachedTokens),
            last_tokens_refresh: '2026-01-01T00:00:00Z',
            last_sync_tokens: 2,
            last_sync_bombs: 1,
            tacticus_api_key_encrypted: null,
            api_key_is_valid: null
          },
          error: null
        })
      })

      const request = createRequest('player-123')
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.playerName).toBe('TestPlayer')
      expect(body.data.guildCode).toBe('TESTGUILD')
      expect(body.data.tokenSource).toBe('cached')
      expect(body.data.tokens.guildRaid.current).toBe(2)
    })

    it('PS-392: does not decrypt, call the live Tacticus API, or write to player_mapping', async () => {
      // GET is read-only even with a decryptable key; live fetch + persist is POST's job.
      const mockUpdate = vi.fn()
      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            display_name: 'TestPlayer',
            guild_code: 'TESTGUILD',
            cluster_code: 'CLUSTER1',
            api_tokens: null,
            last_tokens_refresh: null,
            last_sync_tokens: 0,
            last_sync_bombs: 0,
            tacticus_api_key_encrypted: 'cipher',
            api_key_is_valid: true
          },
          error: null
        }),
        update: mockUpdate
      })

      mockGetPlayerApiKey.mockResolvedValue('decrypted-api-key')
      mockTacticusAPI.getPlayer.mockResolvedValue({
        progress: {
          guildRaid: {
            tokens: { current: 3, nextTokenInSeconds: 1800 },
            bombTokens: { current: 1, nextTokenInSeconds: 3600 }
          }
        }
      })

      const request = createRequest('player-123')
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.tokenSource).not.toBe('live')
      expect(mockGetPlayerApiKey).not.toHaveBeenCalled()
      expect(mockTacticusAPI.getPlayer).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
    })

    it('adds warning when player has no API key', async () => {
      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            display_name: 'TestPlayer',
            guild_code: 'TESTGUILD',
            cluster_code: 'CLUSTER1',
            api_tokens: null,
            last_tokens_refresh: null,
            last_sync_tokens: 0,
            last_sync_bombs: 0,
            tacticus_api_key_encrypted: null,
            api_key_is_valid: null
          },
          error: null
        })
      })

      const request = createRequest('player-123')
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.warnings).toContain('player_api_key_missing')
      expect(body.data.hasPlayerApiKey).toBe(false)
    })

    it('adds warning when API key is invalid', async () => {
      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            display_name: 'TestPlayer',
            guild_code: 'TESTGUILD',
            cluster_code: 'CLUSTER1',
            api_tokens: null,
            last_tokens_refresh: null,
            last_sync_tokens: 0,
            last_sync_bombs: 0,
            tacticus_api_key_encrypted: 'invalid-key',
            api_key_is_valid: false
          },
          error: null
        })
      })

      mockGetPlayerApiKey.mockResolvedValue(null)

      const request = createRequest('player-123')
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.data.warnings).toContain('player_api_key_invalid')
    })
  })

  describe('token status normalization', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
    })

    it('returns correct token max values', async () => {
      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            display_name: 'TestPlayer',
            guild_code: 'TESTGUILD',
            cluster_code: 'CLUSTER1',
            api_tokens: null,
            last_tokens_refresh: null,
            last_sync_tokens: 3,
            last_sync_bombs: 1,
            tacticus_api_key_encrypted: null,
            api_key_is_valid: null
          },
          error: null
        })
      })

      const request = createRequest('player-123')
      const response = await GET(request)
      const body = await response.json()

      expect(body.data.tokens.guildRaid.max).toBe(3)
      expect(body.data.tokens.bomb.max).toBe(1)
      expect(body.data.tokens.arena.max).toBe(15)
      expect(body.data.tokens.onslaught.max).toBe(3)
      expect(body.data.tokens.salvageRun.max).toBe(2)
      expect(body.data.tokens.expedition.max).toBe(3)
    })
  })

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Unexpected error'))

      const request = createRequest('player-123')
      const response = await GET(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toBe('Internal server error')
    })

    // No user-client fallback: the key column is not granted to `authenticated`.
    it('fails loudly (500) when the service client cannot be constructed', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
      mockCreateServiceClient.mockImplementation(() => {
        throw new Error('Service role not configured')
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            display_name: 'TestPlayer',
            guild_code: 'TESTGUILD',
            cluster_code: 'CLUSTER1',
            api_tokens: null,
            last_tokens_refresh: null,
            last_sync_tokens: 0,
            last_sync_bombs: 0,
            tacticus_api_key_encrypted: null,
            api_key_is_valid: null
          },
          error: null
        })
      })

      const request = createRequest('player-123')
      const response = await GET(request)

      expect(response.status).toBe(500)
    })
  })

  describe('POST /api/tokens (refresh)', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user123' } }
      })
    })

    it('decrypts, calls the live Tacticus API, and persists the snapshot to player_mapping', async () => {
      mockGetPlayerApiKey.mockResolvedValue('decrypted-api-key')
      mockTacticusAPI.getPlayer.mockResolvedValue({
        progress: {
          guildRaid: {
            tokens: { current: 3, nextTokenInSeconds: 1800 },
            bombTokens: { current: 1, nextTokenInSeconds: 3600 }
          },
          arena: { current: 10, nextTokenInSeconds: 600 },
          onslaught: { current: 2, nextTokenInSeconds: 1200 },
          salvageRun: { current: 1, nextTokenInSeconds: 900 },
          expedition: { current: 2, nextTokenInSeconds: 1500 }
        }
      })

      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      })
      mockServiceClient.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                eq: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({
                    data: {
                      display_name: 'TestPlayer',
                      guild_code: 'TESTGUILD',
                      cluster_code: 'CLUSTER1',
                      api_tokens: null,
                      last_tokens_refresh: null,
                      last_sync_tokens: 0,
                      last_sync_bombs: 0,
                      tacticus_api_key_encrypted: 'cipher',
                      api_key_is_valid: true
                    },
                    error: null
                  })
                })
              })
            }),
            update: mockUpdate
          }
        }
        return { select: vi.fn() }
      })

      const request = createRequest('player-123', 'POST')
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.data.tokenSource).toBe('live')
      expect(body.data.tokens.guildRaid.current).toBe(3)
      expect(mockGetPlayerApiKey).toHaveBeenCalled()
      expect(mockTacticusAPI.getPlayer).toHaveBeenCalledWith(
        'decrypted-api-key'
      )
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          api_tokens: expect.any(String),
          last_tokens_refresh: expect.any(String)
        })
      )
    })

    it('requires the same auth as GET (401 when not authenticated)', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'No session' }
      })

      const request = createRequest('player-123', 'POST')
      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('still enforces the IDOR guild-access guard and performs no write when denied', async () => {
      const { Errors } = await import('@/app/lib/errors/AppError')
      mockRequireTokenUsageGuildAccess.mockRejectedValue(
        Errors.fromResponse(403, { error: 'Access denied - guild mismatch' })
      )

      const mockUpdate = vi.fn()
      mockServiceClient.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            display_name: 'VictimPlayer',
            guild_code: 'OTHERGUILD',
            cluster_code: 'OTHERCLUSTER',
            api_tokens: null,
            last_tokens_refresh: null,
            last_sync_tokens: 0,
            last_sync_bombs: 0,
            tacticus_api_key_encrypted: 'encrypted-victim-key',
            api_key_is_valid: true
          },
          error: null
        }),
        update: mockUpdate
      })

      const request = createRequest('victim-player-id', 'POST')
      const response = await POST(request)

      expect(response.status).toBe(403)
      expect(mockGetPlayerApiKey).not.toHaveBeenCalled()
      expect(mockTacticusAPI.getPlayer).not.toHaveBeenCalled()
      expect(mockUpdate).not.toHaveBeenCalled()
    })
  })
})
