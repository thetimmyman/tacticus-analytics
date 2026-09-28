import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: vi.fn()
}))

vi.mock('@/app/lib/utils/error-handling', () => ({
  parseSupabaseError: vi.fn((error) => ({
    message: error?.message || 'Unknown error'
  }))
}))

describe('DB Operations Module', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('getErrorMessage', () => {
    it('should extract message from error object', async () => {
      const { getErrorMessage } = await import('@/app/lib/sync/db-operations')
      const result = getErrorMessage({ message: 'Test error' })
      expect(result).toBe('Test error')
    })

    it('should handle null error', async () => {
      const { getErrorMessage } = await import('@/app/lib/sync/db-operations')
      const result = getErrorMessage(null)
      expect(result).toBe('Unknown error')
    })

    it('should handle undefined error', async () => {
      const { getErrorMessage } = await import('@/app/lib/sync/db-operations')
      const result = getErrorMessage(undefined)
      expect(result).toBe('Unknown error')
    })
  })

  describe('isRecentTimestamp', () => {
    it('should return false for null timestamp', async () => {
      const { isRecentTimestamp } = await import('@/app/lib/sync/db-operations')
      expect(isRecentTimestamp(null)).toBe(false)
    })

    it('should return false for undefined timestamp', async () => {
      const { isRecentTimestamp } = await import('@/app/lib/sync/db-operations')
      expect(isRecentTimestamp(undefined)).toBe(false)
    })

    it('should return false for invalid timestamp', async () => {
      const { isRecentTimestamp } = await import('@/app/lib/sync/db-operations')
      expect(isRecentTimestamp('not-a-date')).toBe(false)
    })

    it('should return true for recent timestamp (within 5 seconds)', async () => {
      const { isRecentTimestamp } = await import('@/app/lib/sync/db-operations')
      const recentTime = new Date(Date.now() - 2000).toISOString()
      expect(isRecentTimestamp(recentTime)).toBe(true)
    })

    it('should return false for old timestamp (older than 5 seconds)', async () => {
      const { isRecentTimestamp } = await import('@/app/lib/sync/db-operations')
      const oldTime = new Date(Date.now() - 10000).toISOString()
      expect(isRecentTimestamp(oldTime)).toBe(false)
    })
  })

  describe('fetchBossMappings', () => {
    it('should return empty object on error', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi
            .fn()
            .mockResolvedValue({ data: null, error: new Error('DB Error') })
        })
      }

      const { fetchBossMappings } = await import('@/app/lib/sync/db-operations')
      const result = await fetchBossMappings(mockSupabase as never)
      expect(result).toEqual({})
    })

    it('should build mappings from valid data', async () => {
      const mockData = [
        {
          boss_type: 'Magnus',
          encounter_index: 0,
          boss_name: 'Magnus the Red'
        },
        { boss_type: 'Magnus', encounter_index: 1, boss_name: 'Magnus Prime' },
        {
          boss_type: 'Hive Tyrant',
          encounter_index: 0,
          boss_name: 'Hive Tyrant'
        }
      ]
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: mockData, error: null })
        })
      }

      const { fetchBossMappings } = await import('@/app/lib/sync/db-operations')
      const result = await fetchBossMappings(mockSupabase as never)

      expect(result['Magnus']).toBeDefined()
      expect(result['Magnus']![0]).toBe('Magnus the Red')
      expect(result['Magnus']![1]).toBe('Magnus Prime')
      expect(result['Hive Tyrant']![0]).toBe('Hive Tyrant')
    })

    it('should skip rows with missing boss_type', async () => {
      const mockData = [
        { boss_type: null, encounter_index: 0, boss_name: 'Unknown' },
        { boss_type: 'Valid', encounter_index: 0, boss_name: 'Valid Boss' }
      ]
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: mockData, error: null })
        })
      }

      const { fetchBossMappings } = await import('@/app/lib/sync/db-operations')
      const result = await fetchBossMappings(mockSupabase as never)

      expect(Object.keys(result).length).toBe(1)
      expect(result['Valid']).toBeDefined()
    })

    it('should skip rows with null encounter_index', async () => {
      const mockData = [
        { boss_type: 'Boss', encounter_index: null, boss_name: 'Boss Name' }
      ]
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockResolvedValue({ data: mockData, error: null })
        })
      }

      const { fetchBossMappings } = await import('@/app/lib/sync/db-operations')
      const result = await fetchBossMappings(mockSupabase as never)

      expect(Object.keys(result).length).toBe(0)
    })
  })

  describe('analyzeBossMappingCoverage', () => {
    it('should count main bosses (encounterId = 0)', async () => {
      const processedData = [
        { encounterId: 0, Name: 'Magnus', type: 'Magnus' },
        { encounterId: 0, Name: 'Hive Tyrant', type: 'HiveTyrant' },
        { encounterId: 1, Name: 'Prime Boss', type: 'Prime' }
      ]

      const { analyzeBossMappingCoverage } =
        await import('@/app/lib/sync/db-operations')
      const result = await analyzeBossMappingCoverage(
        'TEST',
        processedData as never
      )

      expect(result.mainBosses).toBe(2)
      expect(result.primeBosses).toBe(1)
    })

    it('should count mapped vs unmapped entries', async () => {
      const processedData = [
        { encounterId: 0, Name: 'Magnus', type: 'Magnus' },
        { encounterId: 0, Name: 'Unknown', type: 'UnknownBoss' },
        { encounterId: 0, Name: null, type: 'NoName' }
      ]

      const { analyzeBossMappingCoverage } =
        await import('@/app/lib/sync/db-operations')
      const result = await analyzeBossMappingCoverage(
        'TEST',
        processedData as never
      )

      expect(result.mapped).toBe(1)
      expect(result.unmapped).toBe(2)
      expect(result.unknownBosses).toBe(1)
    })

    it('should track unique boss types', async () => {
      const processedData = [
        { encounterId: 0, Name: 'Magnus', type: 'Magnus' },
        { encounterId: 0, Name: 'Magnus', type: 'Magnus' },
        { encounterId: 0, Name: 'Hive Tyrant', type: 'HiveTyrant' }
      ]

      const { analyzeBossMappingCoverage } =
        await import('@/app/lib/sync/db-operations')
      const result = await analyzeBossMappingCoverage(
        'TEST',
        processedData as never
      )

      expect(result.bossTypes.size).toBe(2)
      expect(result.bossTypes.has('Magnus')).toBe(true)
      expect(result.bossTypes.has('Hive Tyrant')).toBe(true)
    })
  })

  describe('validateBossMappings', () => {
    it('should identify missing mappings', async () => {
      const entries = [
        { type: 'Magnus', encounterIndex: 1, userId: 'player1' },
        { type: 'Magnus', encounterIndex: 2, userId: 'player2' }
      ]
      const bossMappings = {
        Magnus: { 1: 'Magnus Prime 1' }
      }

      const { validateBossMappings } =
        await import('@/app/lib/sync/db-operations')
      const result = await validateBossMappings(
        'TEST',
        entries as never,
        bossMappings
      )

      expect(result.validated).toBe(true)
      expect(result.missingCount).toBeGreaterThan(0)
    })

    it('should report zero missing when all mapped', async () => {
      const entries = [{ type: 'Magnus', encounterIndex: 1 }]
      const bossMappings = {
        Magnus: { 1: 'Magnus Prime 1' }
      }

      const { validateBossMappings } =
        await import('@/app/lib/sync/db-operations')
      const result = await validateBossMappings(
        'TEST',
        entries as never,
        bossMappings
      )

      expect(result.missingCount).toBe(0)
    })

    it('should skip entries with encounterIndex <= 0', async () => {
      const entries = [
        { type: 'Magnus', encounterIndex: 0 },
        { type: 'Magnus', encounterIndex: -1 }
      ]
      const bossMappings = {}

      const { validateBossMappings } =
        await import('@/app/lib/sync/db-operations')
      const result = await validateBossMappings(
        'TEST',
        entries as never,
        bossMappings
      )

      expect(result.requiredCount).toBe(0)
    })
  })

  describe('getRecentPlayerActivity', () => {
    it('should return empty Set on error', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                order: vi.fn().mockResolvedValue({
                  data: null,
                  error: new Error('DB Error')
                })
              })
            })
          })
        })
      }

      const { getRecentPlayerActivity } =
        await import('@/app/lib/sync/db-operations')
      const result = await getRecentPlayerActivity(
        mockSupabase as never,
        'TEST'
      )

      expect(result).toBeInstanceOf(Set)
      expect(result.size).toBe(0)
    })

    it('should return Set of active player IDs', async () => {
      const mockData = [
        {
          userId: 'player1',
          completedOn: new Date().toISOString(),
          Season: '81'
        },
        {
          userId: 'player2',
          completedOn: new Date().toISOString(),
          Season: '81'
        },
        {
          userId: 'player1',
          completedOn: new Date().toISOString(),
          Season: '81'
        }
      ]
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              gte: vi.fn().mockReturnValue({
                order: vi
                  .fn()
                  .mockResolvedValue({ data: mockData, error: null })
              })
            })
          })
        })
      }

      const { getRecentPlayerActivity } =
        await import('@/app/lib/sync/db-operations')
      const result = await getRecentPlayerActivity(
        mockSupabase as never,
        'TEST'
      )

      expect(result.size).toBe(2)
      expect(result.has('player1')).toBe(true)
      expect(result.has('player2')).toBe(true)
    })
  })

  describe('trackUnitIds', () => {
    it('should return zeros for empty entries', async () => {
      const { trackUnitIds } = await import('@/app/lib/sync/db-operations')
      const result = await trackUnitIds({} as never, [], 'TEST')

      expect(result).toEqual({
        newUnits: 0,
        totalUnits: 0,
        newHeroes: 0,
        newMOWs: 0
      })
    })

    it('should extract hero unit IDs from heroDetails string', async () => {
      const entries = [
        {
          heroDetails: JSON.stringify([
            { unitId: 'hero1' },
            { unitId: 'hero2' }
          ])
        }
      ]
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null })
          }),
          insert: vi.fn().mockResolvedValue({ error: null })
        })
      }

      const { trackUnitIds } = await import('@/app/lib/sync/db-operations')
      const result = await trackUnitIds(
        mockSupabase as never,
        entries as never,
        'TEST'
      )

      expect(result.totalUnits).toBe(2)
    })

    it('should extract MOW unit IDs from machineOfWarDetails', async () => {
      const entries = [
        { machineOfWarDetails: JSON.stringify({ unitId: 'mow1' }) }
      ]
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null })
          }),
          insert: vi.fn().mockResolvedValue({ error: null })
        })
      }

      const { trackUnitIds } = await import('@/app/lib/sync/db-operations')
      const result = await trackUnitIds(
        mockSupabase as never,
        entries as never,
        'TEST'
      )

      expect(result.totalUnits).toBe(1)
    })

    it('should not create duplicates for existing units', async () => {
      const entries = [{ heroDetails: JSON.stringify([{ unitId: 'hero1' }]) }]
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi
              .fn()
              .mockResolvedValue({ data: [{ unit_id: 'hero1' }], error: null })
          }),
          insert: vi.fn().mockResolvedValue({ error: null })
        })
      }

      const { trackUnitIds } = await import('@/app/lib/sync/db-operations')
      const result = await trackUnitIds(
        mockSupabase as never,
        entries as never,
        'TEST'
      )

      expect(result.newUnits).toBe(0)
      expect(result.totalUnits).toBe(1)
    })

    it('should skip variant unit IDs and keep playable heroes', async () => {
      const entries = [
        {
          heroDetails: JSON.stringify([
            { unitId: 'adeptBossCanoness' },
            { unitId: 'adeptNpcCanoness' },
            { unitId: 'adeptBossCanonessLHE' },
            { unitId: 'orksWarboss' },
            { unitId: 'LootObj_AmmoBox' },
            { unitId: 'necroNpc1TutWarriorFTUEtest' },
            { unitId: 'admecBossDestroyerCE' }
          ]),
          machineOfWarDetails: JSON.stringify({ unitId: 'adeptNpcMoWExorcist' })
        },
        {
          machineOfWarDetails: JSON.stringify({ unitId: 'mowValid' })
        }
      ]
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            in: vi.fn().mockResolvedValue({ data: [], error: null })
          }),
          insert: vi.fn().mockResolvedValue({ error: null })
        })
      }

      const { trackUnitIds } = await import('@/app/lib/sync/db-operations')
      const result = await trackUnitIds(
        mockSupabase as never,
        entries as never,
        'TEST'
      )

      expect(result.totalUnits).toBe(2)
      expect(result.newUnits).toBe(2)
      expect(result.newHeroes).toBe(1)
      expect(result.newMOWs).toBe(1)
    })

    it('should return zeros when only variants are present', async () => {
      const entries = [
        { heroDetails: JSON.stringify([{ unitId: 'adeptBossCanoness' }]) }
      ]
      const mockSupabase = { from: vi.fn() }

      const { trackUnitIds } = await import('@/app/lib/sync/db-operations')
      const result = await trackUnitIds(
        mockSupabase as never,
        entries as never,
        'TEST'
      )

      expect(result).toEqual({
        newUnits: 0,
        totalUnits: 0,
        newHeroes: 0,
        newMOWs: 0
      })
      expect(mockSupabase.from).not.toHaveBeenCalled()
    })
  })

  describe('updateBombTracking', () => {
    it('should skip if no bomb entries', async () => {
      const entries = [{ damageType: 'Battle', userId: 'player1' }]
      const mockSupabase = {
        from: vi.fn()
      }

      const { updateBombTracking } =
        await import('@/app/lib/sync/db-operations')
      await updateBombTracking(
        mockSupabase as never,
        entries as never,
        'TEST',
        new Map()
      )

      expect(mockSupabase.from).not.toHaveBeenCalled()
    })

    it('should upsert bomb tracking for bomb entries', async () => {
      const entries = [
        {
          damageType: 'Bomb',
          userId: 'player1',
          completedOn: new Date().toISOString()
        }
      ]
      const mockUpsert = vi.fn().mockResolvedValue({ error: null })
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          upsert: mockUpsert
        })
      }
      const playerMappings = new Map([['player1', 'Player One']])

      const { updateBombTracking } =
        await import('@/app/lib/sync/db-operations')
      await updateBombTracking(
        mockSupabase as never,
        entries as never,
        'TEST',
        playerMappings
      )

      expect(mockSupabase.from).toHaveBeenCalledWith('bomb_tracking')
      expect(mockUpsert).toHaveBeenCalled()
    })

    it('should keep only latest bomb per player', async () => {
      const now = new Date()
      const entries = [
        {
          damageType: 'Bomb',
          userId: 'player1',
          completedOn: new Date(now.getTime() - 10000).toISOString()
        },
        {
          damageType: 'Bomb',
          userId: 'player1',
          completedOn: now.toISOString()
        }
      ]
      const mockUpsert = vi.fn().mockResolvedValue({ error: null })
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          upsert: mockUpsert
        })
      }

      const { updateBombTracking } =
        await import('@/app/lib/sync/db-operations')
      await updateBombTracking(
        mockSupabase as never,
        entries as never,
        'TEST',
        new Map()
      )

      const upsertedData = mockUpsert.mock.calls[0][0]
      expect(upsertedData.length).toBe(1)
    })
  })

  describe('upsertDataBatches', () => {
    it('should return zeros for empty data', async () => {
      const { upsertDataBatches } = await import('@/app/lib/sync/db-operations')
      const result = await upsertDataBatches({} as never, 'TEST', [])

      expect(result).toEqual({
        upserted: 0,
        inserted: 0,
        updated: 0,
        errors: 0
      })
    })

    it('should filter out invalid records', async () => {
      const data = [
        { Guild: 'TEST', Season: '81', userId: 'player1' },
        { Guild: null, Season: '81', userId: 'player2' },
        { Guild: 'TEST', Season: null, userId: 'player3' }
      ]
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          upsert: vi.fn().mockReturnValue({
            select: vi.fn().mockResolvedValue({
              data: [{ id: 1, timestamp: new Date().toISOString() }],
              error: null
            })
          })
        })
      }

      const { upsertDataBatches } = await import('@/app/lib/sync/db-operations')
      await upsertDataBatches(mockSupabase as never, 'TEST', data as never)

      const upsertCall = mockSupabase.from().upsert
      expect(upsertCall).toHaveBeenCalled()
    })
  })

  describe('updateSyncStatus', () => {
    it('should upsert sync status with completed status', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: null })
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          upsert: mockUpsert
        })
      }

      const { updateSyncStatus } = await import('@/app/lib/sync/db-operations')
      await updateSyncStatus(mockSupabase as never, 'TEST', 'completed', {
        recordsSynced: 100,
        memberCount: 30
      })

      expect(mockSupabase.from).toHaveBeenCalledWith('guild_sync_status')
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          guild_code: 'TEST',
          status: 'completed',
          full_sync_success: true,
          records_synced: 100,
          member_count: 30
        }),
        expect.any(Object)
      )
    })

    it('should upsert sync status with error status', async () => {
      const mockUpsert = vi.fn().mockResolvedValue({ error: null })
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          upsert: mockUpsert
        })
      }

      const { updateSyncStatus } = await import('@/app/lib/sync/db-operations')
      await updateSyncStatus(mockSupabase as never, 'TEST', 'error', {
        errorMessage: 'API timeout'
      })

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'error',
          full_sync_success: false,
          error_message: 'API timeout'
        }),
        expect.any(Object)
      )
    })
  })

  describe('updateGuildConfigAfterSync', () => {
    it('should update guild config with rankings', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: mockUpdate
        })
      }

      const { updateGuildConfigAfterSync } =
        await import('@/app/lib/sync/db-operations')
      await updateGuildConfigAfterSync(mockSupabase as never, 'TEST', {
        guildRaid: 150,
        guildWar: 200
      })

      expect(mockSupabase.from).toHaveBeenCalledWith('guild_config')
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          enabled: true,
          onboarding_completed: true,
          GR_Ranking: 150,
          GW_Ranking: 200
        })
      )
    })

    it('should not include null rankings', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: mockUpdate
        })
      }

      const { updateGuildConfigAfterSync } =
        await import('@/app/lib/sync/db-operations')
      await updateGuildConfigAfterSync(mockSupabase as never, 'TEST', {
        guildRaid: null,
        guildWar: null
      })

      const updateData = mockUpdate.mock.calls[0][0]
      expect(updateData.GR_Ranking).toBeUndefined()
      expect(updateData.GW_Ranking).toBeUndefined()
    })

    it('stamps last_roster_refresh_at for the roster onboarding just read', async () => {
      const mockUpdate = vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ error: null })
      })
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          update: mockUpdate
        })
      }
      const before = Date.now()

      const { updateGuildConfigAfterSync } =
        await import('@/app/lib/sync/db-operations')
      await updateGuildConfigAfterSync(mockSupabase as never, 'TEST', {
        guildRaid: null,
        guildWar: null
      })

      const stamp = Date.parse(
        mockUpdate.mock.calls[0][0].last_roster_refresh_at
      )
      expect(stamp).toBeGreaterThanOrEqual(before)
      expect(stamp).toBeLessThanOrEqual(Date.now())
    })
  })

  describe('loadExistingPlayerMappings', () => {
    it('should return empty Map when no mappings exist', async () => {
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: [], error: null })
            })
          })
        })
      }

      const { loadExistingPlayerMappings } =
        await import('@/app/lib/sync/db-operations')
      const result = await loadExistingPlayerMappings(
        mockSupabase as never,
        'TEST'
      )

      expect(result).toBeInstanceOf(Map)
      expect(result.size).toBe(0)
    })

    it('should build Map with player_id and lowercase variant', async () => {
      const mockData = [{ player_id: 'Player123', display_name: 'Test Player' }]
      const mockSupabase = {
        from: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockResolvedValue({ data: mockData, error: null })
            })
          })
        })
      }

      const { loadExistingPlayerMappings } =
        await import('@/app/lib/sync/db-operations')
      const result = await loadExistingPlayerMappings(
        mockSupabase as never,
        'TEST'
      )

      expect(result.get('Player123')).toBe('Test Player')
      expect(result.get('player123')).toBe('Test Player')
    })
  })

  describe('buildSyncSuccessResponse', () => {
    it('should build complete success response', async () => {
      const { buildSyncSuccessResponse } =
        await import('@/app/lib/sync/db-operations')

      const result = buildSyncSuccessResponse({
        guildCode: 'TEST',
        season: '81',
        upserted: 100,
        inserted: 80,
        updated: 20,
        errors: 0,
        entries: { length: 120 },
        validEntries: { length: 110 },
        processedData: { length: 105 },
        finalValidData: [
          { displayName: 'Player1', userId: 'user1' },
          { displayName: 'user2', userId: 'user2' }
        ],
        lokiMembers: { length: 30 },
        playerMappings: new Map([
          ['p1', 'Player1'],
          ['p2', 'Player2']
        ]),
        heroTrackingResult: {
          newUnits: 5,
          totalUnits: 50,
          newHeroes: 3,
          newMOWs: 2
        },
        mappingCoverage: {
          total: 100,
          mainBosses: 60,
          primeBosses: 40,
          mapped: 95,
          unmapped: 5,
          unknownBosses: 2,
          bossTypes: new Set(['Magnus', 'Hive Tyrant']),
          unmappedTypes: new Set(['Unknown'])
        },
        validationResult: { requiredCount: 10, missingCount: 1 },
        rankings: { guildRaid: 150, guildWar: 200 },
        executionTime: 5000
      })

      expect(result.success).toBe(true)
      expect(result.guild_code).toBe('TEST')
      expect(result.season).toBe('81')
      expect(result.status).toBe('completed')
      expect(result.recordsProcessed).toBe(100)
      expect(result.playersFound).toBe(30)
      expect(result.rankings.guildRaid).toBe(150)
      expect(result.rankings.guildWar).toBe(200)
      expect(result.stats.upsertedEntries).toBe(100)
      expect(result.stats.insertedEntries).toBe(80)
      expect(result.stats.updatedEntries).toBe(20)
      expect(result.stats.bossMappingCoverage.coveragePercent).toBe(95)
      expect(result.configPatched).toBe(true)
    })

    it('should identify unmapped players where displayName equals userId', async () => {
      const { buildSyncSuccessResponse } =
        await import('@/app/lib/sync/db-operations')

      const result = buildSyncSuccessResponse({
        guildCode: 'TEST',
        season: '81',
        upserted: 10,
        inserted: 10,
        updated: 0,
        errors: 0,
        entries: { length: 10 },
        validEntries: { length: 10 },
        processedData: { length: 10 },
        finalValidData: [
          { displayName: 'user123', userId: 'user123' },
          { displayName: 'Real Name', userId: 'user456' }
        ],
        lokiMembers: { length: 2 },
        playerMappings: new Map(),
        heroTrackingResult: {
          newUnits: 0,
          totalUnits: 0,
          newHeroes: 0,
          newMOWs: 0
        },
        mappingCoverage: {
          total: 10,
          mainBosses: 10,
          primeBosses: 0,
          mapped: 10,
          unmapped: 0,
          unknownBosses: 0,
          bossTypes: new Set(),
          unmappedTypes: new Set()
        },
        validationResult: { requiredCount: 0, missingCount: 0 },
        rankings: { guildRaid: null, guildWar: null },
        executionTime: 1000
      })

      expect(result.unmappedPlayers).toContain('user123')
      expect(result.unmappedPlayers.length).toBe(1)
    })
  })

  describe('BATCH_CONFIG', () => {
    it('should expose the real batch size from the production module', async () => {
      const { BATCH_CONFIG } = await import('@/app/lib/sync/db-operations')
      expect(BATCH_CONFIG.batchSize).toBe(500)
    })

    it('should expose the real batch delay from the production module', async () => {
      const { BATCH_CONFIG } = await import('@/app/lib/sync/db-operations')
      expect(BATCH_CONFIG.batchDelay).toBe(100)
    })

    it('drives the per-batch slice size in upsertDataBatches', async () => {
      const { BATCH_CONFIG, upsertDataBatches } =
        await import('@/app/lib/sync/db-operations')

      const total = BATCH_CONFIG.batchSize + 3
      const data = Array.from({ length: total }, (_, i) => ({
        Guild: 'TEST',
        Season: '81',
        userId: `player${i}`
      }))

      const upsertSpy = vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [], error: null })
      })
      const mockSupabase = {
        from: vi.fn().mockReturnValue({ upsert: upsertSpy })
      }

      await upsertDataBatches(mockSupabase as never, 'TEST', data as never)

      expect(upsertSpy).toHaveBeenCalledTimes(2)
      expect(upsertSpy.mock.calls[0]![0]).toHaveLength(BATCH_CONFIG.batchSize)
      expect(upsertSpy.mock.calls[1]![0]).toHaveLength(3)
    })
  })
})
