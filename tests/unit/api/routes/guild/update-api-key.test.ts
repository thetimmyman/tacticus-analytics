import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))

let mockCreateClient: ReturnType<typeof vi.fn>
let mockEncryptApiKey: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockGenerateApiKeyUpdatePayload: ReturnType<typeof vi.fn>
let mockLogApiKeyOperation: ReturnType<typeof vi.fn>
let mockFetch: ReturnType<typeof vi.fn>

// The write runs as service role, so authorization reads this row in code.
const LEADER_PROFILE = {
  role: 'leader',
  guild_code: 'TEST',
  display_name: 'Tester'
}

describe('POST /api/guild/update-api-key', () => {
  let POST: (request: Request) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockEncryptApiKey = vi.fn()
    mockValidateApiKeyWithTacticus = vi.fn()
    mockGenerateApiKeyUpdatePayload = vi.fn()
    mockLogApiKeyOperation = vi.fn()
    mockFetch = vi.fn()

    vi.stubGlobal('fetch', mockFetch)

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      // Shared with serviceDb() so the update-chain assertions hold.
      createServiceClient: () => mockSupabase
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    vi.doMock('@tacticus/app-core/encryption', () => ({
      encryptApiKey: mockEncryptApiKey
    }))

    vi.doMock('@tacticus/app-core/error-handler', () => ({
      createError: vi.fn((_code, message) => new Error(message)),
      formatErrorForUser: vi.fn((err) => ({
        message: err.message,
        code: 'ERROR'
      })),
      getVersionInfo: vi.fn(() => ({ version: '1.0.0' }))
    }))

    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus,
      generateApiKeyUpdatePayload: mockGenerateApiKeyUpdatePayload,
      logApiKeyOperation: mockLogApiKeyOperation
    }))

    vi.doMock(
      '@tacticus/app-core/logging-sanitizer',
      async (importOriginal) => ({
        ...(await importOriginal<
          typeof import('@tacticus/app-core/logging-sanitizer')
        >()),
        maskSensitive: vi.fn((s) => s),
        sanitizeErrorForLog: vi.fn((e) => e)
      })
    )

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: LEADER_PROFILE, error: null })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({ data: null, error: null }),
          update: vi.fn().mockReturnThis()
        }
      })
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/guild/update-api-key/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  const validGuildInfo = {
    guildCode: 'TEST',
    guildName: 'Test Guild',
    guildId: 'guild-id-1'
  }

  const makeSelectSingleChain = (
    data: Record<string, unknown> | null,
    error: Record<string, unknown> | null = null
  ) => ({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data, error })
  })

  let capturedUpdateSpy: ReturnType<typeof vi.fn> | undefined

  const mockGuildUpdateQueries = ({
    targetGuildId = validGuildInfo.guildId,
    profile = LEADER_PROFILE as Record<string, unknown>,
    updateData = [
      {
        guild_code: 'TEST',
        API_Owner: 'New Owner',
        api_key_encrypted: 'enc',
        updated_at: '2024-01-01'
      }
    ],
    updateError = null
  }: {
    targetGuildId?: string
    profile?: Record<string, unknown>
    updateData?: Record<string, unknown>[] | null
    updateError?: Record<string, unknown> | null
  } = {}) => {
    let guildConfigCall = 0
    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_mapping') {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: profile, error: null })
        }
      }
      if (table === 'guild_config') {
        guildConfigCall++
        if (guildConfigCall === 1) {
          return makeSelectSingleChain({
            guild_code: 'TEST',
            API_Owner: 'Old Owner'
          })
        }
        if (guildConfigCall === 2) {
          return makeSelectSingleChain({ guild_id: targetGuildId })
        }
        capturedUpdateSpy = vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: updateData,
              error: updateError
            })
          })
        })
        return { update: capturedUpdateSpy }
      }
      return { select: vi.fn().mockReturnThis() }
    })
  }

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' }
      })

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST', api_key: 'test-key' })
      })

      const response = await POST(request)

      expect(response.status).toBe(401)
    })
  })

  // The service-role write bypasses RLS, so this is the only gate. UPDATE takes any own-guild rank
  // (avoids a stale-sync deadlock); REMOVE stays officer+ because it disables auto_sync.
  describe('authorization', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
    })

    const withProfile = (profile: Record<string, unknown> | null) => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: profile, error: null })
          }
        }
        return makeSelectSingleChain({ guild_code: 'TEST' })
      })
    }

    const post = (body: Record<string, unknown>) =>
      POST(
        new Request('http://localhost/api/guild/update-api-key', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        })
      )

    it('lets a plain member of the guild past authorization for an update', async () => {
      withProfile({ role: 'member', guild_code: 'TEST', display_name: 'M' })
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'invalid key'
      })

      const response = await post({ guild_code: 'TEST', api_key: 'k' })

      expect(mockValidateApiKeyWithTacticus).toHaveBeenCalled()
      expect(response.status).toBe(400) // key rejected by Tacticus, NOT a 403
    })

    it('returns 403 when the caller leads a different guild', async () => {
      withProfile({ role: 'leader', guild_code: 'OTHER', display_name: 'L' })

      const response = await post({ guild_code: 'TEST', api_key: 'k' })

      expect(response.status).toBe(403)
      // Denial precedes the Tacticus call so the endpoint is not a key-probing oracle.
      expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
    })

    it('returns 403 when the caller has no current membership', async () => {
      withProfile(null)

      const response = await post({ guild_code: 'TEST', api_key: 'k' })

      expect(response.status).toBe(403)
    })

    it('refuses removal for a caller who is not a leader/officer', async () => {
      withProfile({ role: 'member', guild_code: 'TEST', display_name: 'M' })

      const response = await post({ guild_code: 'TEST', remove: true })

      expect(response.status).toBe(403)
    })
  })

  describe('validation', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
    })

    it('returns 400 when guild_code is missing', async () => {
      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: 'test-key' })
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
    })

    it('returns 400 when api_key is missing', async () => {
      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST' })
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
    })
  })

  describe('explicit removal (remove: true)', () => {
    let updateSpy: ReturnType<typeof vi.fn>
    let updateEqSpy: ReturnType<typeof vi.fn>
    let updateSelectSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      updateSelectSpy = vi.fn().mockResolvedValue({
        data: [{ guild_code: 'TEST' }],
        error: null
      })
      updateEqSpy = vi.fn().mockReturnValue({ select: updateSelectSpy })
      updateSpy = vi.fn().mockReturnValue({ eq: updateEqSpy })
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: LEADER_PROFILE, error: null })
          }
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({
                data: { guild_code: 'TEST' },
                error: null
              })
            })
          }),
          update: updateSpy
        }
      })
    })

    it('clears the stored key and verification trail without Tacticus validation', async () => {
      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST', remove: true })
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
      const payload = await response.json()
      expect(payload.success).toBe(true)
      expect(payload.removed).toBe(true)
      expect(updateSpy).toHaveBeenCalledWith({
        api_key_encrypted: null,
        api_key_is_valid: null,
        api_key_last_validated: null,
        auto_sync_enabled: false
      })
      expect(updateEqSpy).toHaveBeenCalledWith('guild_code', 'TEST')
      expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
    })

    it('fails closed when RLS allows the lookup but updates zero rows', async () => {
      updateSelectSpy.mockResolvedValue({ data: [], error: null })

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST', remove: true })
      })

      const response = await POST(request)
      const payload = await response.json()

      expect(response.status).toBe(404)
      expect(payload.error.message).toContain('No rows updated')
      expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
    })

    it('returns 400 when remove is requested without a guild_code', async () => {
      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ remove: true })
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      expect(updateSpy).not.toHaveBeenCalled()
    })
  })

  describe('guild lookup', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
    })

    it('returns 404 when guild does not exist', async () => {
      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: { guild_code: 'NOTFOUND' },
              error: null
            })
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          single: vi.fn().mockResolvedValue({
            data: null,
            error: { code: 'PGRST116' }
          })
        }
      })

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'NOTFOUND', api_key: 'test-key' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(404)
      expect(body.error.message).toBe('Guild not found')
    })
  })

  describe('API key validation', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockGuildUpdateQueries()
    })

    it('returns 400 when API key validation fails', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'API key is invalid'
      })

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST', api_key: 'invalid-key' })
      })

      const response = await POST(request)

      expect(response.status).toBe(400)
      expect(mockLogApiKeyOperation).toHaveBeenCalled()
    })

    it('returns 400 when API key belongs to different guild', async () => {
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: {
          guildCode: 'OTHER',
          guildName: 'Other Guild',
          guildId: 'other-guild-id'
        }
      })

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST', api_key: 'valid-key' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('API key belongs to a different')
    })

    it('returns 400 (fails closed) when the stored guild has no guild_id', async () => {
      mockGuildUpdateQueries({ targetGuildId: null as unknown as string })
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: validGuildInfo,
        canAccessGuild: true,
        canAccessRaidData: true
      })

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST', api_key: 'valid-key' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('identity not linked')
      expect(mockEncryptApiKey).not.toHaveBeenCalled()
      expect(mockGenerateApiKeyUpdatePayload).not.toHaveBeenCalled()
    })

    // Members must not forge the owner label officers see.
    it('derives API_Owner from the authenticated profile and ignores the body', async () => {
      mockGuildUpdateQueries()
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: validGuildInfo,
        canAccessGuild: true,
        canAccessRaidData: true
      })
      mockEncryptApiKey.mockResolvedValue('encrypted-key')
      mockGenerateApiKeyUpdatePayload.mockReturnValue({
        api_key_encrypted: 'encrypted-key',
        API_Owner: 'Tester'
      })
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({})
      } as never)

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'TEST',
          api_key: 'valid-key',
          api_owner: 'Forged Label'
        })
      })

      await POST(request)

      expect(mockGenerateApiKeyUpdatePayload).toHaveBeenCalledWith(
        'encrypted-key',
        expect.objectContaining({ isValid: true }),
        'Tester'
      )

      expect(capturedUpdateSpy).toHaveBeenCalledTimes(1)
      const writtenPayload = capturedUpdateSpy!.mock.calls[0][0] as Record<
        string,
        unknown
      >
      expect(writtenPayload).toHaveProperty('API_Owner', 'Tester')
      expect(writtenPayload).toHaveProperty(
        'api_key_encrypted',
        'encrypted-key'
      )
    })

    it('omits API_Owner when the profile has no display_name (stored label preserved)', async () => {
      mockGuildUpdateQueries({
        profile: { role: 'leader', guild_code: 'TEST', display_name: null }
      })
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: validGuildInfo,
        canAccessGuild: true,
        canAccessRaidData: true
      })
      mockEncryptApiKey.mockResolvedValue('encrypted-key')
      mockGenerateApiKeyUpdatePayload.mockReturnValue({
        api_key_encrypted: 'encrypted-key',
        API_Owner: 'Generator Default'
      })
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({})
      } as never)

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'TEST',
          api_key: 'valid-key',
          api_owner: 'Forged Label'
        })
      })

      await POST(request)

      expect(mockGenerateApiKeyUpdatePayload).toHaveBeenCalledWith(
        'encrypted-key',
        expect.objectContaining({ isValid: true }),
        undefined
      )

      expect(capturedUpdateSpy).toHaveBeenCalledTimes(1)
      const writtenPayload = capturedUpdateSpy!.mock.calls[0][0] as Record<
        string,
        unknown
      >
      expect(writtenPayload).not.toHaveProperty('API_Owner')
    })
  })

  describe('encryption', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockGuildUpdateQueries()
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: validGuildInfo,
        canAccessGuild: true,
        canAccessRaidData: true
      })
    })

    it('returns 500 when encryption fails', async () => {
      mockEncryptApiKey.mockRejectedValue(new Error('ENCRYPTION_KEY not set'))

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST', api_key: 'valid-key' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('encrypt')
    })
  })

  describe('database update', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: validGuildInfo,
        canAccessGuild: true,
        canAccessRaidData: true
      })
      mockEncryptApiKey.mockResolvedValue('encrypted-api-key')
      mockGenerateApiKeyUpdatePayload.mockReturnValue({
        api_key_encrypted: 'encrypted-api-key',
        API_Owner: 'New Owner'
      })
    })

    it('returns 500 when database update fails', async () => {
      mockGuildUpdateQueries({
        updateData: null,
        updateError: { code: '42501', message: 'Permission denied' }
      })

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST', api_key: 'valid-key' })
      })

      const response = await POST(request)

      expect(response.status).toBe(500)
    })

    it('returns 404 when no rows are updated', async () => {
      mockGuildUpdateQueries({ updateData: [] })

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guild_code: 'TEST', api_key: 'valid-key' })
      })

      const response = await POST(request)

      expect(response.status).toBe(404)
    })

    it('returns success when update is successful', async () => {
      mockGuildUpdateQueries()
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true })
      })

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'TEST',
          api_key: 'valid-key',
          api_owner: 'New Owner'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
    })

    it('returns success when post-update sync trigger hangs', async () => {
      vi.useFakeTimers()
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://kong:8000')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
      const { SERVICE_TIMEOUTS } = await import('@/app/lib/utils/async-timeout')
      let aborted = false
      mockGuildUpdateQueries()
      mockFetch.mockImplementation(
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

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'TEST',
          api_key: 'valid-key',
          api_owner: 'New Owner'
        })
      })

      const responsePromise = POST(request)

      await vi.waitFor(() => {
        expect(mockFetch).toHaveBeenCalled()
      })
      await vi.advanceTimersByTimeAsync(SERVICE_TIMEOUTS.EXTERNAL_API)

      expect(aborted).toBe(true)
      const response = await responsePromise
      const body = await response.json()
      expect(response.status).toBe(200)
      expect(body.success).toBe(true)
      expect(body.details.syncTriggered).toBe(false)
    })

    it('calls the sync function through the internal URL, not the public browser URL', async () => {
      // Docker Compose splits these on purpose (see .env.compose.example): the
      // browser reaches Supabase at NEXT_PUBLIC_SUPABASE_URL, but this route
      // runs server-side inside the container and must use SUPABASE_URL to
      // reach the same Supabase stack through the Docker host gateway.
      vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321')
      vi.stubEnv('SUPABASE_URL', 'http://host.docker.internal:54321')
      vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')
      mockGuildUpdateQueries()
      mockFetch.mockResolvedValue({
        ok: true,
        json: async () => ({ success: true })
      })

      const request = new Request('http://localhost/api/guild/update-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guild_code: 'TEST',
          api_key: 'valid-key',
          api_owner: 'New Owner'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.details.syncTriggered).toBe(true)
      expect(mockFetch).toHaveBeenCalledWith(
        'http://host.docker.internal:54321/functions/v1/sync-modular-workflow',
        expect.anything()
      )
    })
  })
})
