import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>
let mockDecryptApiKey: ReturnType<typeof vi.fn>
let mockResolveStoredSecret: ReturnType<typeof vi.fn>
let mockValidateGuildCode: ReturnType<typeof vi.fn>
let mockAutoPatchGuildConfig: ReturnType<typeof vi.fn>
let mockDetectCurrentGWSeasonFromGuildData: ReturnType<typeof vi.fn>
let mockFetchGuildRaidData: ReturnType<typeof vi.fn>
let mockFetchGuildMembersViaTacticus: ReturnType<typeof vi.fn>
let mockFetchGuildMembersViaLoki: ReturnType<typeof vi.fn>
let mockFetchBossMappings: ReturnType<typeof vi.fn>
let mockValidateBossMappings: ReturnType<typeof vi.fn>
let mockUpdateSyncStatus: ReturnType<typeof vi.fn>
let mockExtractEntries: ReturnType<typeof vi.fn>
let mockDetectSeason: ReturnType<typeof vi.fn>
let mockFilterValidEntries: ReturnType<typeof vi.fn>
let mockProcessRaidEntry: ReturnType<typeof vi.fn>
let mockFilterProcessedData: ReturnType<typeof vi.fn>
let mockUpsertDataBatches: ReturnType<typeof vi.fn>
let mockFetchGuildRankings: ReturnType<typeof vi.fn>
let mockUpdateGuildConfigAfterSync: ReturnType<typeof vi.fn>
let mockBuildSyncSuccessResponse: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>

