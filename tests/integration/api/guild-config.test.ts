import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock
} from 'vitest'

// vitest 5 types a bare vi.fn() as function-or-constructor; these mocks are called.
type AnyMock = Mock<(...args: any[]) => any>
import { NextRequest } from 'next/server'

vi.mock('@/app/lib/auth/server', () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn()
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@tacticus/app-core/encryption', () => ({
  encryptApiKey: vi.fn()
}))

vi.mock('@tacticus/app-core/api-key-validation', () => ({
  validateApiKeyWithTacticus: vi.fn()
}))

vi.mock('@/app/lib/loki/build-string', () => ({
  resolveLokiBuildString: vi.fn()
}))

vi.mock('@/app/lib/middleware/rate-limit', () => ({
  apiSecurityMiddleware: vi.fn()
}))

vi.mock('@tacticus/app-core/api-errors', () => ({
  createSuccessResponse: vi.fn((data, message) => {
    return new Response(JSON.stringify({ data, message, success: true }), {
      status: 200
    })
  }),
  ErrorCode: {
    MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS',
    INVALID_GUILD_CODE: 'INVALID_GUILD_CODE',
    PROTECTED_GUILD_CODE: 'PROTECTED_GUILD_CODE',
    GUILD_ALREADY_EXISTS: 'GUILD_ALREADY_EXISTS',
    INVALID_API_KEY: 'INVALID_API_KEY',
    SESSION_REFRESH_FAILURE: 'SESSION_REFRESH_FAILURE',
    ENCRYPTION_ERROR: 'ENCRYPTION_ERROR',
    UNKNOWN_ERROR: 'UNKNOWN_ERROR'
  },
  validateGuildCode: vi.fn()
}))

vi.mock('@tacticus/app-core/app-config', () => ({
  TACTICUS_API: {
    BASE_URL: 'https://api.tacticusgame.com'
  }
}))

vi.mock('@/app/lib/errors/legacyError', async (importOriginal) => {
  const actual = (await importOriginal()) as object
  return {
    ...actual
  }
})

vi.mock('@/app/lib/middleware/errorHandler', () => ({
  withErrorHandler: vi.fn((handler) => {
    return async (req: Request) => {
      try {
        return await handler(req)
      } catch (error: unknown) {
        const statusCode = (error as { statusCode?: number })?.statusCode || 500
        const code = (error as { code?: number })?.code || 5001
        const message =
          (error as { message?: string })?.message || 'Internal server error'
        return new Response(
          JSON.stringify({
            error: { code, message, retryable: false }
          }),
          { status: statusCode }
        )
      }
    }
  })
}))

vi.mock('@/app/lib/errors/AppError', async (importOriginal) => {
  const actual = (await importOriginal()) as object
  return {
    ...actual
  }
})

