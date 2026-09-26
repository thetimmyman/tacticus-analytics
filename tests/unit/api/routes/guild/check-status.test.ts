import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockGuildConfigGetFull: ReturnType<typeof vi.fn>
let mockRequireAuthForApi: ReturnType<typeof vi.fn>

describe('GET /api/guild/check-status', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateServiceClient = vi.fn()
    mockGuildConfigGetFull = vi.fn()
    mockRequireAuthForApi = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return { ...actual, requireAuthForApi: mockRequireAuthForApi }
    })

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: {
        getFull: mockGuildConfigGetFull
      }
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: { error: vi.fn(), debug: vi.fn(), info: vi.fn() }
    }))

    mockSupabase = {
      from: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)
    mockGuildConfigGetFull.mockResolvedValue(null)
    mockRequireAuthForApi.mockResolvedValue({
      user: { id: 'user-1' },
      profile: { guild_code: 'TEST' }
    })

    const routeModule = await import('@/app/api/guild/check-status/route')
    GET = routeModule.GET
  })

  describe('authorization (WI-6050)', () => {
    it('rejects an unauthenticated caller before touching the service client', async () => {
      const { AuthError } = await import('@/app/lib/auth')
      mockRequireAuthForApi.mockRejectedValue(
        new AuthError('Authentication required', 'UNAUTHENTICATED')
      )

      const request = new Request(
        'http://localhost/api/guild/check-status?guild_code=TEST'
      )

      const response = await GET(request)

      expect(response.status).toBe(401)
      // The route's own serviceDb() is never reached on the reject path.
      expect(mockCreateServiceClient).not.toHaveBeenCalled()
      expect(mockGuildConfigGetFull).not.toHaveBeenCalled()
    })
  })

  describe('validation', () => {
    it('returns 400 when guild_code is missing', async () => {
      const request = new Request('http://localhost/api/guild/check-status')

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Missing guild_code')
    })
  })

  describe('guild not found', () => {
    it('returns exists=false when guild config does not exist', async () => {
      mockGuildConfigGetFull.mockResolvedValue(null)

      const request = new Request(
        'http://localhost/api/guild/check-status?guild_code=NONE'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.exists).toBe(false)
      expect(body.hasData).toBe(false)
      expect(body.dataCount).toBe(0)
    })
  })

  describe('guild exists', () => {
    beforeEach(() => {
      mockGuildConfigGetFull.mockResolvedValue({
        guild_code: 'TEST',
        display_name: 'Test Guild',
        enabled: true,
        onboarding_completed: true,
        api_key_is_valid: true,
        api_key_last_validated: '2024-01-01'
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'EOT_GR_data') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 500, error: null })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })
    })

    it('returns complete status for existing guild with data', async () => {
      const request = new Request(
        'http://localhost/api/guild/check-status?guild_code=test'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.exists).toBe(true)
      expect(body.hasData).toBe(true)
      expect(body.dataCount).toBe(500)
      expect(body.config.guild_code).toBe('TEST')
      expect(body.config.enabled).toBe(true)
      expect(body.syncStatus).toBeUndefined()
      expect(body.config.onboarding_completed).toBeUndefined()
    })

    it('normalizes guild code to uppercase', async () => {
      const request = new Request(
        'http://localhost/api/guild/check-status?guild_code=lowercase'
      )

      await GET(request)

      expect(mockGuildConfigGetFull).toHaveBeenCalledWith(
        mockSupabase,
        'LOWERCASE'
      )
    })
  })

  describe('guild exists without data', () => {
    it('returns hasData=false when no battle data exists', async () => {
      mockGuildConfigGetFull.mockResolvedValue({
        guild_code: 'EMPTY',
        display_name: 'Empty Guild',
        enabled: true,
        onboarding_completed: false,
        api_key_is_valid: true,
        api_key_last_validated: null
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'EOT_GR_data') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({ count: 0, error: null })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = new Request(
        'http://localhost/api/guild/check-status?guild_code=EMPTY'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.exists).toBe(true)
      expect(body.hasData).toBe(false)
      expect(body.dataCount).toBe(0)
    })
  })

  describe('error handling', () => {
    it('returns fallback response when exception is thrown', async () => {
      mockGuildConfigGetFull.mockRejectedValue(
        new Error('Database connection failed')
      )

      const request = new Request(
        'http://localhost/api/guild/check-status?guild_code=ERROR'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.code).toBe(5001)
    })

    it('handles count query error gracefully', async () => {
      mockGuildConfigGetFull.mockResolvedValue({
        guild_code: 'TEST',
        display_name: 'Test',
        enabled: true,
        onboarding_completed: true,
        api_key_is_valid: true,
        api_key_last_validated: null
      })

      mockSupabase.from.mockImplementation((table: string) => {
        if (table === 'EOT_GR_data') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockResolvedValue({
              count: null,
              error: { message: 'Count failed' }
            })
          }
        }
        return { select: vi.fn().mockReturnThis() }
      })

      const request = new Request(
        'http://localhost/api/guild/check-status?guild_code=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.exists).toBe(true)
      expect(body.dataCount).toBe(0)
    })
  })
})
