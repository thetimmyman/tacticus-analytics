import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockGetPlayerApiKey: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockTacticusAPI: { getPlayerWithRetry: ReturnType<typeof vi.fn> }
let mockGuildConfigFindByCodeOrTag: ReturnType<typeof vi.fn>
let mockGuildConfigGetBasic: ReturnType<typeof vi.fn>

describe('/api/guild-tokens/sync', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockGetPlayerApiKey = vi.fn()
    mockValidateApiKeyWithTacticus = vi.fn()
    mockTacticusAPI = { getPlayerWithRetry: vi.fn() }
    mockGuildConfigFindByCodeOrTag = vi.fn()
    mockGuildConfigGetBasic = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        findByCodeOrTag: mockGuildConfigFindByCodeOrTag,
        getBasic: mockGuildConfigGetBasic,
        normalizeCode: (code: string) => code.trim().toUpperCase()
      }
    }))

    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: mockTacticusAPI
    }))

    vi.doMock('@tacticus/app-core/api-key-helper', () => ({
      getPlayerApiKey: mockGetPlayerApiKey
    }))

    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockServiceSupabase = {
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)
    mockGuildConfigFindByCodeOrTag.mockResolvedValue(null)
    mockGuildConfigGetBasic.mockResolvedValue({ cluster_code: 'EOT' })

    const routeModule = await import('@/app/api/guild-tokens/sync/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('POST - Sync guild token data', () => {
    it('returns 400 when guild code is missing', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.message).toContain('Guild code')
    })

    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(401)
    })

    it('returns 403 when user belongs to different guild', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'OTHER', cluster_code: 'EOT' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('own guild')
    })

    it('returns 403 when user is in different cluster', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', cluster_code: 'CLUSTER_A' },
          error: null
        })
      })

      mockGuildConfigGetBasic.mockResolvedValue({ cluster_code: 'CLUSTER_B' })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('cluster')
    })

    it('returns success with 0 synced when no members have API keys', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', cluster_code: 'EOT' },
          error: null
        })
      })

      mockServiceSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({
          data: [],
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.syncedCount).toBe(0)
      expect(body.message).toContain('No members with API keys')
    })

    // Authorization must run before the cache read, or a warm entry leaks another guild's SyncResult.
    it('still returns 403 for a foreign guild when that guild is CACHED', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', cluster_code: 'EOT' },
          error: null
        })
      })
      mockServiceSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({ data: [], error: null })
      })

      const warm = await POST(
        new NextRequest('http://localhost/api/guild-tokens/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        })
      )
      expect(warm.status).toBe(200)

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'attacker-456' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'OTHER', cluster_code: 'EOT' },
          error: null
        })
      })

      const response = await POST(
        new NextRequest('http://localhost/api/guild-tokens/sync', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        })
      )

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('own guild')
      expect(body.fromCache).toBeUndefined()
    })

    it('returns 500 when members query fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        fromCallCount++
        if (fromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', cluster_code: 'EOT' },
              error: null
            })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { cluster_code: 'EOT' },
            error: null
          })
        }
      })

      mockServiceSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({
          data: null,
          error: { message: 'Database error' }
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toContain('Failed to fetch')
    })

    it('syncs members with valid API keys successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      let authFromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        authFromCallCount++
        if (authFromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', cluster_code: 'EOT' },
              error: null
            })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { cluster_code: 'EOT' },
            error: null
          })
        }
      })

      let serviceFromCallCount = 0
      mockServiceSupabase.from.mockImplementation(() => {
        serviceFromCallCount++
        if (serviceFromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            neq: vi.fn().mockResolvedValue({
              data: [
                {
                  player_id: 'p1',
                  display_name: 'Player1',
                  tacticus_api_key_encrypted: 'encrypted-key',
                  user_id: 'u1'
                }
              ],
              error: null
            })
          }
        }
        return {
          update: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis()
        }
      })

      mockGetPlayerApiKey.mockResolvedValue('valid-api-key')
      mockValidateApiKeyWithTacticus.mockResolvedValue({ isValid: true })
      mockTacticusAPI.getPlayerWithRetry.mockResolvedValue({
        progress: {
          guildRaid: {
            tokens: { current: 3, nextTokenInSeconds: 3600 },
            bombTokens: { current: 2, nextTokenInSeconds: 7200 }
          }
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.syncedCount).toBe(1)
      expect(body.totalMembers).toBe(1)
    })

    it('handles invalid API key validation', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      let authFromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        authFromCallCount++
        if (authFromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', cluster_code: 'EOT' },
              error: null
            })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { cluster_code: 'EOT' },
            error: null
          })
        }
      })

      mockServiceSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({
          data: [
            {
              player_id: 'p1',
              display_name: 'Player1',
              tacticus_api_key_encrypted: 'encrypted-key',
              user_id: 'u1'
            }
          ],
          error: null
        }),
        update: vi.fn().mockReturnThis()
      })

      mockGetPlayerApiKey.mockResolvedValue('invalid-api-key')
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        statusCode: 401,
        error: 'API key rejected'
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.syncedCount).toBe(0)
      expect(body.failedCount).toBe(1)
    })

    it('handles decryption failure gracefully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      let authFromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        authFromCallCount++
        if (authFromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', cluster_code: 'EOT' },
              error: null
            })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { cluster_code: 'EOT' },
            error: null
          })
        }
      })

      mockServiceSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({
          data: [
            {
              player_id: 'p1',
              display_name: 'Player1',
              tacticus_api_key_encrypted: 'corrupted-key',
              user_id: 'u1'
            }
          ],
          error: null
        }),
        update: vi.fn().mockReturnThis()
      })

      mockGetPlayerApiKey.mockResolvedValue(null)

      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.failedCount).toBe(1)
      expect(body.failedMemberDetails?.[0]?.reason).toContain('decrypt')
    })

    it('handles missing guild raid data', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })

      let authFromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        authFromCallCount++
        if (authFromCallCount === 1) {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', cluster_code: 'EOT' },
              error: null
            })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: { cluster_code: 'EOT' },
            error: null
          })
        }
      })

      mockServiceSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        not: vi.fn().mockReturnThis(),
        neq: vi.fn().mockResolvedValue({
          data: [
            {
              player_id: 'p1',
              display_name: 'Player1',
              tacticus_api_key_encrypted: 'encrypted-key',
              user_id: 'u1'
            }
          ],
          error: null
        }),
        update: vi.fn().mockReturnThis()
      })

      mockGetPlayerApiKey.mockResolvedValue('valid-api-key')
      mockValidateApiKeyWithTacticus.mockResolvedValue({ isValid: true })
      mockTacticusAPI.getPlayerWithRetry.mockResolvedValue({
        progress: {}
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.failedCount).toBe(1)
      expect(body.failedMemberDetails?.[0]?.reason).toContain('guild raid')
    })

    it('returns 500 on unexpected errors', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(
        new Error('Database connection failed')
      )

      const request = new NextRequest(
        'http://localhost/api/guild-tokens/sync',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild: 'TEST' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.message).toContain('Failed to sync')
    })
  })
})