describe('POST /api/guild/initial-sync', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    functions: { invoke: ReturnType<typeof vi.fn> }
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('LOKI_SCRAPER_CLIENT_SECRET', 'server-loki-secret')

    mockCreateServiceClient = vi.fn()
    mockApiSecurityMiddleware = vi.fn().mockResolvedValue(null)
    mockDecryptApiKey = vi.fn()
    mockResolveStoredSecret = vi.fn().mockImplementation(async (value) => value)
    mockValidateGuildCode = vi.fn()
    mockAutoPatchGuildConfig = vi.fn()
    mockDetectCurrentGWSeasonFromGuildData = vi.fn()
    mockFetchGuildRaidData = vi.fn()
    mockFetchGuildMembersViaTacticus = vi.fn()
    mockFetchGuildMembersViaLoki = vi.fn()
    mockFetchBossMappings = vi.fn()
    mockValidateBossMappings = vi.fn()
    mockUpdateSyncStatus = vi.fn()
    mockExtractEntries = vi.fn()
    mockDetectSeason = vi.fn()
    mockFilterValidEntries = vi.fn()
    mockProcessRaidEntry = vi.fn()
    mockFilterProcessedData = vi.fn()
    mockUpsertDataBatches = vi.fn()
    mockFetchGuildRankings = vi.fn()
    mockUpdateGuildConfigAfterSync = vi.fn()
    mockBuildSyncSuccessResponse = vi.fn()
    mockValidateApiKeyWithTacticus = vi.fn().mockResolvedValue({
      isValid: true,
      canAccessGuild: true,
      canAccessRaidData: true,
      guildInfo: {
        guildCode: 'TEST',
        guildId: 'guild-123',
        guildName: 'Test Guild'
      }
    })

    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus
    }))

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))

    vi.doMock('@tacticus/app-core/encryption', () => ({
      decryptApiKey: mockDecryptApiKey,
      resolveStoredSecret: mockResolveStoredSecret
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    vi.doMock('@/app/lib/validation/schemas', () => ({
      validateGuildCode: mockValidateGuildCode
    }))

    vi.doMock('@/app/lib/sync/api-operations', () => ({
      autoPatchGuildConfig: mockAutoPatchGuildConfig,
      detectCurrentGWSeasonFromGuildData:
        mockDetectCurrentGWSeasonFromGuildData,
      fetchGuildRaidData: mockFetchGuildRaidData,
      fetchGuildMembersViaTacticus: mockFetchGuildMembersViaTacticus,
      fetchGuildMembersViaLoki: mockFetchGuildMembersViaLoki,
      fetchGuildRankings: mockFetchGuildRankings
    }))

    vi.doMock('@/app/lib/sync/db-operations', () => ({
      fetchBossMappings: mockFetchBossMappings,
      validateBossMappings: mockValidateBossMappings,
      analyzeBossMappingCoverage: vi.fn().mockResolvedValue({}),
      beginGuildRosterObservation: vi
        .fn()
        .mockResolvedValue('2026-08-20T19:45:00.000Z'),
      savePlayerMappings: vi.fn().mockResolvedValue(undefined),
      trackUnitIds: vi.fn().mockResolvedValue({}),
      updateBombTracking: vi.fn().mockResolvedValue(undefined),
      upsertDataBatches: mockUpsertDataBatches,
      updateSyncStatus: mockUpdateSyncStatus,
      updateGuildConfigAfterSync: mockUpdateGuildConfigAfterSync,
      loadExistingPlayerMappings: vi.fn().mockResolvedValue(new Map()),
      getErrorMessage: vi.fn((e) =>
        e instanceof Error ? e.message : String(e)
      ),
      buildSyncSuccessResponse: mockBuildSyncSuccessResponse
    }))

    vi.doMock('@/app/lib/sync/transformers', () => ({
      processRaidEntry: mockProcessRaidEntry,
      handleDuplicateDisplayNames: vi.fn((members) => members),
      detectSeason: mockDetectSeason,
      extractEntries: mockExtractEntries,
      filterValidEntries: mockFilterValidEntries,
      filterProcessedData: mockFilterProcessedData
    }))

    mockSupabase = {
      from: vi.fn(),
      functions: { invoke: vi.fn() }
    }
    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      single: vi.fn().mockResolvedValue({
        data: { guild_id: 'guild-123' },
        error: null
      })
    })

    mockCreateServiceClient.mockReturnValue(mockSupabase)
    mockValidateGuildCode.mockImplementation((code: string) =>
      code.toUpperCase()
    )

    const routeModule = await import('@/app/api/guild/initial-sync/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  describe('validation', () => {
    it('returns 400 when guild_code is missing', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ api_key: 'test-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error).toBeDefined()
      expect(body.error.message).toContain('Missing required fields')
    })

    it('returns 400 when api_key is missing', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Missing required fields')
    })
  })

  describe('guild identity binding', () => {
    it('returns 401 when API key is invalid', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'API key is invalid',
        canAccessGuild: false,
        canAccessRaidData: false
      })

      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST', api_key: 'invalid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('API key is invalid')
    })

    it('returns 400 when API key belongs to different guild', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildCode: 'OTHER',
          guildId: 'other-id',
          guildName: 'Other Guild'
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            guild_code: 'TEST',
            api_key: 'valid-key-wrong-guild'
          })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain(
        'API key belongs to a different guild'
      )
    })
  })

  describe('API key decryption', () => {
    beforeEach(() => {
      mockAutoPatchGuildConfig.mockResolvedValue({
        guild_id: 'guild-123',
        user_id: 'user-123',
        session_id: 'session-123',
        client_secret: 'secret-123'
      })
    })

    it('decrypts API key when it contains colon separator', async () => {
      mockDecryptApiKey.mockResolvedValue('decrypted-key')
      mockFetchGuildRaidData.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('')
      })

      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST', api_key: 'iv:encrypted' })
        }
      )

      await POST(request)

      expect(mockDecryptApiKey).toHaveBeenCalledWith('iv:encrypted')
    })

    it('uses raw API key when decryption fails', async () => {
      mockDecryptApiKey.mockRejectedValue(new Error('Decryption failed'))
      mockFetchGuildRaidData.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('')
      })

      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST', api_key: 'iv:bad-key' })
        }
      )

      await POST(request)

      expect(mockFetchGuildRaidData).toHaveBeenCalled()
    })
  })

  describe('API errors', () => {
    beforeEach(() => {
      mockAutoPatchGuildConfig.mockResolvedValue({
        guild_id: 'guild-123',
        user_id: 'user-123',
        session_id: 'session-123',
        client_secret: 'secret-123'
      })
      mockDetectCurrentGWSeasonFromGuildData.mockResolvedValue(null)
    })

    it('returns 500 with Invalid API key for 401 response', async () => {
      mockFetchGuildRaidData.mockResolvedValue({
        ok: false,
        status: 401,
        text: () => Promise.resolve('Unauthorized')
      })

      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST', api_key: 'invalid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Invalid API key')
    })

    it('returns 500 with not authorized for 403 response', async () => {
      mockFetchGuildRaidData.mockResolvedValue({
        ok: false,
        status: 403,
        text: () => Promise.resolve('Forbidden')
      })

      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST', api_key: 'forbidden-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('API key not authorized')
    })
  })

  describe('no data scenario', () => {
    beforeEach(() => {
      mockAutoPatchGuildConfig.mockResolvedValue({
        guild_id: 'guild-123',
        user_id: 'user-123',
        session_id: 'session-123',
        client_secret: 'secret-123'
      })
      mockDetectCurrentGWSeasonFromGuildData.mockResolvedValue(null)
      mockFetchGuildRaidData.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ raidEvents: [] })
      })
      mockExtractEntries.mockReturnValue([])
      mockDetectSeason.mockReturnValue('season-42')
    })

    it('returns success with no data message when entries empty', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST', api_key: 'valid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.message).toBe('No data to sync')
      expect(body.guild_code).toBe('TEST')
    })
  })

  describe('LOKI member fetch failure', () => {
    beforeEach(() => {
      mockAutoPatchGuildConfig.mockResolvedValue({
        guild_id: 'guild-123',
        user_id: 'user-123',
        session_id: 'session-123',
        client_secret: 'secret-123'
      })
      mockDetectCurrentGWSeasonFromGuildData.mockResolvedValue(null)
      mockFetchGuildRaidData.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ raidEvents: [{ id: '1' }] })
      })
      mockExtractEntries.mockReturnValue([{ id: '1' }])
      mockDetectSeason.mockReturnValue('season-42')
      mockFilterValidEntries.mockReturnValue([{ id: '1' }])
      mockFetchBossMappings.mockResolvedValue(new Map())
      mockValidateBossMappings.mockResolvedValue({ valid: true })
      mockFetchGuildMembersViaTacticus.mockResolvedValue({ success: false })
      mockFetchGuildMembersViaLoki.mockRejectedValue(
        new Error('LOKI session expired')
      )
      mockUpdateSyncStatus.mockResolvedValue(undefined)
    })

    it('returns 500 when LOKI member fetch fails', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST', api_key: 'valid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to retrieve player name')
      expect(body.error.metadata?.details).toBe('LOKI session expired')
    })
  })

  describe('missing LOKI credentials', () => {
    beforeEach(() => {
      mockAutoPatchGuildConfig.mockResolvedValue({
        guild_id: null,
        user_id: null,
        session_id: null,
        client_secret: null
      })
      mockDetectCurrentGWSeasonFromGuildData.mockResolvedValue(null)
      mockFetchGuildRaidData.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ raidEvents: [{ id: '1' }] })
      })
      mockExtractEntries.mockReturnValue([{ id: '1' }])
      mockDetectSeason.mockReturnValue('season-42')
      mockFilterValidEntries.mockReturnValue([{ id: '1' }])
      mockFetchBossMappings.mockResolvedValue(new Map())
      mockValidateBossMappings.mockResolvedValue({ valid: true })
      mockFetchGuildMembersViaTacticus.mockResolvedValue({ success: false })
    })

    it('returns 500 when LOKI credentials are missing', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST', api_key: 'valid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Missing required LOKI credentials')
    })
  })

  describe('successful sync', () => {
    beforeEach(() => {
      mockAutoPatchGuildConfig.mockResolvedValue({
        guild_id: 'guild-123',
        user_id: 'user-123',
        session_id: 'session-123',
        client_secret: 'secret-123',
        cluster_code: 'EOT',
        cluster_id: 'cluster-1'
      })
      mockDetectCurrentGWSeasonFromGuildData.mockResolvedValue(null)
      mockFetchGuildRaidData.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({ raidEvents: [{ id: '1', playerId: 'p1' }] })
      })
      mockExtractEntries.mockReturnValue([{ id: '1', playerId: 'p1' }])
      mockDetectSeason.mockReturnValue('season-42')
      mockFilterValidEntries.mockReturnValue([{ id: '1', playerId: 'p1' }])
      mockFetchBossMappings.mockResolvedValue(
        new Map([['boss1', { name: 'Boss 1' }]])
      )
      mockValidateBossMappings.mockResolvedValue({ valid: true })
      mockFetchGuildMembersViaTacticus.mockResolvedValue({
        success: true,
        memberIds: ['member-1']
      })
      mockFetchGuildMembersViaLoki.mockResolvedValue({
        members: [{ userId: 'p1', displayName: 'Player 1' }],
        authFailed: false
      })
      mockProcessRaidEntry.mockReturnValue({ id: '1', Player: 'Player 1' })
      mockFilterProcessedData.mockReturnValue([{ id: '1', Player: 'Player 1' }])
      mockUpsertDataBatches.mockResolvedValue({
        upserted: 1,
        inserted: 1,
        updated: 0,
        errors: 0
      })
      mockFetchGuildRankings.mockResolvedValue({ guildRaid: 5, guildWar: 10 })
      mockUpdateGuildConfigAfterSync.mockResolvedValue(undefined)
      mockUpdateSyncStatus.mockResolvedValue(undefined)
      mockBuildSyncSuccessResponse.mockReturnValue({
        success: true,
        guild_code: 'TEST',
        season: 'season-42',
        records_synced: 1
      })
    })

    it('returns success with sync results', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'test', api_key: 'valid-key' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(mockUpdateSyncStatus).toHaveBeenCalledWith(
        expect.anything(),
        'TEST',
        'completed',
        expect.objectContaining({ recordsSynced: 1 })
      )
      expect(mockUpdateGuildConfigAfterSync).toHaveBeenCalledWith(
        expect.anything(),
        'TEST',
        { guildRaid: 5, guildWar: 10 },
        true
      )
    })

    it('does not report a roster read when LOKI returned no members', async () => {
      mockFetchGuildMembersViaLoki.mockResolvedValue({
        members: [],
        authFailed: false
      })
      const request = new NextRequest(
        'http://localhost/api/guild/initial-sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'test', api_key: 'valid-key' })
        }
      )

      await POST(request)

      expect(mockUpdateGuildConfigAfterSync).toHaveBeenCalledWith(
        expect.anything(),
        'TEST',
        expect.anything(),
        false
      )
    })
  })
})
