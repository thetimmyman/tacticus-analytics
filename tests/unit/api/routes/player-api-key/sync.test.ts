import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockGetPlayerApiKey: ReturnType<typeof vi.fn>
let mockTacticusAPI: {
  getPlayer: ReturnType<typeof vi.fn>
  validateApiKey: ReturnType<typeof vi.fn>
  getCurrentGuildRaid: ReturnType<typeof vi.fn>
}

describe('POST /api/player-api-key/sync', () => {
  let POST: () => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: typeof mockSupabase

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockGetPlayerApiKey = vi.fn()
    mockTacticusAPI = {
      getPlayer: vi.fn(),
      validateApiKey: vi.fn(),
      getCurrentGuildRaid: vi.fn()
    }

    // The route reads its own row via serviceDb(); the key column is not granted to `authenticated`.
    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: () => mockServiceSupabase
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

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getBasic: vi
          .fn()
          .mockResolvedValue({ cluster_code: 'EOT', cluster_id: 1 })
      }
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn(),
      rpc: vi.fn()
    }
    mockServiceSupabase = mockSupabase

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/player-api-key/sync/route')
    POST = routeModule.POST
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: null
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.code).toBe(1001) // UNAUTHORIZED
    })

    it('returns 401 when auth errors', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Auth error' }
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.code).toBe(1001) // UNAUTHORIZED
    })
  })

  describe('player mapping', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 404 when player profile not found (PGRST116)', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116', message: 'No rows found' }
        })
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error.code).toBe(3001) // NOT_FOUND
    })

    it('returns 500 on database error', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST500', message: 'Database error' }
        })
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.code).toBe(5001)
    })

    it('returns 404 when player mapping is null', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: null
        })
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error.code).toBe(3001) // NOT_FOUND
    })
  })

  describe('API key handling', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 400 when no API key configured', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            tacticus_api_key_encrypted: null,
            player_id: 'player-123',
            display_name: 'TestPlayer',
            guild_code: 'TEST'
          },
          error: null
        })
      })
      mockGetPlayerApiKey.mockResolvedValue(null)

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.code).toBe(2001) // VALIDATION
    })

    it('returns 401 when API key is invalid', async () => {
      const playerMappingData = {
        tacticus_api_key_encrypted: 'encrypted',
        player_id: 'player-123',
        display_name: 'TestPlayer',
        guild_code: 'TEST'
      }

      const createFromChain = () => {
        const chain: any = {
          select: vi.fn(() => chain),
          eq: vi.fn(() => chain),
          single: vi
            .fn()
            .mockResolvedValue({ data: playerMappingData, error: null }),
          update: vi.fn(() => chain)
        }
        return chain
      }

      mockSupabase.from.mockReturnValue(createFromChain())
      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.validateApiKey.mockResolvedValue(false)

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.code).toBe(1001) // UNAUTHORIZED
    })
  })

  describe('player data fetch', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 503 when player data fetch fails', async () => {
      let callCount = 0
      mockSupabase.from.mockImplementation(() => {
        callCount++
        if (callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: {
                tacticus_api_key_encrypted: 'encrypted',
                player_id: 'player-123',
                display_name: 'TestPlayer',
                guild_code: 'TEST'
              },
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
      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.validateApiKey.mockResolvedValue(true)
      mockTacticusAPI.getPlayer.mockResolvedValue(null)

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(503)
      expect(body.error.code).toBe(4001) // EXTERNAL_API_ERROR
    })
  })

  describe('successful sync', () => {
    const mockPlayerMapping = {
      tacticus_api_key_encrypted: 'encrypted',
      player_id: 'player-123',
      display_name: 'TestPlayer',
      guild_code: 'TEST'
    }

    const mockPlayerData = {
      progress: {
        guildRaid: {
          tokens: { current: 2, nextTokenInSeconds: 3600 },
          bombTokens: { current: 1, nextTokenInSeconds: 7200 }
        }
      }
    }

    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.validateApiKey.mockResolvedValue(true)
      mockTacticusAPI.getPlayer.mockResolvedValue(mockPlayerData)
    })

    it('syncs token status successfully without guild raid data', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: mockPlayerMapping, error: null }),
            update: vi.fn().mockReturnThis()
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnThis()
        }
      })
      mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue(null)

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.tokenInfo).toBeDefined()
      expect(body.tokenInfo.tokensAvailable).toBe(2)
      expect(body.tokenInfo.bombsAvailable).toBe(1)
    })

    it('keeps credential reads and writes off the authenticated client', async () => {
      const serviceFrom = vi.fn()
      const mappingRead = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: mockPlayerMapping, error: null })
      }
      const mappingUpdate = {
        error: null,
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis()
      }
      serviceFrom
        .mockReturnValueOnce(mappingRead)
        .mockReturnValueOnce(mappingUpdate)
      mockServiceSupabase = {
        auth: { getUser: vi.fn() },
        from: serviceFrom,
        rpc: vi.fn()
      }
      mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue(null)

      const response = await POST()

      expect(response.status).toBe(200)
      expect(mockSupabase.from).not.toHaveBeenCalled()
      expect(serviceFrom).toHaveBeenNthCalledWith(1, 'player_mapping')
      expect(serviceFrom).toHaveBeenNthCalledWith(2, 'player_mapping')
      expect(mappingUpdate.update).toHaveBeenCalledWith(
        expect.objectContaining({ api_key_is_valid: true })
      )
    })

    it('fails closed when the privileged token-status update fails', async () => {
      const mappingRead = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: mockPlayerMapping, error: null })
      }
      const mappingUpdate = {
        error: { message: 'write denied' },
        update: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis()
      }
      mockServiceSupabase = {
        auth: { getUser: vi.fn() },
        from: vi
          .fn()
          .mockReturnValueOnce(mappingRead)
          .mockReturnValueOnce(mappingUpdate),
        rpc: vi.fn()
      }
      mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue(null)

      const response = await POST()

      expect(response.status).toBe(500)
    })

    it('syncs battle data when guild raid entries exist', async () => {
      let callCount = 0
      const upsert = vi.fn().mockResolvedValue({ error: null })
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'player_mapping' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: mockPlayerMapping, error: null })
          }
        }
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { cluster_code: 'EOT', cluster_id: 1 },
              error: null
            })
          }
        }
        if (table === 'EOT_GR_data') {
          return {
            upsert
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis()
        }
      })
      mockSupabase.rpc.mockResolvedValue({ data: '45' })

      mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue({
        entries: [
          {
            username: 'TestPlayer',
            damageType: 'Battle',
            damageDealt: 50000,
            tier: 6,
            set: 1,
            startedOn: 1700000000.827,
            completedOn: 1700000100.993,
            encounterType: 'Boss',
            encounterIndex: 0
          }
        ],
        season: 45
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.battlesUpdated).toBe(1)
      expect(upsert).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            startedOn: '2023-11-14T22:13:20.000Z',
            completedOn: '2023-11-14T22:15:00.000Z'
          })
        ],
        expect.objectContaining({
          onConflict:
            'Guild,Season,userId,encounterId,startedOn,completedOn,damageDealt,damageType'
        })
      )
    })

    it('WI-4700: refuses an entry whose userId belongs to another player', async () => {
      // A player's key returns the WHOLE GUILD's entries; matching on display name would write a same-named
      // guildmate's rows under the caller. Match on userId.
      const upsert = vi.fn().mockResolvedValue({ error: null })
      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'player_mapping' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: mockPlayerMapping, error: null })
          }
        }
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { cluster_code: 'EOT', cluster_id: 1 },
              error: null
            })
          }
        }
        if (table === 'EOT_GR_data') return { upsert }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis()
        }
      })
      mockSupabase.rpc.mockResolvedValue({ data: '45' })

      mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue({
        entries: [
          {
            username: 'TestPlayer',
            userId: 'someone-else-456',
            damageType: 'Battle',
            damageDealt: 999999,
            tier: 6,
            set: 1,
            startedOn: 1700000000.827,
            completedOn: 1700000100.993,
            encounterType: 'Boss',
            encounterIndex: 0
          }
        ],
        season: 45
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.battlesUpdated).toBe(0)
      expect(upsert).not.toHaveBeenCalled()
    })

    it('handles no battles found for player in guild raid', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: mockPlayerMapping, error: null }),
            update: vi.fn().mockReturnThis()
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnThis()
        }
      })

      mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue({
        entries: [
          { username: 'OtherPlayer', damageType: 'Battle', damageDealt: 30000 }
        ],
        season: 45
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.battlesUpdated).toBe(0)
    })

    it('includes all token types in response', async () => {
      const fullPlayerData = {
        progress: {
          guildRaid: {
            tokens: { current: 3, nextTokenInSeconds: 1800 },
            bombTokens: { current: 2, nextTokenInSeconds: 3600 }
          },
          arena: { tokens: { current: 5, nextTokenInSeconds: 900 } },
          onslaught: { tokens: { current: 3, nextTokenInSeconds: 1200 } },
          salvageRun: { tokens: { current: 4, nextTokenInSeconds: 600 } },
          expedition: { tokens: { current: 2, nextTokenInSeconds: 2400 } }
        }
      }
      mockTacticusAPI.getPlayer.mockResolvedValue(fullPlayerData)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: mockPlayerMapping, error: null }),
            update: vi.fn().mockReturnThis()
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnThis()
        }
      })
      mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue(null)

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.tokenInfo.tokensAvailable).toBe(3)
      expect(body.tokenInfo.bombsAvailable).toBe(2)
      expect(body.tokenInfo.arenaTokens).toBe(5)
      expect(body.tokenInfo.onslaughtTokens).toBe(3)
      expect(body.tokenInfo.salvageTokens).toBe(4)
      expect(body.tokenInfo.expeditionTokens).toBe(2)
    })
  })

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Unexpected error'))

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.code).toBe(5001)
    })

    it('handles upsert error gracefully', async () => {
      const mockPlayerMapping = {
        tacticus_api_key_encrypted: 'encrypted',
        player_id: 'player-123',
        display_name: 'TestPlayer',
        guild_code: 'TEST'
      }

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.validateApiKey.mockResolvedValue(true)
      mockTacticusAPI.getPlayer.mockResolvedValue({
        progress: {
          guildRaid: {
            tokens: { current: 2 },
            bombTokens: { current: 1 }
          }
        }
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'player_mapping' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: mockPlayerMapping, error: null })
          }
        }
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { cluster_code: 'EOT', cluster_id: 1 },
              error: null
            })
          }
        }
        if (table === 'EOT_GR_data') {
          return {
            upsert: vi
              .fn()
              .mockResolvedValue({ error: { message: 'Upsert failed' } })
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis()
        }
      })
      mockSupabase.rpc.mockResolvedValue({ data: '45' })

      mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue({
        entries: [
          {
            username: 'TestPlayer',
            damageType: 'Battle',
            damageDealt: 50000,
            startedOn: 1700000000,
            completedOn: 1700000100
          }
        ],
        season: 45
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })

    it('skips player raid entries without stable timestamps', async () => {
      const mockPlayerMapping = {
        tacticus_api_key_encrypted: 'encrypted',
        player_id: 'player-123',
        display_name: 'TestPlayer',
        guild_code: 'TEST'
      }
      const upsert = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.validateApiKey.mockResolvedValue(true)
      mockTacticusAPI.getPlayer.mockResolvedValue({
        progress: {
          guildRaid: {
            tokens: { current: 2 },
            bombTokens: { current: 1 }
          }
        }
      })

      let callCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        callCount++
        if (table === 'player_mapping' && callCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: mockPlayerMapping, error: null })
          }
        }
        if (table === 'EOT_GR_data') {
          return { upsert }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis()
        }
      })
      mockSupabase.rpc.mockResolvedValue({ data: '45' })
      mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue({
        entries: [
          { username: 'TestPlayer', damageType: 'Battle', damageDealt: 50000 }
        ],
        season: 45
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.battlesUpdated).toBe(0)
      expect(upsert).not.toHaveBeenCalled()
    })

    it('handles player without guild code', async () => {
      const playerMappingNoGuild = {
        tacticus_api_key_encrypted: 'encrypted',
        player_id: 'player-123',
        display_name: 'TestPlayer',
        guild_code: null
      }

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.validateApiKey.mockResolvedValue(true)
      mockTacticusAPI.getPlayer.mockResolvedValue({
        progress: {
          guildRaid: {
            tokens: { current: 3 },
            bombTokens: { current: 1 }
          }
        }
      })
      mockTacticusAPI.getCurrentGuildRaid.mockResolvedValue(null)

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi
              .fn()
              .mockResolvedValue({ data: playerMappingNoGuild, error: null }),
            update: vi.fn().mockReturnThis()
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis()
        }
      })

      const response = await POST()
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })
  })
})
