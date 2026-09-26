import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Key invariant: DELETE clears only the caller's current mapping row.

let mockDb: ReturnType<typeof vi.fn>
let mockEncryptApiKey: ReturnType<typeof vi.fn>
let mockValidateApiKeyWithTacticus: ReturnType<typeof vi.fn>
let mockLogApiKeyOperation: ReturnType<typeof vi.fn>
let mockGetPlayer: ReturnType<typeof vi.fn>

describe('/api/player-api-key route handlers', () => {
  let GET: () => Promise<Response>
  let POST: (request: Request) => Promise<Response>
  let DELETE: () => Promise<Response>

  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  const loadRoute = async () => {
    const mod = await import('@/app/api/player-api-key/route')
    GET = mod.GET
    POST = mod.POST
    DELETE = mod.DELETE
  }

  beforeEach(async () => {
    vi.resetModules()
    mockDb = vi.fn()
    mockEncryptApiKey = vi.fn().mockResolvedValue('encrypted-key')
    mockValidateApiKeyWithTacticus = vi.fn()
    mockLogApiKeyOperation = vi.fn()
    mockGetPlayer = vi.fn()

    // tacticus_api_key_encrypted is not granted to `authenticated`, hence serviceDb().
    vi.doMock('@/app/lib/db', () => ({
      db: mockDb,
      serviceDb: () => mockSupabase
    }))
    vi.doMock('@tacticus/app-core/encryption', () => ({
      encryptApiKey: mockEncryptApiKey
    }))
    vi.doMock('@tacticus/app-core/api-key-validation', () => ({
      validateApiKeyWithTacticus: mockValidateApiKeyWithTacticus,
      logApiKeyOperation: mockLogApiKeyOperation
    }))
    vi.doMock(
      '@tacticus/app-core/logging-sanitizer',
      async (importOriginal) => ({
        ...(await importOriginal<
          typeof import('@tacticus/app-core/logging-sanitizer')
        >()),
        sanitizeErrorForLog: <T>(e: T) => e
      })
    )
    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: { getPlayer: mockGetPlayer }
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }
    mockDb.mockResolvedValue(mockSupabase)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const authed = (id = 'user-123') =>
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: { id } },
      error: null
    })
  const unauthed = () =>
    mockSupabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: 'no session' }
    })

  describe('GET', () => {
    it('returns 401 when unauthenticated', async () => {
      unauthed()
      await loadRoute()
      const res = await GET()
      expect(res.status).toBe(401)
    })

    it('reports hasApiKey=true and surfaces validity/lastVerified', async () => {
      authed()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            tacticus_api_key_encrypted: 'blob',
            api_key_is_valid: true,
            api_key_last_verified: '2026-01-01T00:00:00Z'
          },
          error: null
        })
      })
      await loadRoute()
      const res = await GET()
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.hasApiKey).toBe(true)
      expect(body.isValid).toBe(true)
      expect(body.lastVerified).toBe('2026-01-01T00:00:00Z')
    })

    it('reports hasApiKey=false when no encrypted key is stored', async () => {
      authed()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { tacticus_api_key_encrypted: null, api_key_is_valid: false },
          error: null
        })
      })
      await loadRoute()
      const res = await GET()
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.hasApiKey).toBe(false)
    })

    it('returns 500 when the mapping lookup errors', async () => {
      authed()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: 'db down' } })
      })
      await loadRoute()
      const res = await GET()
      expect(res.status).toBe(500)
    })
  })

  describe('POST', () => {
    const makeRequest = (body: Record<string, unknown>) =>
      new Request('http://localhost/api/player-api-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

    it('returns 401 when unauthenticated', async () => {
      unauthed()
      await loadRoute()
      const res = await POST(makeRequest({ apiKey: 'k' }))
      expect(res.status).toBe(401)
      expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
    })

    it('returns 400 when apiKey is empty/whitespace', async () => {
      authed()
      await loadRoute()
      const res = await POST(makeRequest({ apiKey: '   ' }))
      expect(res.status).toBe(400)
      expect(mockValidateApiKeyWithTacticus).not.toHaveBeenCalled()
    })

    it('returns 400 when Tacticus validation fails (invalid key not stored)', async () => {
      authed()
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: false,
        error: 'API key is invalid'
      })
      await loadRoute()
      const res = await POST(makeRequest({ apiKey: 'bad-key' }))
      expect(res.status).toBe(400)
      expect(mockLogApiKeyOperation).toHaveBeenCalled()
      expect(mockEncryptApiKey).not.toHaveBeenCalled()
    })

    it('returns 400 when no player mapping exists (must onboard first)', async () => {
      authed()
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildName: 'G' }
      })
      mockGetPlayer.mockResolvedValue({
        details: { name: 'Hero', powerLevel: 5 }
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      })
      await loadRoute()
      const res = await POST(makeRequest({ apiKey: 'good-key' }))
      const body = await res.json()
      expect(res.status).toBe(400)
      expect(body.error.message).toContain('No player profile')
    })

    it('updates ONLY the authed user current row on success', async () => {
      authed('user-xyz')
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildName: 'G' },
        canAccessGuild: true,
        canAccessRaidData: true
      })
      mockGetPlayer.mockResolvedValue({
        details: { name: 'Hero', powerLevel: 9 }
      })

      const updateEqCalls: Array<[string, string | boolean]> = []
      const updateEq = vi.fn((col: string, val: string | boolean) => {
        updateEqCalls.push([col, val])
        return updateEqCalls.length >= 2
          ? Promise.resolve({ error: null })
          : { eq: updateEq }
      })
      const updateSpy = vi.fn().mockReturnValue({ eq: updateEq })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'map-1',
            // The witness must not be caller-writable, so it comes from EOT_GR_data.
            player_id: 'p-1',
            original_display_name: null,
            has_duplicate_name: false
          },
          error: null
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: { displayName: 'Hero', api_key_added_at: null },
          error: null
        }),
        update: updateSpy
      })

      await loadRoute()
      const res = await POST(makeRequest({ apiKey: 'good-key' }))
      const body = await res.json()
      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      expect(updateSpy.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          tacticus_api_key_encrypted: 'encrypted-key',
          api_key_is_valid: true,
          api_key_last_verified: expect.any(String),
          api_key_added_at: expect.any(String),
          player_power: 9
        })
      )
      expect(updateEqCalls).toContainEqual(['user_id', 'user-xyz'])
      expect(updateEqCalls).toContainEqual(['is_current', true])
    })

    it('does NOT restamp api_key_added_at when the row already carries one', async () => {
      authed('user-xyz')
      mockValidateApiKeyWithTacticus.mockResolvedValue({
        isValid: true,
        guildInfo: { guildName: 'G' },
        canAccessGuild: true,
        canAccessRaidData: true
      })
      mockGetPlayer.mockResolvedValue({
        details: { name: 'Hero', powerLevel: 9 }
      })

      const updateEqCalls: Array<[string, string | boolean]> = []
      const updateEq = vi.fn((col: string, val: string | boolean) => {
        updateEqCalls.push([col, val])
        return updateEqCalls.length >= 2
          ? Promise.resolve({ error: null })
          : { eq: updateEq }
      })
      const updateSpy = vi.fn().mockReturnValue({ eq: updateEq })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            id: 'map-1',
            player_id: 'p-1',
            original_display_name: null,
            has_duplicate_name: false
          },
          error: null
        }),
        maybeSingle: vi.fn().mockResolvedValue({
          data: {
            displayName: 'Hero',
            api_key_added_at: '2026-01-01T00:00:00Z'
          },
          error: null
        }),
        update: updateSpy
      })

      await loadRoute()
      const res = await POST(makeRequest({ apiKey: 'good-key' }))
      expect(res.status).toBe(200)
      expect(updateSpy.mock.calls[0][0]).not.toHaveProperty('api_key_added_at')
      expect(updateSpy.mock.calls[0][0]).toEqual(
        expect.objectContaining({
          tacticus_api_key_encrypted: 'encrypted-key',
          api_key_is_valid: true
        })
      )
    })
  })

  describe('DELETE', () => {
    it('returns 401 when unauthenticated', async () => {
      unauthed()
      await loadRoute()
      const res = await DELETE()
      expect(res.status).toBe(401)
    })

    it('returns 404 when no player mapping exists', async () => {
      authed()
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { code: 'PGRST116' } })
      })
      await loadRoute()
      const res = await DELETE()
      expect(res.status).toBe(404)
    })

    it('clears the key scoped to ONLY the authed user + current row', async () => {
      authed('owner-1')

      const updateEqCalls: Array<[string, string | boolean]> = []
      const updateEq = vi.fn((col: string, val: string | boolean) => {
        updateEqCalls.push([col, val])
        return updateEqCalls.length >= 2
          ? Promise.resolve({ error: null })
          : { eq: updateEq }
      })
      const updateSpy = vi.fn().mockReturnValue({ eq: updateEq })

      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'map-1', tacticus_api_key_encrypted: 'blob' },
          error: null
        }),
        update: updateSpy
      })

      await loadRoute()
      const res = await DELETE()
      const body = await res.json()

      expect(res.status).toBe(200)
      expect(body.success).toBe(true)
      const payload = updateSpy.mock.calls[0][0]
      expect(payload.tacticus_api_key_encrypted).toBeNull()
      expect(payload.api_key_is_valid).toBe(false)
      expect(updateEqCalls).toContainEqual(['user_id', 'owner-1'])
      expect(updateEqCalls).toContainEqual(['is_current', true])
      expect(
        updateEqCalls.some(
          ([col, val]) => col === 'user_id' && val !== 'owner-1'
        )
      ).toBe(false)
    })

    it('returns 500 when the clearing update fails', async () => {
      authed('owner-1')
      const updateEq2 = vi.fn().mockResolvedValue({
        error: { message: 'permission denied' }
      })
      const updateEq1 = vi.fn().mockReturnValue({ eq: updateEq2 })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { id: 'map-1', tacticus_api_key_encrypted: 'blob' },
          error: null
        }),
        update: vi.fn().mockReturnValue({ eq: updateEq1 })
      })
      await loadRoute()
      const res = await DELETE()
      expect(res.status).toBe(500)
    })
  })
})
