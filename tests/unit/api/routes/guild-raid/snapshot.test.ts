import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/app/lib/player-mapping-relations', () => ({
  CURRENT_USER_PLAYER_MAPPING: 'player_mapping'
}))
import { NextRequest } from 'next/server'

let mockCreateClient: ReturnType<typeof vi.fn>
let mockCheckFeatureAccess: ReturnType<typeof vi.fn>
let mockGetLatestSeason: ReturnType<typeof vi.fn>
let mockGetAllBossHp: ReturnType<typeof vi.fn>
let mockEnsureRotationSnapshot: ReturnType<typeof vi.fn>
let mockBuildPlanFromNowSnapshot: ReturnType<typeof vi.fn>
let mockResolvePlanningRotation: ReturnType<typeof vi.fn>
let mockGetSeasonConfigForSeasonNumber: ReturnType<typeof vi.fn>
let mockGetActiveProgressionConfig: ReturnType<typeof vi.fn>

const PROGRESSION_CONFIG = {
  firstPassSequence: ['L1', 'L2', 'L3', 'L4', 'L5', 'M1', 'M2', 'M3'],
  loopSequence: ['L4', 'L5', 'M1', 'M2', 'M3'],
  loopStartStage: 'L4',
  gameVersion: 'test'
}

describe('/api/guild-raid/season-plan/snapshot', () => {
  let GET: (request: NextRequest) => Promise<Response>
  let mockSupabase: {
    auth: { getUser: ReturnType<typeof vi.fn> }
    from: ReturnType<typeof vi.fn>
  }

  function createQueryChain(resolvedValue: { data: unknown; error: unknown }) {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      in: vi.fn().mockReturnThis(),
      not: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue(resolvedValue),
      single: vi.fn().mockResolvedValue(resolvedValue)
    }
    return chain
  }

  beforeEach(async () => {
    vi.resetModules()

    mockCreateClient = vi.fn()
    mockCheckFeatureAccess = vi.fn()
    mockGetLatestSeason = vi.fn().mockResolvedValue('42')
    mockGetAllBossHp = vi.fn().mockResolvedValue({})
    mockEnsureRotationSnapshot = vi
      .fn()
      .mockResolvedValue({ currentConfigId: 'config-1' })
    mockBuildPlanFromNowSnapshot = vi.fn()
    mockResolvePlanningRotation = vi.fn(({ liveRotation }) => ({
      rotation: liveRotation,
      seasonId: liveRotation?.currentConfigId ?? null
    }))
    mockGetSeasonConfigForSeasonNumber = vi
      .fn()
      .mockReturnValue({ id: 'season-config', bosses: [] })
    mockGetActiveProgressionConfig = vi
      .fn()
      .mockResolvedValue(PROGRESSION_CONFIG)

    vi.doMock('@/app/lib/auth/server', () => ({
      createClient: mockCreateClient
    }))

    vi.doMock('@tacticus/app-core/logger', () => ({
      legacyConsoleLogger: {
        error: vi.fn(),
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn()
      }
    }))

    vi.doMock('@/app/lib/services/feature-release-service', () => ({
      checkFeatureAccess: mockCheckFeatureAccess
    }))

    vi.doMock('@/app/lib/utils/season', () => ({
      getLatestSeason: mockGetLatestSeason
    }))

    vi.doMock('@/app/lib/data/boss-hp', () => ({
      getAllBossHp: mockGetAllBossHp
    }))

    vi.doMock('@/app/lib/loki/rotation-cache', () => ({
      ensureRotationSnapshot: mockEnsureRotationSnapshot
    }))

    vi.doMock(
      '@/app/lib/boss-assignments/season-planner/planning-rotation',
      () => ({
        resolvePlanningRotation: mockResolvePlanningRotation
      })
    )

    vi.doMock('@/app/lib/boss-assignments/season-planner/snapshot', () => ({
      buildPlanFromNowSnapshot: mockBuildPlanFromNowSnapshot
    }))

    vi.doMock('@/app/lib/boss-assignments/progression-config', () => ({
      getActiveProgressionConfig: mockGetActiveProgressionConfig
    }))

    vi.doMock('@/app/lib/loki/season-configs', () => ({
      getSeasonConfigForSeasonNumber: mockGetSeasonConfigForSeasonNumber,
      matchSeasonConfig: vi
        .fn()
        .mockReturnValue({ config: { id: 'S44' }, matches: [] }),
      SEASON_CONFIGS: [{ id: 'S44' }]
    }))

    mockSupabase = {
      auth: { getUser: vi.fn() },
      from: vi.fn()
    }

    mockCreateClient.mockResolvedValue(mockSupabase)

    const routeModule =
      await import('@/app/api/guild-raid/season-plan/snapshot/route')
    GET = routeModule.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('GET - Fetch season plan snapshot', () => {
    it('returns 401 when user is not authenticated', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: null },
        error: { message: 'Not authenticated' }
      })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot'
      )

      const response = await GET(request)

      expect(response.status).toBe(401)
    })

    it('returns 403 when boss_assignments feature not enabled', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: false })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('Boss assignments')
    })

    it('returns 403 when season_planner feature not enabled', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess
        .mockResolvedValueOnce({ has_access: true })
        .mockResolvedValueOnce({ has_access: false })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
      const body = await response.json()
      expect(body.error.message).toContain('Season planner')
    })

    it('returns 403 when profile not found', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue(
        createQueryChain({
          data: null,
          error: { message: 'Not found' }
        })
      )

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
    })

    it('returns 403 when user is not officer or leader', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
      mockSupabase.from.mockReturnValue(
        createQueryChain({
          data: { guild_code: 'TEST', role: 'member' },
          error: null
        })
      )

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot'
      )

      const response = await GET(request)

      expect(response.status).toBe(403)
    })

    it('returns snapshot with roster successfully', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        fromCallCount++
        if (fromCallCount === 1 && table === 'player_mapping') {
          return createQueryChain({
            data: { guild_code: 'TEST', role: 'leader' },
            error: null
          })
        }
        if (table === 'EOT_GR_data') {
          return createQueryChain({ data: [], error: null })
        }
        if (table === 'player_mapping') {
          return createQueryChain({
            data: [
              { player_id: 'p1', display_name: 'Player1' },
              { player_id: 'p2', display_name: 'Player2' }
            ],
            error: null
          })
        }
        return createQueryChain({ data: [], error: null })
      })

      const mockSnapshotData = {
        currentBoss: 'Boss1',
        encounters: []
      }
      mockBuildPlanFromNowSnapshot.mockResolvedValue(mockSnapshotData)

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.snapshot).toEqual(mockSnapshotData)
      expect(body.roster).toHaveLength(2)
    })

    it('uses custom season and snapshot_at from query', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        fromCallCount++
        if (fromCallCount === 1) {
          return createQueryChain({
            data: { guild_code: 'TEST', role: 'leader' },
            error: null
          })
        }
        return createQueryChain({ data: [], error: null })
      })

      mockBuildPlanFromNowSnapshot.mockResolvedValue({})

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot?season=43&snapshot_at=2024-01-15T00:00:00Z'
      )

      await GET(request)

      expect(mockBuildPlanFromNowSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          season: '43',
          snapshotAt: '2024-01-15T00:00:00Z',
          progressionConfig: PROGRESSION_CONFIG,
          preferAsOfStatus: true
        })
      )
    })

    it.each(['42abc', '0', '-1', '1234567'])(
      'returns 400 before snapshot work when season is malformed: %s',
      async (season) => {
        mockSupabase.auth.getUser.mockResolvedValue({
          data: { user: { id: 'user-123' } },
          error: null
        })
        mockCheckFeatureAccess.mockResolvedValue({ has_access: true })
        mockSupabase.from.mockReturnValue(
          createQueryChain({
            data: { guild_code: 'TEST', role: 'leader' },
            error: null
          })
        )

        const request = new NextRequest(
          `http://localhost/api/guild-raid/season-plan/snapshot?season=${season}`
        )

        const response = await GET(request)
        const body = await response.json()

        expect(response.status).toBe(400)
        expect(body.error.message).toContain('season')
        expect(mockGetAllBossHp).not.toHaveBeenCalled()
        expect(mockEnsureRotationSnapshot).not.toHaveBeenCalled()
        expect(mockBuildPlanFromNowSnapshot).not.toHaveBeenCalled()
      }
    )

    it('returns empty roster when roster query fails', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation((table: string) => {
        fromCallCount++
        if (fromCallCount === 1) {
          return createQueryChain({
            data: { guild_code: 'TEST', role: 'leader' },
            error: null
          })
        }
        if (table === 'EOT_GR_data') {
          return createQueryChain({ data: [], error: null })
        }
        return createQueryChain({
          data: null,
          error: { message: 'Roster query failed' }
        })
      })

      mockBuildPlanFromNowSnapshot.mockResolvedValue({ encounters: [] })

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot'
      )

      const response = await GET(request)
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.roster).toEqual([])
    })

    it('passes rotation snapshot to builder', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        fromCallCount++
        if (fromCallCount === 1) {
          return createQueryChain({
            data: { guild_code: 'TEST', role: 'officer' },
            error: null
          })
        }
        return createQueryChain({ data: [], error: null })
      })

      const rotationData = { currentConfigId: 'custom-config', bosses: [] }
      mockEnsureRotationSnapshot.mockResolvedValue(rotationData)
      mockBuildPlanFromNowSnapshot.mockResolvedValue({})

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot'
      )

      await GET(request)

      expect(mockBuildPlanFromNowSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          rotationSnapshot: rotationData
        })
      )
    })

    it('uses selected config rotation when config_id is supplied', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        fromCallCount++
        if (fromCallCount === 1) {
          return createQueryChain({
            data: { guild_code: 'TEST', role: 'officer' },
            error: null
          })
        }
        return createQueryChain({ data: [], error: null })
      })

      const liveRotation = { currentConfigId: 'live-config', currentBosses: [] }
      const seasonConfig = {
        id: 'config-target',
        bosses: [{ boss_name: 'TargetBoss' }]
      }
      const selectedRotation = {
        currentConfigId: 'config-target',
        currentBosses: seasonConfig.bosses
      }
      mockEnsureRotationSnapshot.mockResolvedValue(liveRotation)
      mockGetSeasonConfigForSeasonNumber.mockReturnValue(seasonConfig)
      mockResolvePlanningRotation.mockReturnValue({
        rotation: selectedRotation,
        seasonId: 'config-target'
      })
      mockBuildPlanFromNowSnapshot.mockResolvedValue({})

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot?season=43&config_id=config-target'
      )

      await GET(request)

      expect(mockGetSeasonConfigForSeasonNumber).toHaveBeenCalledWith(43)
      expect(mockResolvePlanningRotation).toHaveBeenCalledWith({
        configId: 'config-target',
        seasonConfig,
        liveRotation
      })
      expect(mockBuildPlanFromNowSnapshot).toHaveBeenCalledWith(
        expect.objectContaining({
          season: '43',
          seasonId: 'config-target',
          rotationSnapshot: selectedRotation,
          preferAsOfStatus: true
        })
      )
    })

    it('returns 500 when snapshot builder throws', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        fromCallCount++
        if (fromCallCount === 1) {
          return createQueryChain({
            data: { guild_code: 'TEST', role: 'leader' },
            error: null
          })
        }
        return createQueryChain({ data: [], error: null })
      })

      mockBuildPlanFromNowSnapshot.mockRejectedValue(
        new Error('Snapshot build failed')
      )

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot'
      )

      const response = await GET(request)

      expect(response.status).toBe(500)
      const body = await response.json()
      expect(body.error.metadata?.details).toContain('Snapshot build failed')
    })

    it('handles admin role as officer-level permissions', async () => {
      mockSupabase.auth.getUser.mockResolvedValue({
        data: { user: { id: 'user-123' } },
        error: null
      })
      mockCheckFeatureAccess.mockResolvedValue({ has_access: true })

      let fromCallCount = 0
      mockSupabase.from.mockImplementation(() => {
        fromCallCount++
        if (fromCallCount === 1) {
          return createQueryChain({
            data: { guild_code: 'TEST', role: 'admin' },
            error: null
          })
        }
        return createQueryChain({ data: [], error: null })
      })

      mockBuildPlanFromNowSnapshot.mockResolvedValue({})

      const request = new NextRequest(
        'http://localhost/api/guild-raid/season-plan/snapshot'
      )

      const response = await GET(request)

      expect(response.status).toBe(200)
    })
  })
})
