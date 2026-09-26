import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockDb: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>

describe('POST /api/meta/team-floor', () => {
  let POST: (request: Request) => Promise<Response>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    rpc: ReturnType<typeof vi.fn>
  }
  let mockAuthSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
  }

  beforeEach(async () => {
    vi.resetModules()

    mockDb = vi.fn()
    mockServiceDb = vi.fn()
    mockCheckFeatureAccess = vi.fn()

    vi.doMock('@/app/lib/db', () => ({
      db: mockDb,
      serviceDb: mockServiceDb
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess
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
      auth: { getUser: vi.fn() }
    }

    mockServiceDb.mockReturnValue(mockSupabase)
    mockDb.mockResolvedValue(mockAuthSupabase)

    const routeModule = await import('@/app/api/meta/team-floor/route')
    POST = routeModule.POST
  })

  describe('validation', () => {
    it('returns 400 when team_hash is missing', async () => {
      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('team_hash, boss_type, rarity_s')
    })

    it('returns 400 when boss_type is missing', async () => {
      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('team_hash, boss_type, rarity_s')
    })

    it('returns 400 when rarity_set is missing', async () => {
      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('team_hash, boss_type, rarity_s')
    })

    it('returns 400 when season is missing', async () => {
      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('team_hash, boss_type, rarity_s')
    })

    it('returns 400 when encounter_index is missing', async () => {
      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('team_hash, boss_type, rarity_s')
    })

    it('returns 400 when encounter_index is not a valid number', async () => {
      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 'invalid'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(400)
      expect(body.error.message).toContain('team_hash, boss_type, rarity_s')
    })
  })

  describe('authentication', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({ data: { user: null } })

      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(401)
      expect(body.error.message).toBe('Authentication required')
    })
  })

  describe('feature access', () => {
    beforeEach(() => {
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

      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(403)
      expect(body.error.message).toContain('Meta Atlas feature access requ')
      expect(body.error.metadata?.stage).toBe('beta')
    })
  })

  describe('successful queries', () => {
    const mockFloorData = [
      {
        team_hash: 'abc123',
        unit_id: 'hero1',
        min_rank_name: 'Gold1',
        min_rank_index: 5,
        min_stars: 3,
        sample_hits: 50,
        sample_players: 10,
        p90_damage: 500000
      },
      {
        team_hash: 'abc123',
        unit_id: 'hero2',
        min_rank_name: 'Gold2',
        min_rank_index: 6,
        min_stars: 4,
        sample_hits: 50,
        sample_players: 10,
        p90_damage: 500000
      }
    ]

    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns empty units when no floor data found', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: [], error: null })

      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.team_hash).toBe('abc123')
      expect(body.boss_type).toBe('Hive_Tyrant')
      expect(body.rarity_set).toBe('L3')
      expect(body.season).toBe('45')
      expect(body.encounter_index).toBe(0)
      expect(body.p90_damage).toBeNull()
      expect(body.sample_hits).toBe(0)
      expect(body.sample_players).toBe(0)
      expect(body.units).toEqual([])
    })

    it('returns floor requirements for team', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockFloorData, error: null })

      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.team_hash).toBe('abc123')
      expect(body.p90_damage).toBe(500000)
      expect(body.sample_hits).toBe(50)
      expect(body.sample_players).toBe(10)
      expect(body.units).toHaveLength(2)
      expect(body.units[0].unit_id).toBe('hero1')
      expect(body.units[0].min_rank_name).toBe('Gold1')
      expect(body.units[0].min_rank_index).toBe(5)
      expect(body.units[0].min_stars).toBe(3)
    })

    it('handles boss_unit_id when provided', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockFloorData, error: null })

      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          boss_unit_id: 'GuildBoss1',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.boss_unit_id).toBe('GuildBoss1')
      expect(mockSupabase.rpc).toHaveBeenCalledWith(
        'get_meta_atlas_team_floor',
        expect.objectContaining({
          p_boss_unit_id: 'GuildBoss1'
        })
      )
    })

    it('parses encounter_index from string', async () => {
      mockSupabase.rpc.mockResolvedValue({ data: mockFloorData, error: null })

      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45',
          encounter_index: '2'
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.encounter_index).toBe(2)
    })

    it('handles null values in floor data', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: [
          {
            team_hash: 'abc123',
            unit_id: 'hero1',
            min_rank_name: null,
            min_rank_index: null,
            min_stars: null,
            sample_hits: 50,
            sample_players: 10,
            p90_damage: null
          }
        ],
        error: null
      })

      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.units[0].min_rank_name).toBeNull()
      expect(body.units[0].min_rank_index).toBeNull()
      expect(body.units[0].min_stars).toBeNull()
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      mockAuthSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } }
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
    })

    it('returns fallback payload when RPC fails', async () => {
      mockSupabase.rpc.mockResolvedValue({
        data: null,
        error: { message: 'RPC failed' }
      })

      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.unavailable).toBe(true)
      expect(body.error).toBe('team_floor_unavailable')
    })

    it('returns fallback payload when exception is thrown', async () => {
      mockSupabase.rpc.mockImplementation(() => {
        throw new Error('Connection failed')
      })

      const request = new Request('http://localhost/api/meta/team-floor', {
        method: 'POST',
        body: JSON.stringify({
          team_hash: 'abc123',
          boss_type: 'Hive_Tyrant',
          rarity_set: 'L3',
          season: '45',
          encounter_index: 0
        })
      })

      const response = await POST(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.unavailable).toBe(true)
      expect(body.error).toBe('team_floor_unavailable')
    })
  })
})
