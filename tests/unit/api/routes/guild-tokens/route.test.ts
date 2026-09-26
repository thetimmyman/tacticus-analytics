import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockLoadGuildTokenStatuses: ReturnType<typeof vi.fn>
let mockGuildConfigService: {
  getBasic: ReturnType<typeof vi.fn>
}

describe('/api/guild-tokens', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }
  let mockServiceClient: {
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockCreateServiceClient = vi.fn()
    mockLoadGuildTokenStatuses = vi.fn()
    mockGuildConfigService = {
      getBasic: vi.fn()
    }

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient,
      createServiceClient: mockCreateServiceClient
    }))

    vi.doMock('@supabase/supabase-js', () => ({
      createClient: vi.fn().mockReturnValue({
        from: vi.fn()
      })
    }))

    vi.doMock('@/app/api/guild-tokens/token-service', () => ({
      loadGuildTokenStatuses: mockLoadGuildTokenStatuses
    }))

    vi.doMock('@/app/lib/services/guild-config-service', () => ({
      GuildConfigService: mockGuildConfigService
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'https://test.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key')

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockServiceClient = {
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)
    mockCreateServiceClient.mockReturnValue(mockServiceClient)

    const routeModule = await import('@/app/api/guild-tokens/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  describe('GET - Fetch guild token statuses', () => {
    it('returns 400 when guild code is missing', async () => {
      const request = new NextRequest('http://localhost/api/guild-tokens')

      const response = await GET(request)

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
        'http://localhost/api/guild-tokens?guild=TEST'
      )

      const response = await GET(request)

      expect(response.status).toBe(401)
    })

    it('returns 403 when user profile not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: null,
          error: { code: 'PGRST116' }
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=TEST'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('Profile not found')
    })

    it('returns 403 when user is not officer or leader', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'member', cluster_code: 'EOT' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=TEST'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('Insufficient permissions')
    })

    it('continues to reject admin role unless guild-token policy changes', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'admin', cluster_code: 'EOT' },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=TEST'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      expect(mockLoadGuildTokenStatuses).not.toHaveBeenCalled()
    })

    it('returns 403 when user has no guild association', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: null, role: 'leader', cluster_code: null },
          error: null
        })
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=TEST'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('Guild association')
    })

    it('returns 404 when guild not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader', cluster_code: 'EOT' },
          error: null
        })
      })

      mockGuildConfigService.getBasic.mockResolvedValue(null)

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=UNKNOWN'
      )

      const response = await GET(request)

      expect(response.status).toBe(404)
    })

    it('returns 403 when accessing different guild as non-leader', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'MYGUILD', role: 'officer', cluster_code: 'EOT' },
          error: null
        })
      })

      mockGuildConfigService.getBasic.mockResolvedValue({
        guild_code: 'OTHER',
        cluster_code: 'DIFFERENT'
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=OTHER'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
    })

    it('returns 403 when a leader accesses a guild in a different cluster', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            guild_code: 'MYGUILD',
            role: 'leader',
            cluster_code: 'OTHER'
          },
          error: null
        })
      })

      mockGuildConfigService.getBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT'
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=TEST'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('different cluster')
      expect(mockLoadGuildTokenStatuses).not.toHaveBeenCalled()
    })

    it('allows a leader to access a same-cluster guild', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            guild_code: 'MYGUILD',
            role: 'leader',
            cluster_code: 'EOT'
          },
          error: null
        })
      })

      mockGuildConfigService.getBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT',
        cluster_id: 1
      })
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [{ name: 'Player1', tokens: 3 }],
        debug: {}
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=TEST'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(mockLoadGuildTokenStatuses).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          guildCode: 'TEST',
          clusterCode: 'EOT',
          skipLiveOverlay: true
        })
      )
    })

    it('allows an officer to access a same-cluster guild', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            guild_code: 'MYGUILD',
            role: 'officer',
            cluster_code: 'EOT'
          },
          error: null
        })
      })

      mockGuildConfigService.getBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT',
        cluster_id: 1
      })
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [{ name: 'Player1', tokens: 3 }],
        debug: {}
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=TEST'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(mockLoadGuildTokenStatuses).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          guildCode: 'TEST',
          clusterCode: 'EOT',
          skipLiveOverlay: true
        })
      )
    })

    it('returns 500 when an error occurs', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Database error'))

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=TEST'
      )

      const response = await GET(request)

      expect(response.status).toBe(500)
    })

    it('includes season parameter in token lookup', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader', cluster_code: 'EOT' },
          error: null
        })
      })

      mockGuildConfigService.getBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT',
        cluster_id: 1
      })

      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [{ name: 'Player1', tokens: 3 }],
        debug: {}
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=TEST&season=5'
      )

      const response = await GET(request)

      expect(mockLoadGuildTokenStatuses).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          guildCode: 'TEST',
          season: '5',
          clusterCode: 'EOT',
          skipLiveOverlay: true
        })
      )
    })

    it('enables live overlay only when requested', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader', cluster_code: 'EOT' },
          error: null
        })
      })
      mockGuildConfigService.getBasic.mockResolvedValue({
        guild_code: 'TEST',
        cluster_code: 'EOT',
        cluster_id: 1
      })
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [{ name: 'Player1', tokens: 3 }],
        debug: {}
      })

      const request = new NextRequest(
        'http://localhost/api/guild-tokens?guild=TEST&season=5&live=true'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(mockLoadGuildTokenStatuses).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          guildCode: 'TEST',
          season: '5',
          clusterCode: 'EOT',
          skipLiveOverlay: false
        })
      )
    })

    it('uses canonical lowercase UUID guild code for token lookup', async () => {
      const inputGuild = 'ABCDEFAB-CDEF-4ABC-8DEF-ABCDEFABCDEF'
      const canonicalGuild = 'abcdefab-cdef-4abc-8def-abcdefabcdef'

      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: {
            guild_code: inputGuild,
            role: 'officer',
            cluster_code: 'EOT'
          },
          error: null
        })
      })

      mockGuildConfigService.getBasic.mockResolvedValue({
        guild_code: canonicalGuild,
        cluster_code: 'EOT',
        cluster_id: 1
      })
      mockLoadGuildTokenStatuses.mockResolvedValue({
        players: [{ name: 'Player1', tokens: 3 }],
        debug: {}
      })

      const request = new NextRequest(
        `http://localhost/api/guild-tokens?guild=${inputGuild}&season=100`
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(mockGuildConfigService.getBasic).toHaveBeenCalledWith(
        expect.anything(),
        inputGuild
      )
      expect(mockLoadGuildTokenStatuses).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          guildCode: canonicalGuild,
          season: '100',
          clusterCode: 'EOT',
          skipLiveOverlay: true
        })
      )
    })
  })
})
