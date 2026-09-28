import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockDb: ReturnType<typeof vi.fn>
let mockRequireActiveMembershipForApi: ReturnType<typeof vi.fn>

describe('GET /api/members/boss-performance', () => {
  let GET: (request: Request) => Promise<Response>
  let mockSupabase: {
    rpc: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockDb = vi.fn()
    mockRequireActiveMembershipForApi = vi.fn().mockResolvedValue({
      user: { id: 'user-1' },
      profile: { role: 'officer', guild_code: 'TESTGLD' }
    })

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb
    }))

    vi.doMock('@/app/lib/auth', async () => {
      const actual =
        await vi.importActual<typeof import('@/app/lib/auth')>('@/app/lib/auth')
      return {
        ...actual,
        requireActiveMembershipForApi: mockRequireActiveMembershipForApi
      }
    })

    vi.doMock('@/app/lib/logging', async (importOriginal) => {
      const actual = await importOriginal<typeof import('@/app/lib/logging')>()
      return {
        ...actual,
        createComponentLogger: vi.fn(() => ({
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
          warn: vi.fn()
        }))
      }
    })

    mockSupabase = {
      rpc: vi.fn()
    }

    mockDb.mockResolvedValue(mockSupabase)

    const routeModule = await import('@/app/api/members/boss-performance/route')
    GET = routeModule.GET
  })

  describe('authorization', () => {
    it('rejects a guild the caller is not a current member of', async () => {
      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=OTHERGLD&season=45'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it('accepts the caller own guild case-insensitively', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=testgld&season=45'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(mockSupabase.rpc).toHaveBeenCalled()
    })

    it('accepts a UUID guild_code regardless of case', async () => {
      // guild_code is a lowercase UUID; normalizeGuildIdentifier is the canonical comparison.
      const uuid = '3f2a1b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b'
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })
      mockRequireActiveMembershipForApi.mockResolvedValue({
        user: { id: 'user-1' },
        profile: { role: 'member', guild_code: uuid }
      })

      const request = new Request(
        `http://localhost/api/members/boss-performance?guild=${uuid.toUpperCase()}&season=45`
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
    })

    it('sends the stored guild_code to the RPC, not the raw query param', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD%20&season=45'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'get_player_boss_performance',
        { guild_code_param: 'TESTGLD', season_param: '45' }
      )
    })

    it('rejects a logged-in user without a current membership', async () => {
      const { AuthError } = await import('@/app/lib/auth')
      mockRequireActiveMembershipForApi.mockRejectedValue(
        new AuthError(
          'Current guild membership required',
          'ONBOARDING_REQUIRED'
        )
      )

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      expect(mockSupabase.rpc).not.toHaveBeenCalled()
    })

    it('rejects an unauthenticated caller with 401, not 500', async () => {
      const { AuthError } = await import('@/app/lib/auth')
      mockRequireActiveMembershipForApi.mockRejectedValue(
        new AuthError('Authentication required', 'UNAUTHENTICATED')
      )

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)

      expect(response.status).toBe(401)
    })
  })

  describe('validation', () => {
    it('returns 400 when guild parameter is missing', async () => {
      const request = new Request(
        'http://localhost/api/members/boss-performance?season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Missing required parameters')
    })

    it('returns 400 when season parameter is missing', async () => {
      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Missing required parameters')
    })

    it('returns 400 when both parameters are missing', async () => {
      const request = new Request(
        'http://localhost/api/members/boss-performance'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Missing required parameters')
    })
  })

  describe('successful queries', () => {
    const mockRpcData = [
      {
        display_name: 'Player1',
        boss_name: 'Hive_Tyrant_Legendary',
        encounter_id: 0,
        set_num: 2,
        tier: 3,
        rarity: 'Legendary',
        player_vs_guild_avg: 15.5,
        player_vs_cluster_avg: 10.2,
        boss_preference: 'strong'
      },
      {
        display_name: 'Player1',
        boss_name: 'Screamer_Killer_Mythic',
        encounter_id: 1,
        set_num: 0,
        tier: 1,
        rarity: 'Mythic',
        player_vs_guild_avg: -5.0,
        player_vs_cluster_avg: -3.0,
        boss_preference: 'weak'
      },
      {
        display_name: 'Player2',
        boss_name: 'Hive_Tyrant_Legendary',
        encounter_id: 0,
        set_num: 2,
        tier: 3,
        rarity: 'Legendary',
        player_vs_guild_avg: 8.0,
        player_vs_cluster_avg: 5.0,
        boss_preference: null
      }
    ]

    it('returns grouped player performance data', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockRpcData, error: null })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(Object.keys(body)).toEqual(['Player1', 'Player2'])
      expect(body.Player1.length).toBe(2)
      expect(body.Player2.length).toBe(1)
    })

    it('serializes reserved player names as own response properties', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          {
            ...mockRpcData[0],
            display_name: '__proto__'
          }
        ],
        error: null
      })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(Object.hasOwn(body, '__proto__')).toBe(true)
      expect(body['__proto__']).toHaveLength(1)
    })

    it('formats Legendary boss display keys correctly', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          {
            display_name: 'TestPlayer',
            boss_name: 'Hive_Tyrant_Legendary',
            encounter_id: 0,
            set_num: 2,
            tier: 3,
            rarity: 'Legendary',
            player_vs_guild_avg: 10.0,
            player_vs_cluster_avg: 5.0,
            boss_preference: 'neutral'
          }
        ],
        error: null
      })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.TestPlayer[0].display_key).toBe('L3 Hive Tyrant')
    })

    it('formats Mythic boss display keys correctly', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          {
            display_name: 'TestPlayer',
            boss_name: 'Screamer_Killer_Mythic',
            encounter_id: 0,
            set_num: 1,
            tier: 2,
            rarity: 'Mythic',
            player_vs_guild_avg: 10.0,
            player_vs_cluster_avg: 5.0,
            boss_preference: 'strong'
          }
        ],
        error: null
      })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.TestPlayer[0].display_key).toBe('M2 Screamer Killer')
    })

    it('formats Prime encounter display keys correctly', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          {
            display_name: 'TestPlayer',
            boss_name: 'Hive_Tyrant_Prime',
            encounter_id: 3,
            set_num: 0,
            tier: 1,
            rarity: 'Legendary',
            player_vs_guild_avg: 20.0,
            player_vs_cluster_avg: 15.0,
            boss_preference: 'strong'
          }
        ],
        error: null
      })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.TestPlayer[0].display_key).toBe('L1 Hive_Tyrant_Prime')
    })

    it('defaults null values appropriately', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          {
            display_name: 'TestPlayer',
            boss_name: 'Boss',
            encounter_id: 0,
            set_num: 0,
            tier: 1,
            rarity: 'Legendary',
            player_vs_guild_avg: null,
            player_vs_cluster_avg: null,
            boss_preference: null
          }
        ],
        error: null
      })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(body.TestPlayer[0].player_vs_guild_avg).toBe(0)
      expect(body.TestPlayer[0].player_vs_cluster_avg).toBe(0)
      expect(body.TestPlayer[0].preference).toBe('neutral')
    })

    it('returns empty object when no data found', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })
      mockRequireActiveMembershipForApi.mockResolvedValue({
        user: { id: 'user-1' },
        profile: { role: 'officer', guild_code: 'EMPTYGLD' }
      })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=EMPTYGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({})
    })

    it('handles null data from RPC', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: null, error: null })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body).toEqual({})
    })
  })

  describe('error handling', () => {
    it('returns 500 when RPC fails', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'Function not found' }
      })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Unable to load boss performance data')
      expect(body.error.message).not.toContain('Function not found')
      expect(JSON.stringify(body)).not.toContain('Function not found')
    })

    it('returns 500 when database connection fails', async () => {
      mockDb.mockRejectedValue(new Error('Connection refused'))

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Internal server error')
      expect(JSON.stringify(body)).not.toContain('Connection refused')
    })

    it('returns 500 when RPC throws exception', async () => {
      mockSupabase.rpc.mockRejectedValue(new Error('Timeout'))

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Internal server error')
      expect(JSON.stringify(body)).not.toContain('Timeout')
    })

    it('handles non-Error exceptions', async () => {
      mockSupabase.rpc.mockRejectedValue('String error')

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=TESTGLD&season=45'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Internal server error')
    })
  })

  describe('RPC parameters', () => {
    it('passes correct parameters to RPC', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })
      mockRequireActiveMembershipForApi.mockResolvedValue({
        user: { id: 'user-1' },
        profile: { role: 'officer', guild_code: 'MYGUILD' }
      })

      const request = new Request(
        'http://localhost/api/members/boss-performance?guild=MYGUILD&season=42'
      )

      await GET(request)

      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'get_player_boss_performance',
        {
          guild_code_param: 'MYGUILD',
          season_param: '42'
        }
      )
    })
  })
})
