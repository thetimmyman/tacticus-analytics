import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockCreateServiceClient: ReturnType<typeof vi.fn>
let mockCreateClient: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockResolveDagProgression: ReturnType<typeof vi.fn>
let mockParseRosterPayload: ReturnType<typeof vi.fn>
let mockBuildRosterLookup: ReturnType<typeof vi.fn>
let mockFetchStrengthThresholds: ReturnType<typeof vi.fn>
let mockEvaluateStrengthState: ReturnType<typeof vi.fn>

describe('POST /api/meta/roster-roi', () => {
  let POST: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let mockAuthSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateServiceClient = vi.fn()
    mockCreateClient = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockResolveDagProgression = vi.fn()
    mockParseRosterPayload = vi.fn()
    mockBuildRosterLookup = vi.fn()
    mockFetchStrengthThresholds = vi.fn()
    mockEvaluateStrengthState = vi.fn()

    vi.doMock('@/app/lib/auth/server', () => ({
      createServiceClient: mockCreateServiceClient,
      createClient: mockCreateClient
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess
    }))

    vi.doMock('@/app/lib/meta/dag-progression', () => ({
      resolveDagProgression: mockResolveDagProgression
    }))

    vi.doMock('@/app/lib/meta/roster-input', () => ({
      parseRosterPayload: mockParseRosterPayload
    }))

    vi.doMock('@/app/lib/meta/roster-strength', () => ({
      buildRosterLookup: mockBuildRosterLookup,
      fetchStrengthThresholds: mockFetchStrengthThresholds,
      evaluateStrengthState: mockEvaluateStrengthState
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn()
      }
    }))

    mockSupabase = {
      from: vi.fn(),
      rpc: vi.fn()
    }

    mockAuthSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateServiceClient.mockReturnValue(mockSupabase)
    mockCreateClient.mockResolvedValue(mockAuthSupabase)

    const routeModule = await import('@/app/api/meta/roster-roi/route')
    POST = routeModule.POST
  })

  describe('validation', () => {
    it('returns empty results when roster parse fails with error', async () => {
      mockParseRosterPayload.mockReturnValue({
        roster: null,
        error: 'Invalid roster format'
      })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: 'invalid' })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toBe('Invalid roster format')
    })

    it('returns message when roster is empty', async () => {
      mockParseRosterPayload.mockReturnValue({ roster: [], error: null })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: [] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.message).toBe('Roster is required to compute ROI')
    })

    it('returns message when roster lacks strength data', async () => {
      mockParseRosterPayload.mockReturnValue({
        roster: [{ name: 'Hero1' }],
        error: null
      })
      mockBuildRosterLookup.mockReturnValue({ hasStrengthData: false })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: [{ name: 'Hero1' }] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.message).toBe(
        'Roster strength data is missing. Re-sync your API key to include rank and ability levels.'
      )
    })
  })

  describe('authentication', () => {
    beforeEach(() => {
      mockParseRosterPayload.mockReturnValue({
        roster: [{ name: 'Hero1', rank: 'Gold1' }],
        error: null
      })
      mockBuildRosterLookup.mockReturnValue({ hasStrengthData: true })
    })

    it('returns 401 when user is not authenticated', async () => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: [{ name: 'Hero1', rank: 'Gold1' }] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('feature access', () => {
    beforeEach(() => {
      mockParseRosterPayload.mockReturnValue({
        roster: [{ name: 'Hero1', rank: 'Gold1' }],
        error: null
      })
      mockBuildRosterLookup.mockReturnValue({ hasStrengthData: true })
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
    })

    it('returns 403 when user lacks meta_atlas access', async () => {
      mockCheckFeatureAccess.mockResolvedValue({
        has_access: false,
        stage: 'beta',
        reason: 'Feature in beta'
      })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: [{ name: 'Hero1', rank: 'Gold1' }] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('Meta Atlas feature access requ')
      expect(body.error.metadata?.stage).toBe('beta')
    })
  })

  describe('profile validation', () => {
    beforeEach(() => {
      mockParseRosterPayload.mockReturnValue({
        roster: [{ name: 'Hero1', rank: 'Gold1' }],
        error: null
      })
      mockBuildRosterLookup.mockReturnValue({ hasStrengthData: true })
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns 400 when profile not found', async () => {
      mockAuthSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({ data: null, error: null })
      })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: [{ name: 'Hero1', rank: 'Gold1' }] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Player profile not found. Comp')
    })

    it('returns 400 when profile lacks display_name', async () => {
      mockAuthSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { guild_code: 'TEST' },
          error: null
        })
      })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: [{ name: 'Hero1', rank: 'Gold1' }] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('Player profile not found. Comp')
    })
  })

  describe('successful queries', () => {
    beforeEach(() => {
      mockParseRosterPayload.mockReturnValue({
        roster: [{ name: 'Hero1', rank: 'Gold1' }],
        error: null
      })
      mockBuildRosterLookup.mockReturnValue({
        hasStrengthData: true,
        find: vi.fn().mockReturnValue({ raw: { name: 'Hero1', rank: 'Gold1' } })
      })
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockAuthSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { display_name: 'TestPlayer', guild_code: 'TEST' },
          error: null
        })
      })
    })

    it('returns empty results when no current teams available', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: [], error: null })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: [{ name: 'Hero1', rank: 'Gold1' }] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.message).toBe('No current teams available for ROI')
    })

    it('returns ROI results with progression data', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({
          data: [
            {
              boss_type: 'Hive_Tyrant',
              team_composition: 'Hero1, Hero2, Hero3, Hero4, Hero5',
              team_hash: 'abc123',
              attack_count: 10,
              avg_damage: 450000
            }
          ],
          error: null
        })
      mockResolveDagProgression.mockResolvedValue({
        boss_type: 'Hive_Tyrant',
        total_damage_increase: 50000,
        upgrade_path: [],
        target_team: 'Hero1, Hero2, Hero3, Hero4, Hero5',
        filters: { rarity_set: 'L3', encounter_index: 0, season: '45' }
      })
      mockFetchStrengthThresholds.mockResolvedValue({})
      mockEvaluateStrengthState.mockReturnValue('Strong')

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: [{ name: 'Hero1', rank: 'Gold1' }] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.season).toBeDefined()
      expect(body.results).toBeDefined()
      expect(Array.isArray(body.results)).toBe(true)
    })

    it('uses season parameter when provided', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({
          roster: [{ name: 'Hero1', rank: 'Gold1' }],
          season: '44'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.season).toBe('44')
    })

    it('applies limit parameter', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: [], error: null })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({
          roster: [{ name: 'Hero1', rank: 'Gold1' }],
          limit: 3
        })
      })

      const response = await POST(request)

      expect(response.status).toBe(200)
    })

    it('uses current_teams from request body', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: '45', error: null })

      mockResolveDagProgression.mockResolvedValue({
        boss_type: 'Hive_Tyrant',
        total_damage_increase: 50000,
        current_team: 'Hero1, Hero2, Hero3, Hero4, Hero5',
        target_team: 'Hero1, Hero2, Hero3, Hero4, Hero6',
        upgrade_path: [
          {
            from_team: 'Hero1, Hero2, Hero3, Hero4, Hero5',
            to_team: 'Hero1, Hero2, Hero3, Hero4, Hero6',
            damage_gain: 50000
          }
        ],
        filters: { rarity_set: 'L3', encounter_index: 0, season: '45' }
      })
      mockFetchStrengthThresholds.mockResolvedValue({
        suitable_threshold: { rank_index: 4, stars: 3 },
        strong_threshold: { rank_index: 6, stars: 4 }
      })
      mockEvaluateStrengthState.mockReturnValue('Strong')
      mockBuildRosterLookup.mockReturnValue({
        hasStrengthData: true,
        find: vi.fn().mockReturnValue({
          raw: { name: 'Hero1', rank: 'Gold1', rank_index: 5, stars: 3 }
        })
      })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({
          roster: [{ name: 'Hero1', rank: 'Gold1' }],
          current_teams: [
            {
              boss_type: 'Hive_Tyrant',
              current_team: 'Hero1, Hero2, Hero3, Hero4, Hero5',
              current_team_hash: 'abc123',
              rarity_set: 'L3',
              encounter_index: 0
            }
          ]
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.season).toBeDefined()
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockParseRosterPayload.mockReturnValue({
        roster: [{ name: 'Hero1', rank: 'Gold1' }],
        error: null
      })
      mockBuildRosterLookup.mockReturnValue({ hasStrengthData: true })
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockAuthSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        single: vi.fn().mockResolvedValue({
          data: { display_name: 'TestPlayer', guild_code: 'TEST' },
          error: null
        })
      })
    })

    it('returns 500 when player teams RPC fails', async () => {
      mockSupabase.rpc
        .mockResolvedValueOnce({ data: '45', error: null })
        .mockResolvedValueOnce({ data: null, error: { message: 'RPC failed' } })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: [{ name: 'Hero1', rank: 'Gold1' }] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toContain('Failed to fetch player team us')
    })

    it('returns 500 when exception is thrown', async () => {
      mockSupabase.rpc.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = new Request('http://localhost/api/meta/roster-roi', {
        method: 'POST',
        body: JSON.stringify({ roster: [{ name: 'Hero1', rank: 'Gold1' }] })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(500)
      expect(body.error.message).toBe('Failed to compute roster ROI')
    })
  })
})
