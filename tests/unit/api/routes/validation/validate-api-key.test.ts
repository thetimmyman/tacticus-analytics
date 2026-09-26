import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockDecryptApiKey: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockApiSecurityMiddleware: ReturnType<typeof vi.fn>
let mockGuildConfigWithSecrets: ReturnType<typeof vi.fn>

const GUILD_UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function normalizeGuildCodeForTest(guildCode: string): string {
  const trimmed = guildCode.trim()
  return GUILD_UUID_PATTERN.test(trimmed)
    ? trimmed.toLowerCase()
    : trimmed.toUpperCase()
}

describe('POST /api/validate-api-key', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  function mockGuildMembership(guildCode: string | null) {
    const chain = {
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: guildCode ? { guild_code: guildCode } : null,
              error: null
            })
          })
        })
      })
    }
    mockSupabase.from.mockReturnValue(chain)
  }

  beforeEach(async () => {
    vi.resetModules()
    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockDecryptApiKey = vi.fn()
    mockValidateApiKeyWithTacticus = vi.fn()
    mockApiSecurityMiddleware = vi.fn()
    mockGuildConfigWithSecrets = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))
    vi.doMock('@tacticus/app-core/encryption', () => ({
      decryptApiKey: mockDecryptApiKey
    }))
    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus
    }))
    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      apiSecurityMiddleware: mockApiSecurityMiddleware
    }))
    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))
    vi.doMock(
      '@tacticus/app-core/logging-sanitizer',
      async (importOriginal) => ({
        ...(await importOriginal<
          typeof import('@tacticus/app-core/logging-sanitizer')
        >()),
        sanitizeErrorForLog: (e: unknown) => e
      })
    )
    vi.doMock('@tacticus/app-core/api-errors', () => ({
      createErrorResponse: vi.fn().mockImplementation((code, message) => {
        return new Response(JSON.stringify({ error: { code, message } }), {
          status: 400
        })
      }),
      ErrorCode: {
        MISSING_REQUIRED_FIELDS: 'MISSING_REQUIRED_FIELDS'
      }
    }))
    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getFullWithSecrets: mockGuildConfigWithSecrets,
        normalizeCode: normalizeGuildCodeForTest
      }
    }))

    mockSupabase = {
      auth: {
        getUser: vi
          .fn()
          .mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null })
      },
      from: vi.fn()
    }
    mockServiceSupabase = {
      from: vi.fn()
    }
    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceSupabase)
    mockApiSecurityMiddleware.mockResolvedValue(null)
    mockGuildConfigWithSecrets.mockResolvedValue(null)

    const routeModule = await import('@/app/api/validate-api-key/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const createRequest = (body: object) => {
    return new NextRequest('http://localhost/api/validate-api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
  }

  describe('rate limiting', () => {
    it('returns rate limit response when exceeded', async () => {
      mockApiSecurityMiddleware.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limited' }), { status: 429 })
      )

      const request = createRequest({ apiKey: 'test-key' })
      const response = await POST(request)

      expect(response.status).toBe(429)
    })
  })

  describe('authentication requirements', () => {
    it('does not require auth for direct apiKey validation', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildName: 'Test', guildCode: 'T' },
        canAccessGuild: true,
        canAccessRaidData: true
      })

      const request = createRequest({ apiKey: 'some-key' })
      await POST(request)

      expect(mockApiSecurityMiddleware).toHaveBeenCalledWith(
        expect.any(NextRequest),
        expect.objectContaining({ requireAuth: false })
      )
    })

    it('requires auth for guildCode-only path (decrypts stored secrets)', async () => {
      mockGuildConfigWithSecrets.mockResolvedValue({ api_key_encrypted: 'enc' })
      mockDecryptApiKey.mockResolvedValue('decrypted')
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: {},
        canAccessGuild: true,
        canAccessRaidData: true
      })

      const request = createRequest({ guildCode: 'TEST' })
      await POST(request)

      expect(mockApiSecurityMiddleware).toHaveBeenCalledWith(
        expect.any(NextRequest),
        expect.objectContaining({ requireAuth: true })
      )
    })

    it('returns 401 when guildCode path called without auth', async () => {
      mockApiSecurityMiddleware.mockResolvedValue(
        new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
      )

      const request = createRequest({ guildCode: 'TEST' })
      const response = await POST(request)

      expect(response.status).toBe(401)
    })
  })

  describe('validation with direct API key', () => {
    it('returns 400 when no apiKey or guildCode provided', async () => {
      const request = createRequest({})
      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('validates API key successfully', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildName: 'Test Guild', guildCode: 'TEST' },
        canAccessGuild: true,
        canAccessRaidData: true
      })

      const request = createRequest({ apiKey: 'valid-api-key' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(true)
      expect(body.details.guildInfo.guildName).toBe('Test Guild')
      expect(body.details.permissions.canAccessGuild).toBe(true)
    })

    it('returns invalid for failed validation', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'Invalid API key format'
      })

      const request = createRequest({ apiKey: 'invalid-key' })
      const response = await POST(request)
      const body = await response.json()

      expect(body.valid).toBe(false)
      expect(body.error).toBe('Invalid API key format')
    })

    it('returns status code from validation result', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'API rate limited',
        statusCode: 429
      })

      const request = createRequest({ apiKey: 'rate-limited-key' })
      const response = await POST(request)

      // Validation results are always HTTP 200; details.statusCode is informational.
      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.valid).toBe(false)
      expect(body.details.status).toBe(429)
    })
  })

  describe('validation with guild code lookup', () => {
    it('decrypts and validates stored API key for own guild', async () => {
      mockGuildMembership('TEST')
      mockGuildConfigWithSecrets.mockResolvedValue({
        api_key_encrypted: 'encrypted-key-data'
      })
      mockDecryptApiKey.mockResolvedValue('decrypted-api-key')
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildName: 'Test Guild', guildCode: 'TEST' },
        canAccessGuild: true,
        canAccessRaidData: true
      })

      const request = createRequest({ guildCode: 'TEST' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(true)
      expect(mockDecryptApiKey).toHaveBeenCalledWith('encrypted-key-data')
      expect(mockValidateApiKeyWithTacticus).toHaveBeenCalledWith(
        'decrypted-api-key'
      )
      expect(mockCreateServiceClient).toHaveBeenCalled()
    })

    it('normalizes UUID guild codes without uppercasing stored lookups', async () => {
      const canonicalGuildId = '123e4567-e89b-12d3-a456-426614174000'
      const requestedGuildId = '123E4567-E89B-12D3-A456-426614174000'

      mockGuildMembership(canonicalGuildId)
      mockGuildConfigWithSecrets.mockResolvedValue({
        api_key_encrypted: 'encrypted-key-data'
      })
      mockDecryptApiKey.mockResolvedValue('decrypted-api-key')
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildName: 'UUID Guild', guildCode: canonicalGuildId },
        canAccessGuild: true,
        canAccessRaidData: true
      })

      const request = createRequest({ guildCode: requestedGuildId })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.valid).toBe(true)
      expect(mockGuildConfigWithSecrets).toHaveBeenCalledWith(
        mockServiceSupabase,
        canonicalGuildId
      )
    })

    it('returns 403 when requesting validation for another guild', async () => {
      mockGuildMembership('MYGUILD')

      const request = createRequest({ guildCode: 'OTHERGUILD' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('your own guild')
    })

    it('returns 403 when user has no current guild membership', async () => {
      mockGuildMembership(null)

      const request = createRequest({ guildCode: 'TEST' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('your own guild')
    })

    it('returns error when guild not found', async () => {
      mockGuildMembership('UNKNOWN')
      mockGuildConfigWithSecrets.mockResolvedValue(null)

      const request = createRequest({ guildCode: 'UNKNOWN' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error.message).toContain('Guild not found')
    })

    it('returns error when no API key configured for guild', async () => {
      mockGuildMembership('TEST')
      mockGuildConfigWithSecrets.mockResolvedValue({
        api_key_encrypted: null
      })

      const request = createRequest({ guildCode: 'TEST' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('No API key found')
    })

    it('returns error when decryption fails', async () => {
      mockGuildMembership('TEST')
      mockGuildConfigWithSecrets.mockResolvedValue({
        api_key_encrypted: 'encrypted-key'
      })
      mockDecryptApiKey.mockRejectedValue(new Error('Decryption failed'))

      const request = createRequest({ guildCode: 'TEST' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('decrypt')
    })
  })

  describe('error handling', () => {
    it('handles JSON parse errors', async () => {
      const request = new NextRequest('http://localhost/api/validate-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'invalid-json'
      })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid request format')
    })

    it('handles validation service errors', async () => {
      mockValidateApiKeyWithTacticus.mockRejectedValue(
        new Error('Service unavailable')
      )

      const request = createRequest({ apiKey: 'test-key' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('An unexpected error occurred')
    })

    it('handles non-Error objects', async () => {
      mockValidateApiKeyWithTacticus.mockRejectedValue({
        message: 'Nested error message'
      })

      const request = createRequest({ apiKey: 'test-key' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('An unexpected error occurred')
    })

    it('returns default message for unknown error types', async () => {
      mockValidateApiKeyWithTacticus.mockRejectedValue(null)

      const request = createRequest({ apiKey: 'test-key' })
      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('An unexpected error occurred')
    })
  })
})
