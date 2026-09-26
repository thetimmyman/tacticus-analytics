import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockRequireRole: ReturnType<typeof vi.fn>
let mockGetApiKey: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>
let mockGuildConfigWithSecrets: ReturnType<typeof vi.fn>

describe('POST /api/guild/validate-api-key', () => {
  let POST: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateServiceClient = vi.fn()
    mockRequireRole = vi.fn()
    mockGetApiKey = vi.fn()
    mockValidateApiKeyWithTacticus = vi.fn()
    mockApiSecurityMiddleware = vi.fn()
    mockGuildConfigWithSecrets = vi.fn()

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getFullWithSecrets: mockGuildConfigWithSecrets,
        normalizeCode: (code: string) => code.trim().toUpperCase()
      }
    }))

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireRole: mockRequireRole,
        requireRoleForApi: mockRequireRole
      }
    })

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    vi.doMock('@tacticus/app-core/api-key-helper', () => ({
      getApiKey: mockGetApiKey
    }))

    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus
    }))

    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))

    vi.doMock(
      '@tacticus/app-core/logging-sanitizer',
      async (importOriginal) => ({
        ...(await importOriginal<
          typeof import('@tacticus/app-core/logging-sanitizer')
        >()),
        sanitizeErrorForLog: vi.fn((e) => e)
      })
    )

    mockSupabase = {
      from: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)
    mockApiSecurityMiddleware.mockResolvedValue(null)
    mockRequireRole.mockResolvedValue({
      profile: { guild_code: 'TEST', role: 'officer' }
    })
    mockGuildConfigWithSecrets.mockResolvedValue(null)

    const routeModule = await import('@/app/api/guild/validate-api-key/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  describe('rate limiting', () => {
    it('returns rate limit response when blocked', async () => {
      const rateLimitResponse = new Response(
        JSON.stringify({ error: 'Rate limited' }),
        { status: 429 }
      )
      mockApiSecurityMiddleware.mockResolvedValue(rateLimitResponse)

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)

      expect(response.status).toBe(429)
    })
  })

  describe('validation', () => {
    it('returns 400 when guild_code is missing', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Missing guild_code')
    })
  })

  describe('guild lookup', () => {
    it('returns 404 when guild config does not exist', async () => {
      mockRequireRole.mockResolvedValue({
        profile: { guild_code: 'NOTFOUND', role: 'officer' }
      })
      mockGuildConfigWithSecrets.mockResolvedValue(null)

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'NOTFOUND' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error.code).toBe(3001)
      expect(body.error.message).toBe('Guild not found')
    })
  })

  describe('API key decryption', () => {
    beforeEach(() => {
      mockGuildConfigWithSecrets.mockResolvedValue({
        guild_code: 'TEST',
        guild_id: 'guild-uuid',
        api_key_encrypted: 'encrypted-key',
        api_key_is_valid: null,
        consecutive_sync_failures: 0
      })
    })

    it('returns valid=false when no API key is configured', async () => {
      mockGetApiKey.mockResolvedValue(null)

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(false)
      expect(body.message).toContain('No API key configured')
    })

    it('returns valid=false when decryption fails', async () => {
      mockGetApiKey.mockRejectedValue(new Error('Decryption failed'))

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(false)
      expect(body.message).toContain('decrypt')
    })
  })

  describe('API key testing', () => {
    beforeEach(() => {
      mockGuildConfigWithSecrets.mockResolvedValue({
        guild_code: 'TEST',
        guild_id: 'guild-uuid',
        api_key_encrypted: 'encrypted-key',
        api_key_is_valid: null,
        consecutive_sync_failures: 0
      })
      mockSupabase.from.mockImplementation(() => ({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
      }))
      mockGetApiKey.mockResolvedValue('decrypted-api-key')
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildId: 'guild-uuid',
          guildName: 'Test Guild',
          guildCode: 'TEST'
        }
      })
    })

    it('returns valid=true when shared Tacticus validation succeeds', async () => {
      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'test' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(true)
      expect(body.message).toBe('API key is valid and working')
      expect(mockValidateApiKeyWithTacticus).toHaveBeenCalledWith(
        'decrypted-api-key',
        false
      )
    })

    it('returns valid=false when shared Tacticus validation fails', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        canAccessGuild: false,
        canAccessRaidData: false,
        error: 'Guild API key is invalid or expired (401/403 Unauthorized)',
        statusCode: 401
      })

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(false)
      expect(body.message).toContain('invalid or expired')
    })

    it('returns valid=false when shared Tacticus validation times out', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      mockSupabase.from.mockImplementation(() => ({
        update: updateMock
      }))
      mockValidateApiKeyWithTacticus.mockRejectedValue(
        new DOMException('Aborted', 'AbortError')
      )

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.valid).toBe(false)
      expect(body.message).toContain('timed out')
      expect(updateMock).not.toHaveBeenCalled()
    })

    it.each([
      [
        '408 timeout result',
        {
          isValid: false,
          canAccessGuild: false,
          canAccessRaidData: false,
          error: 'Request timed out - Tacticus API may be slow or unavailable',
          statusCode: 408
        }
      ],
      [
        'TimeoutError result',
        {
          isValid: false,
          canAccessGuild: false,
          canAccessRaidData: false,
          error: 'Validation failed: The operation was aborted due to timeout',
          statusCode: 500
        }
      ]
    ])(
      'does not count %s toward consecutive sync failures',
      async (_name, validationResult) => {
        const updateMock = vi.fn().mockReturnValue({
          eq: vi.fn().mockResolvedValue({ error: null })
        })
        mockSupabase.from.mockImplementation(() => ({
          update: updateMock
        }))
        mockValidateApiKeyWithTacticus.mockResolvedValue(validationResult)

        const request = new NextRequest(
          'http://localhost/api/guild/validate-api-key',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ guild_code: 'TEST' })
          }
        )

        const response = await POST(request)
        const body = await response.json()

        expect(response.status).toBe(200)
        expect(body.valid).toBe(false)
        expect(body.message).toContain('timed out')
        expect(updateMock).not.toHaveBeenCalled()
      }
    )

    it('normalizes guild code to uppercase for config lookup', async () => {
      mockRequireRole.mockResolvedValue({
        profile: { guild_code: 'LOWERCASE', role: 'officer' }
      })
      mockGuildConfigWithSecrets.mockResolvedValue({
        guild_code: 'LOWERCASE',
        guild_id: 'lowercase-guild-uuid',
        api_key_encrypted: 'encrypted-key',
        api_key_is_valid: null,
        consecutive_sync_failures: 0
      })
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildId: 'lowercase-guild-uuid',
          guildName: 'Lowercase Guild',
          guildCode: 'LOWERCASE'
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'lowercase' })
        }
      )

      await POST(request)

      expect(mockGuildConfigWithSecrets).toHaveBeenCalledWith(
        mockSupabase,
        'LOWERCASE'
      )
    })

    it('updates database on successful validation', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      mockGuildConfigWithSecrets.mockResolvedValue({
        guild_code: 'TEST',
        guild_id: 'guild-uuid',
        api_key_encrypted: 'encrypted-key',
        api_key_is_valid: null,
        consecutive_sync_failures: 0
      })
      mockSupabase.from.mockImplementation(() => ({
        update: updateMock
      }))

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      await POST(request)

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_is_valid: true,
          consecutive_sync_failures: 0,
          auto_sync_enabled: true
        })
      )
    })

    it('treats missing Guild Raid permission as invalid', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      mockSupabase.from.mockImplementation(() => ({
        update: updateMock
      }))
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        canAccessGuild: true,
        canAccessRaidData: false,
        error: 'Guild Raid endpoint access is required',
        statusCode: 403,
        guildInfo: {
          guildId: 'guild-uuid',
          guildName: 'Test Guild',
          guildCode: 'TEST'
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(false)
      expect(body.message).toContain('Guild Raid')
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_is_valid: false,
          consecutive_sync_failures: 1,
          auto_sync_enabled: true
        })
      )
    })

    it('does not enable sync when validation cannot determine guild identity', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      mockSupabase.from.mockImplementation(() => ({
        update: updateMock
      }))
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildName: 'Unknown Guild',
          guildCode: 'TEST'
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(false)
      expect(body.message).toContain('Could not determine guild')
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_is_valid: false,
          auto_sync_enabled: true
        })
      )
    })

    it('does not enable sync when API key belongs to a different guild', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      mockSupabase.from.mockImplementation(() => ({
        update: updateMock
      }))
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildId: 'other-guild-uuid',
          guildName: 'Other Guild',
          guildCode: 'OTHER'
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(false)
      expect(body.message).toContain('different guild')
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_is_valid: false,
          auto_sync_enabled: true
        })
      )
    })

    it('does not enable sync when stored guild identity is missing', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      mockGuildConfigWithSecrets.mockResolvedValue({
        guild_code: 'TEST',
        guild_id: null,
        api_key_encrypted: 'encrypted-key',
        api_key_is_valid: true,
        consecutive_sync_failures: 1
      })
      mockSupabase.from.mockImplementation(() => ({
        update: updateMock
      }))
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        canAccessGuild: true,
        canAccessRaidData: true,
        guildInfo: {
          guildId: 'guild-uuid',
          guildName: 'Test Guild',
          guildCode: 'TEST'
        }
      })

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(false)
      expect(body.message).toContain('stored guild identity')
      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_is_valid: false,
          consecutive_sync_failures: 2,
          auto_sync_enabled: true
        })
      )
    })

    it('increments failure count on failed validation', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      mockGuildConfigWithSecrets.mockResolvedValue({
        guild_code: 'TEST',
        guild_id: 'guild-uuid',
        api_key_encrypted: 'encrypted-key',
        api_key_is_valid: true,
        consecutive_sync_failures: 1
      })
      mockSupabase.from.mockImplementation(() => ({
        update: updateMock
      }))
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        canAccessGuild: false,
        canAccessRaidData: false,
        error: 'Guild API key is invalid or expired (401/403 Unauthorized)',
        statusCode: 401
      })

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      await POST(request)

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          api_key_is_valid: false,
          consecutive_sync_failures: 2
        })
      )
    })

    it('disables auto sync after 3 consecutive failures', async () => {
      const updateMock = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      mockGuildConfigWithSecrets.mockResolvedValue({
        guild_code: 'TEST',
        guild_id: 'guild-uuid',
        api_key_encrypted: 'encrypted-key',
        api_key_is_valid: true,
        consecutive_sync_failures: 2
      })
      mockSupabase.from.mockImplementation(() => ({
        update: updateMock
      }))
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        canAccessGuild: false,
        canAccessRaidData: false,
        error: 'Guild API key is invalid or expired (401/403 Unauthorized)',
        statusCode: 401
      })

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      await POST(request)

      expect(updateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          consecutive_sync_failures: 3,
          auto_sync_enabled: false
        })
      )
    })
  })

  describe('error handling', () => {
    it('returns 500 when unexpected error occurs', async () => {
      mockRequireRole.mockRejectedValue(new Error('Unexpected error'))

      const request = new NextRequest(
        'http://localhost/api/guild/validate-api-key',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ guild_code: 'TEST' })
        }
      )

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error).toBeDefined()
    })
  })
})
