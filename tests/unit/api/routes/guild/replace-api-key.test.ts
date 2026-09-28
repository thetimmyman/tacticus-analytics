import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))

let mockDb: ReturnType<typeof vi.fn>
let mockEncryptApiKey: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>

describe('POST /api/guild/replace-api-key', () => {
  let POST: (request: Request) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let updateSpy: ReturnType<typeof vi.fn>

  const validGuildInfo = {
    guildCode: 'TEST',
    guildName: 'Test Guild',
    guildId: 'guild-id-1'
  }

  const buildSupabase = ({
    user = { id: 'user-123' },
    callerGuild = 'TEST',
    // Service-role write: the route authorizes on this row.
    callerRole = 'leader',
    targetGuild = { guild_code: 'TEST', guild_id: 'guild-id-1' },
    targetLookupError = null as unknown,
    updateError = null as unknown
  } = {}) => {
    updateSpy = vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ error: updateError })
    })
    return {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user },
          error: user ? null : { message: 'no session' }
        })
      },
      from: vi.fn().mockImplementation((table: string) => {
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            maybeSingle: vi.fn().mockResolvedValue({
              data: callerGuild
                ? {
                    role: callerRole,
                    guild_code: callerGuild,
                    display_name: 'Tester'
                  }
                : null,
              error: null
            })
          }
        }
        if (table === 'guild_config') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            single: vi.fn().mockResolvedValue({
              data: targetGuild,
              error: targetLookupError
            }),
            update: updateSpy
          }
        }
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis()
        }
      })
    }
  }

  beforeEach(async () => {
    vi.resetModules()
    mockDb = vi.fn()
    mockEncryptApiKey = vi.fn().mockResolvedValue('encrypted-key')
    mockValidateApiKeyWithTacticus = vi.fn()

    // Shared with serviceDb() so the "previous key preserved" assertions hold.
    vi.doMock('@/app/lib/db', () => ({
      db: mockDb,
      serviceDb: () => mockSupabase
    }))
    vi.doMock('@tacticus/app-core/encryption', () => ({
      encryptApiKey: mockEncryptApiKey
    }))
    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus
    }))

    mockSupabase = buildSupabase()
    mockDb.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/guild/replace-api-key/route')
    POST = routeModule.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const makeRequest = (body: unknown) =>
    new Request('http://localhost/api/guild/replace-api-key', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })

  it('returns 401 when user is not authenticated', async () => {
    mockSupabase = buildSupabase({ user: null as never })
    mockDb.mockResolvedValue(mockSupabase)

    const response = await POST(
      makeRequest({ guild_code: 'TEST', api_key: 'k' })
    )

    expect(response.status).toBe(401)
    expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
  })

  it('returns 400 when guild_code is missing (validation rejection)', async () => {
    const response = await POST(makeRequest({ api_key: 'k' }))
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error.message).toContain('guild_code and api_key are required')
    expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
  })

  it('returns 400 when api_key is missing (validation rejection)', async () => {
    const response = await POST(makeRequest({ guild_code: 'TEST' }))
    expect(response.status).toBe(400)
    expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
  })

  it('returns 400 when api_key is whitespace-only (trim → empty)', async () => {
    const response = await POST(
      makeRequest({ guild_code: 'TEST', api_key: '   ' })
    )
    expect(response.status).toBe(400)
  })

  it('returns 500 on the encryptApiKey-failure branch and never writes a key', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: validGuildInfo,
      canAccessGuild: true,
      canAccessRaidData: true
    })
    mockEncryptApiKey.mockRejectedValue(
      new Error('ENCRYPTION_KEY is not configured')
    )

    const response = await POST(
      makeRequest({ guild_code: 'TEST', api_key: 'valid-key' })
    )
    const body = await response.json()

    expect(response.status).toBe(500)
    expect(body.error.message).toContain('encrypt')
    expect(updateSpy).not.toHaveBeenCalled()
  })

  it('returns 400 (key for a different guild) and never writes a key', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: {
        guildCode: 'OTHR',
        guildName: 'Other Guild',
        guildId: 'a-different-guild-id'
      },
      canAccessGuild: true,
      canAccessRaidData: true
    })

    const response = await POST(
      makeRequest({ guild_code: 'TEST', api_key: 'valid-key' })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('different guild')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(mockEncryptApiKey).not.toHaveBeenCalled()
  })

  it('returns 400 (guild identity unlinked — null guild_id fails closed) and never writes a key', async () => {
    mockSupabase = buildSupabase({
      targetGuild: { guild_code: 'TEST', guild_id: null } as never
    })
    mockDb.mockResolvedValue(mockSupabase)
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: validGuildInfo,
      canAccessGuild: true,
      canAccessRaidData: true
    })

    const response = await POST(
      makeRequest({ guild_code: 'TEST', api_key: 'valid-key' })
    )
    const body = await response.json()

    expect(response.status).toBe(400)
    expect(body.error.message).toContain('identity not linked')
    expect(updateSpy).not.toHaveBeenCalled()
    expect(mockEncryptApiKey).not.toHaveBeenCalled()
  })

  it('returns 404 when the target guild does not exist', async () => {
    mockSupabase = buildSupabase({
      targetGuild: null as never,
      targetLookupError: { code: 'PGRST116' }
    })
    mockDb.mockResolvedValue(mockSupabase)

    const response = await POST(
      makeRequest({ guild_code: 'TEST', api_key: 'valid-key' })
    )
    expect(response.status).toBe(404)
    expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
  })

  it('succeeds and writes the freshly encrypted key + valid flag', async () => {
    mockValidateApiKeyWithTacticus.mockResolvedValue({
      isValid: true,
      guildInfo: validGuildInfo,
      canAccessGuild: true,
      canAccessRaidData: true
    })
    mockEncryptApiKey.mockResolvedValue('the-encrypted-blob')

    const response = await POST(
      makeRequest({ guild_code: 'TEST', api_key: 'valid-key' })
    )
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.success).toBe(true)
    expect(updateSpy).toHaveBeenCalledTimes(1)
    const writtenPayload = updateSpy.mock.calls[0][0]
    expect(writtenPayload.api_key_encrypted).toBe('the-encrypted-blob')
    expect(writtenPayload.api_key_is_valid).toBe(true)
    expect(writtenPayload.api_key_last_validated).toBe(body.verified_at)
    expect(writtenPayload.auto_sync_enabled).toBe(true)
    expect(writtenPayload.consecutive_sync_failures).toBe(0)
  })

  // The write bypasses RLS, so this check alone enforces guild ownership (any own-guild rank, as stale
  // rosters show officers as `member`).
  describe('authorization', () => {
    it('lets a plain member of the guild replace the key', async () => {
      mockSupabase = buildSupabase({ callerRole: 'member' })
      mockDb.mockResolvedValue(mockSupabase)
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: validGuildInfo,
        canAccessGuild: true,
        canAccessRaidData: true
      })

      const response = await POST(
        makeRequest({ guild_code: 'TEST', api_key: 'valid-key' })
      )

      expect(response.status).toBe(200)
      expect(updateSpy).toHaveBeenCalledTimes(1)
    })

    it('returns 403 for a leader of a different guild', async () => {
      mockSupabase = buildSupabase({ callerGuild: 'OTHER' })
      mockDb.mockResolvedValue(mockSupabase)

      const response = await POST(
        makeRequest({ guild_code: 'TEST', api_key: 'valid-key' })
      )

      expect(response.status).toBe(403)
      expect(updateSpy).not.toHaveBeenCalled()
      // Denial precedes the Tacticus call so the endpoint is not a key-probing oracle.
      expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
    })

    it('returns 403 when the caller has no current membership', async () => {
      mockSupabase = buildSupabase({ callerGuild: '' })
      mockDb.mockResolvedValue(mockSupabase)

      const response = await POST(
        makeRequest({ guild_code: 'TEST', api_key: 'valid-key' })
      )

      expect(response.status).toBe(403)
      expect(updateSpy).not.toHaveBeenCalled()
    })
  })
})