describe('Guild Create Config Route', () => {
  let mockSupabase: {
    from: AnyMock
    rpc: AnyMock
    functions: { invoke: AnyMock }
  }
  let mockAuthedSupabase: {
    auth: { getUser: AnyMock }
  }
  let createClient: AnyMock
  let createServiceClient: AnyMock
  let encryptApiKey: AnyMock
  let validateApiKeyWithTacticus: AnyMock
  let validateGuildCode: AnyMock
  let apiSecurityMiddleware: AnyMock
  let resolveLokiBuildString: AnyMock
  let mockFetch: AnyMock

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.stubEnv('LOKI_SCRAPER_USER_ID', 'test-loki-user')
    vi.stubEnv('LOKI_SCRAPER_CLIENT_SECRET', 'test-loki-secret')
    vi.stubEnv('ENABLE_NEW_GUILD_SELF_SERVICE', 'true')

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn(),
      functions: { invoke: vi.fn() }
    }
    mockAuthedSupabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null
        })
      }
    }

    const serverModule = await import('@/app/lib/auth/server')
    const encryptionModule = await import('@tacticus/app-core/encryption')
    const validationModule =
      await import('@tacticus/app-core/api-key-validation')
    const errorModule = await import('@tacticus/app-core/api-errors')
    const rateLimitModule = await import('@/app/lib/middleware/rate-limit')
    const lokiModule = await import('@/app/lib/loki/build-string')

    createClient = vi.mocked(serverModule.createClient)
    createServiceClient = vi.mocked(serverModule.createServiceClient)
    encryptApiKey = vi.mocked(encryptionModule.encryptApiKey)
    validateApiKeyWithTacticus = vi.mocked(
      validationModule.validateApiKeyWithTacticus
    )
    validateGuildCode = vi.mocked(errorModule.validateGuildCode)
    apiSecurityMiddleware = vi.mocked(rateLimitModule.apiSecurityMiddleware)
    resolveLokiBuildString = vi.mocked(lokiModule.resolveLokiBuildString)

    createClient.mockResolvedValue(mockAuthedSupabase)
    createServiceClient.mockReturnValue(mockSupabase)
    mockSupabase.rpc.mockResolvedValue({ data: [], error: null })
    encryptApiKey.mockResolvedValue('encrypted-api-key')
    validateGuildCode.mockReturnValue({ valid: true })
    apiSecurityMiddleware.mockResolvedValue(null)
    resolveLokiBuildString.mockResolvedValue('1.0.0')

    mockFetch = vi.fn()
    global.fetch = mockFetch
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  function createRequest(body: object): NextRequest {
    return new NextRequest('http://localhost:3000/api/guild/create-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  describe('Rate Limiting', () => {
    it('returns rate limit response when exceeded', async () => {
      apiSecurityMiddleware.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Too many requests' }), {
          status: 429
        })
      )

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'TEST',
        display_name: 'Test Guild',
        api_key: 'test-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(429)
    })
  })

  describe('Validation', () => {
    it('returns 400 when guild_code is missing', async () => {
      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        display_name: 'Test Guild',
        api_key: 'test-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error.code).toBe(2001) // VALIDATION error
    })

    it('returns 400 when display_name is missing', async () => {
      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'TEST',
        api_key: 'test-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
    })

    it('returns 400 when api_key is missing', async () => {
      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'TEST',
        display_name: 'Test Guild'
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
    })

    it('returns 400 for invalid guild code format', async () => {
      validateGuildCode.mockReturnValue({
        valid: false,
        error: 'INVALID_GUILD_CODE',
        message: 'Guild code must be 2-7 letters'
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'A',
        display_name: 'Test Guild',
        api_key: 'test-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(400)
      const body = await response.json()
      expect(body.error).toBeDefined()
    })

    it.each(['TEST', 'DEMO'])(
      'rejects reserved guild code: %s',
      async (protectedCode) => {
        validateGuildCode.mockReturnValue({
          valid: false,
          error: 'PROTECTED_GUILD_CODE',
          message: `Guild code ${protectedCode} is reserved and cannot be created via onboarding`
        })

        const { POST } = await import('@/app/api/guild/create-config/route')
        const req = createRequest({
          guild_code: protectedCode,
          display_name: 'Anything',
          api_key: 'test-key'
        })

        const response = await POST(req)

        expect(response.status).toBe(400)
        const body = await response.json()
        expect(body.error.code).toBe(3010) // PROTECTED_GUILD_CODE error
      }
    )

    it.each([
      ['IW', 'Iron Warriors'],
      ['TS', 'Thousand Sons'],
      ['PIQBM', 'Raven Guard'],
      ['ANYCODE', 'Example Alliance']
    ])(
      'does not protected-block previously-reserved name: %s / %s',
      async (code, name) => {
        // Only a name-based check could fail these as PROTECTED_GUILD_CODE (3010).
        mockSupabase.from.mockReturnValue({
          select: vi.fn().mockReturnValue({
            ilike: vi.fn().mockReturnValue({
              maybeSingle: vi
                .fn()
                .mockResolvedValue({ data: null, error: null })
            })
          })
        })

        const { POST } = await import('@/app/api/guild/create-config/route')
        const req = createRequest({
          guild_code: code,
          display_name: name,
          api_key: 'test-key'
        })

        const response = await POST(req)

        const body = await response.json().catch(() => ({}))
        expect(body.error?.code).not.toBe(3010)
      }
    )
  })

  describe('Guild Existence Check', () => {
    it('returns 409 when guild already exists', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: { guild_code: 'TEST', display_name: 'Existing Guild' },
              error: null
            })
          })
        })
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'TEST',
        display_name: 'New Guild',
        api_key: 'test-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(409)
      const body = await response.json()
      expect(body.error.code).toBe(3009) // GUILD_ALREADY_EXISTS error
    })

    it('returns 500 when database check fails', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Database connection failed' }
            })
          })
        })
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'test-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
    })

    it('normalizes guild code to uppercase', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      })

      validateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'Invalid key'
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'lowercaseguild',
        display_name: 'New Guild',
        api_key: 'test-key'
      })

      await POST(req)

      expect(mockSupabase.from).toHaveBeenCalledWith('guild_config')
    })
  })

  describe('API Key Validation', () => {
    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      })
    })

    it('returns 401 when API key is invalid', async () => {
      validateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'API key validation failed',
        statusCode: 401,
        canAccessGuild: false,
        canAccessRaidData: false
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'invalid-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
      const body = await response.json()
      expect(body.error.code).toBe(1001) // UNAUTHORIZED error
    })

    it('includes details when API key lacks guild access', async () => {
      validateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'Cannot access guild',
        canAccessGuild: false,
        canAccessRaidData: true
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'no-guild-access-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
    })

    it('includes details when API key lacks raid access', async () => {
      validateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'Cannot access raid data',
        canAccessGuild: true,
        canAccessRaidData: false
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'no-raid-access-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(401)
    })
  })

  describe('Session Refresh', () => {
    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      })

      validateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { guildId: 'guild-123', guildName: 'Test Guild' }
      })
    })

    it('returns 500 when session refresh fails', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ guild: { guildId: 'guild-123' } })
      })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ season: '42' })
      })
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('LOKI error')
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'valid-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error).toBeDefined()
    })
  })

  describe('Encryption', () => {
    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      })

      validateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { guildId: 'guild-123', guildName: 'New Guild' }
      })

      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sessionId: 'session-123' })
      })
    })

    it('returns 500 when encryption fails', async () => {
      encryptApiKey.mockRejectedValue(new Error('Encryption failed'))

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'valid-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.code).toBe(5001)
    })
  })

  describe('Successful Guild Creation', () => {
    beforeEach(() => {
      validateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { guildId: 'guild-123', guildName: 'Discovered Guild' }
      })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                guild: {
                  guildId: 'guild-123',
                  name: 'Discovered Guild',
                  members: []
                }
              })
          })
        }
        if (url.includes('/guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: '42' })
          })
        }
        if (url.includes('loki')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'session-abc123' })
          })
        }
        return Promise.resolve({ ok: false, status: 404 })
      })
    })

    it('creates guild config with all required fields', async () => {
      const upsertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: {}, error: null })
        })
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnValue({
              ilike: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: null })
              })
            }),
            upsert: upsertMock
          }
        }
        if (table === 'clusters') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({
                  data: {
                    id: 'cluster-1',
                    cluster_code: 'EOT',
                    created_by: 'user-123'
                  },
                  error: null
                })
              })
            })
          }
        }
        if (table === 'guild_sync_status') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        return { select: vi.fn() }
      })

      mockSupabase.functions.invoke.mockResolvedValue({
        data: { stats: { upsertedEntries: 10, lokiMappings: 5 } },
        error: null
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'newgld',
        display_name: 'New Guild',
        api_key: 'valid-key',
        cluster_code: 'EOT'
      })

      const response = await POST(req)

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.success).toBe(true)
    })

    it('triggers initial sync after creation', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnValue({
              ilike: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: null })
              })
            }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: {}, error: null })
              })
            })
          }
        }
        if (table === 'guild_sync_status') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        return { select: vi.fn() }
      })

      mockSupabase.functions.invoke.mockResolvedValue({
        data: { stats: { lokiMappings: 10 } },
        error: null
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'valid-key'
      })

      await POST(req)

      expect(mockSupabase.functions.invoke).toHaveBeenCalledWith(
        'sync-modular-workflow',
        expect.objectContaining({
          body: { guild_code: 'NEWGLD' }
        })
      )
    })

    it('returns 409 on duplicate constraint violation', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnValue({
              ilike: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: null })
              })
            }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: null,
                  error: {
                    code: '23505',
                    message: 'duplicate key value violates unique constraint'
                  }
                })
              })
            })
          }
        }
        return { select: vi.fn() }
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'valid-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(409)
    })
  })

  describe('Fallback Player Mapping', () => {
    beforeEach(() => {
      validateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { guildId: 'guild-123' }
      })
    })

    it('creates fallback player mappings when LOKI mappings fail', async () => {
      const upsertPlayerMock = vi.fn().mockResolvedValue({ error: null })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnValue({
              ilike: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: null })
              })
            }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: {}, error: null })
              })
            })
          }
        }
        if (table === 'guild_sync_status') {
          return {
            upsert: vi.fn().mockResolvedValue({ error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ player_id: 'player-1' }],
                error: null
              })
            }),
            upsert: upsertPlayerMock
          }
        }
        return { select: vi.fn() }
      })

      mockSupabase.functions.invoke.mockResolvedValue({
        data: { stats: { lokiMappings: 0 } },
        error: null
      })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                guild: {
                  guildId: 'guild-123',
                  members: [
                    { userId: 'player-1', role: 'LEADER' },
                    { userId: 'player-2', role: 'MEMBER' }
                  ]
                }
              })
          })
        }
        if (url.includes('loki')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'session-123' })
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'valid-key'
      })

      const response = await POST(req)
      const body = await response.json()

      expect(body.data?.playerMappingsCreated).toBe(true)
      expect(upsertPlayerMock).toHaveBeenCalledWith(
        [
          expect.objectContaining({
            player_id: 'player-2',
            guild_code: 'NEWGLD',
            role: 'member'
          })
        ],
        { onConflict: 'player_id', ignoreDuplicates: true }
      )
      expect(upsertPlayerMock).not.toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ player_id: 'player-1' })
        ]),
        expect.anything()
      )
    })
  })

  describe('Error Handling', () => {
    it('returns 500 for unexpected errors', async () => {
      mockSupabase.from.mockImplementation(() => {
        throw new Error('Unexpected database failure')
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'valid-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.code).toBe(5001)
    })

    it('handles service client initialization failure', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      })

      validateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true
      })

      createServiceClient.mockImplementation(() => {
        throw new Error('Service role not configured')
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'valid-key'
      })

      const response = await POST(req)

      expect(response.status).toBe(500)
    })
  })

  describe('Auto-discovery', () => {
    beforeEach(() => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null })
          })
        })
      })

      validateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: { guildId: 'guild-123', guildName: 'New Guild' }
      })
    })

    it('uses auto-discovered guild name when available', async () => {
      const upsertMock = vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: {}, error: null })
        })
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnValue({
              ilike: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: null })
              })
            }),
            upsert: upsertMock
          }
        }
        if (table === 'guild_sync_status') {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) }
        }
        return { select: vi.fn() }
      })

      mockSupabase.functions.invoke.mockResolvedValue({ data: {}, error: null })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({
                guild: {
                  guildId: 'guild-123',
                  name: 'Auto Discovered Name',
                  members: []
                }
              })
          })
        }
        if (url.includes('loki')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'session-123' })
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'User Provided Name',
        api_key: 'valid-key'
      })

      const response = await POST(req)
      const body = await response.json()

      expect(body.data?.autoDiscovered?.guildName).toBe('Auto Discovered Name')
    })

    it('detects current season from raid API', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnValue({
              ilike: vi.fn().mockReturnValue({
                maybeSingle: vi
                  .fn()
                  .mockResolvedValue({ data: null, error: null })
              })
            }),
            upsert: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({ data: {}, error: null })
              })
            })
          }
        }
        if (table === 'guild_sync_status') {
          return { upsert: vi.fn().mockResolvedValue({ error: null }) }
        }
        return { select: vi.fn() }
      })

      mockSupabase.functions.invoke.mockResolvedValue({ data: {}, error: null })

      mockFetch.mockImplementation((url: string) => {
        if (url.includes('guildRaid')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ season: '42' })
          })
        }
        if (url.includes('/guild')) {
          return Promise.resolve({
            ok: true,
            json: () =>
              Promise.resolve({ guild: { guildId: 'guild-123', members: [] } })
          })
        }
        if (url.includes('loki')) {
          return Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ sessionId: 'session-123' })
          })
        }
        return Promise.resolve({
          ok: true,
          json: () => Promise.resolve({})
        })
      })

      const { POST } = await import('@/app/api/guild/create-config/route')
      const req = createRequest({
        guild_code: 'NEWGLD',
        display_name: 'New Guild',
        api_key: 'valid-key'
      })

      const response = await POST(req)
      const body = await response.json()

      expect(body.data?.autoDiscovered?.season).toBe('42')
    })
  })
})
