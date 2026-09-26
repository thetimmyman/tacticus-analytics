import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

let mockSupabase: any
let mockServiceSupabase: any
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetPlayerApiKey: ReturnType<typeof vi.fn>
let mockTacticusAPI: any
let mockAnalyzeRoster: ReturnType<typeof vi.fn>
let mockCreateLokiClient: ReturnType<typeof vi.fn>

const createNextRequest = (params: Record<string, string> = {}) => {
  const url = new URL('http://localhost/api/roster-development/analysis')
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value)
  })
  return new NextRequest(url)
}

describe('GET /api/roster-development/analysis', () => {
  let GET: (request: NextRequest) => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    const authChain: any = {
      getUser: vi.fn()
    }
    mockSupabase = {
      auth: authChain,
      from: vi.fn()
    }
    mockServiceSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockCheckFeatureAccess = vi.fn()
    mockGetPlayerApiKey = vi.fn()
    mockTacticusAPI = {
      getPlayer: vi.fn()
    }
    mockAnalyzeRoster = vi.fn()
    mockCreateLokiClient = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: vi.fn().mockResolvedValue(mockSupabase),
      createServiceClient: vi.fn().mockReturnValue(mockServiceSupabase)
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess
    }))

    vi.doMock('@tacticus/app-core/api-key-helper', () => ({
      getPlayerApiKey: mockGetPlayerApiKey
    }))

    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: mockTacticusAPI
    }))

    vi.doMock('@/app/lib/roster-development/analysis', () => ({
      analyzeRoster: mockAnalyzeRoster,
      normalizeUnitName: vi.fn((name: string) =>
        name.toLowerCase().replace(/\s+/g, '')
      )
    }))

    vi.doMock('@/app/lib/loki/client', () => ({
      createLokiClient: mockCreateLokiClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    const routeModule =
      await import('@/app/api/roster-development/analysis/route')
    GET = routeModule.GET
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' }
      })

      const request = createNextRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('feature access', () => {
    it('returns 403 when user lacks roster_development access', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: false })

      const request = createNextRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('Roster development access requ')
      expect(mockCheckFeatureAccess).toHaveBeenCalledWith(
        'user-123',
        'roster_development'
      )
    })
  })

  describe('profile access', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns 403 when profile is not found', async () => {
      const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi
          .fn()
          .mockResolvedValue({ data: null, error: { message: 'Not found' } })
      }
      mockSupabase.from.mockReturnValue(profileChain)

      const request = createNextRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('Profile not found or access de')
    })

    it('returns 403 when user lacks officer/leader role', async () => {
      const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'member' },
          error: null
        })
      }
      mockSupabase.from.mockReturnValue(profileChain)

      const request = createNextRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toBe('Insufficient permissions')
    })

    it('allows officer role', async () => {
      const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'officer' },
          error: null
        })
      }
      mockSupabase.from.mockReturnValue(profileChain)

      const serviceChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      }
      mockServiceSupabase.from.mockReturnValue(serviceChain)
      mockServiceSupabase.rpc.mockResolvedValue({ data: '83' })

      mockAnalyzeRoster.mockReturnValue({
        gaps: [],
        development_priorities: [],
        coverage_by_boss: [],
        recommendations_by_boss: [],
        meta_teams_analyzed: 0
      })

      const request = createNextRequest()
      const response = await GET(request)

      expect(response.status).toBe(200)
    })

    it('allows leader role', async () => {
      const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'leader' },
          error: null
        })
      }
      mockSupabase.from.mockReturnValue(profileChain)

      const serviceChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      }
      mockServiceSupabase.from.mockReturnValue(serviceChain)
      mockServiceSupabase.rpc.mockResolvedValue({ data: '83' })

      mockAnalyzeRoster.mockReturnValue({
        gaps: [],
        development_priorities: [],
        coverage_by_boss: [],
        recommendations_by_boss: [],
        meta_teams_analyzed: 0
      })

      const request = createNextRequest()
      const response = await GET(request)

      expect(response.status).toBe(200)
    })

    it('allows admin role', async () => {
      const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'admin' },
          error: null
        })
      }
      mockSupabase.from.mockReturnValue(profileChain)

      const serviceChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: [], error: null })
      }
      mockServiceSupabase.from.mockReturnValue(serviceChain)
      mockServiceSupabase.rpc.mockResolvedValue({ data: '83' })

      mockAnalyzeRoster.mockReturnValue({
        gaps: [],
        development_priorities: [],
        coverage_by_boss: [],
        recommendations_by_boss: [],
        meta_teams_analyzed: 0
      })

      const request = createNextRequest()
      const response = await GET(request)

      expect(response.status).toBe(200)
    })
  })

  describe('empty guild', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'officer' },
          error: null
        })
      }
      mockSupabase.from.mockReturnValue(profileChain)
    })

    it('returns empty response when guild has no members', async () => {
      mockServiceSupabase.from.mockImplementation((table: string) => {
        if (table === 'hero_mappings') {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
      })

      const request = createNextRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.guild_code).toBe('TEST')
      expect(body.summary.members_total).toBe(0)
      expect(body.summary.members_with_roster).toBe(0)
      expect(body.summary.roster_coverage_pct).toBe(0)
      expect(body.warnings).toContain('No guild members found.')
    })
  })

  describe('successful analysis', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'officer' },
          error: null
        })
      }
      mockSupabase.from.mockReturnValue(profileChain)
    })

    it('aggregates member rosters via Tacticus API', async () => {
      const members = [
        {
          player_id: 'p1',
          display_name: 'Player1',
          tacticus_api_key_encrypted: 'key1',
          api_key_is_valid: true
        },
        {
          player_id: 'p2',
          display_name: 'Player2',
          tacticus_api_key_encrypted: 'key2',
          api_key_is_valid: true
        }
      ]

      mockServiceSupabase.from.mockImplementation((table: string) => {
        if (table === 'hero_mappings') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [
                {
                  unit_id: 'hero1',
                  display_name: 'Hero One',
                  web_icon_url: 'icon1.png'
                }
              ],
              error: null
            })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: members, error: null })
          }
        }
        if (table === 'meta_atlas_data') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
      })

      mockServiceSupabase.rpc.mockResolvedValue({ data: '83' })

      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.getPlayer.mockResolvedValue({
        units: [{ id: 'hero1', name: 'Hero One' }],
        machinesOfWar: []
      })

      mockAnalyzeRoster.mockReturnValue({
        gaps: [],
        development_priorities: [],
        coverage_by_boss: [],
        recommendations_by_boss: [],
        meta_teams_analyzed: 0
      })

      const request = createNextRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.summary.members_total).toBe(2)
      expect(body.summary.members_with_api_key).toBe(2)
      expect(mockGetPlayerApiKey).toHaveBeenCalledTimes(2)
      expect(mockTacticusAPI.getPlayer).toHaveBeenCalledTimes(2)
    })

    it('includes hero icons in response', async () => {
      const members = [
        {
          player_id: 'p1',
          display_name: 'Player1',
          tacticus_api_key_encrypted: 'key1',
          api_key_is_valid: true
        }
      ]

      mockServiceSupabase.from.mockImplementation((table: string) => {
        if (table === 'hero_mappings') {
          return {
            select: vi.fn().mockResolvedValue({
              data: [
                {
                  unit_id: 'hero1',
                  display_name: 'Hero One',
                  web_icon_url: 'icon1.png',
                  icon_url: null
                },
                {
                  unit_id: 'hero2',
                  display_name: 'Hero Two',
                  web_icon_url: null,
                  icon_url: 'icon2.png'
                }
              ],
              error: null
            })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: members, error: null })
          }
        }
        if (table === 'meta_atlas_data') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
      })

      mockServiceSupabase.rpc.mockResolvedValue({ data: '83' })
      mockGetPlayerApiKey.mockResolvedValue('decrypted-key')
      mockTacticusAPI.getPlayer.mockResolvedValue({
        units: [],
        machinesOfWar: []
      })

      mockAnalyzeRoster.mockReturnValue({
        gaps: [],
        development_priorities: [],
        coverage_by_boss: [],
        recommendations_by_boss: [],
        meta_teams_analyzed: 0
      })

      const request = createNextRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.hero_icons['hero one']).toBe('icon1.png')
      expect(body.hero_icons['hero two']).toBe('icon2.png')
    })

    it('uses requested season parameter', async () => {
      const members = [
        {
          player_id: 'p1',
          display_name: 'Player1',
          tacticus_api_key_encrypted: null
        }
      ]

      mockServiceSupabase.from.mockImplementation((table: string) => {
        if (table === 'hero_mappings') {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: members, error: null })
          }
        }
        if (table === 'meta_atlas_data') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
      })

      mockServiceSupabase.rpc.mockResolvedValue({ data: '83' })

      mockAnalyzeRoster.mockReturnValue({
        gaps: [],
        development_priorities: [],
        coverage_by_boss: [],
        recommendations_by_boss: [],
        meta_teams_analyzed: 0
      })

      const request = createNextRequest({ season: '85' })
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.season).toBe('85')
    })

    it('returns analysis results', async () => {
      const members = [
        {
          player_id: 'p1',
          display_name: 'Player1',
          tacticus_api_key_encrypted: null
        }
      ]

      mockServiceSupabase.from.mockImplementation((table: string) => {
        if (table === 'hero_mappings') {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: members, error: null })
          }
        }
        if (table === 'meta_atlas_data') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            gte: vi.fn().mockReturnThis(),
            not: vi.fn().mockReturnThis(),
            order: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
      })

      mockServiceSupabase.rpc.mockResolvedValue({ data: '83' })

      mockAnalyzeRoster.mockReturnValue({
        gaps: ['Missing Hero'],
        development_priorities: ['Dev Hero'],
        coverage_by_boss: [{ boss: 'Boss1', coverage: 80 }],
        recommendations_by_boss: [{ boss: 'Boss1', heroes: ['Hero1'] }],
        meta_teams_analyzed: 5
      })

      const request = createNextRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.gaps).toEqual(['Missing Hero'])
      expect(body.development_priorities).toEqual(['Dev Hero'])
      expect(body.coverage_by_boss).toEqual([{ boss: 'Boss1', coverage: 80 }])
      expect(body.summary.meta_teams_analyzed).toBe(5)
    })
  })

  describe('member load failure', () => {
    beforeEach(() => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      const profileChain: any = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST', role: 'officer' },
          error: null
        })
      }
      mockSupabase.from.mockReturnValue(profileChain)
    })

    it('returns 500 when member load fails', async () => {
      mockServiceSupabase.from.mockImplementation((table: string) => {
        if (table === 'hero_mappings') {
          return {
            select: vi.fn().mockResolvedValue({ data: [], error: null })
          }
        }
        if (table === 'player_mapping') {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockReturnThis(),
            order: vi
              .fn()
              .mockResolvedValue({ data: null, error: { message: 'DB error' } })
          }
        }
        return { select: vi.fn().mockResolvedValue({ data: [], error: null }) }
      })

      const request = createNextRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to load guild members')
    })
  })

  describe('error handling', () => {
    it('returns 500 on unexpected error', async () => {
      mockSupabase.auth.getUser.mockRejectedValue(new Error('Unexpected'))

      const request = createNextRequest()
      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to generate roster anal')
    })
  })
})
