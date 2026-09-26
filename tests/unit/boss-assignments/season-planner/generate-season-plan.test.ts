import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const mocks = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  getAllBossHp: vi.fn(),
  ensureRotationSnapshot: vi.fn(),
  buildPlanFromNowSnapshot: vi.fn(),
  getActiveProgressionConfig: vi.fn(),
  computeRemainingBossSequence: vi.fn(),
  planSeason: vi.fn(),
  loadPlanTargetSignalsForSeason: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: mocks.serviceDb
}))

vi.mock('@/app/lib/data/boss-hp', () => ({
  getAllBossHp: mocks.getAllBossHp
}))

vi.mock('@/app/lib/loki/rotation-cache', () => ({
  ensureRotationSnapshot: mocks.ensureRotationSnapshot
}))

vi.mock('@/app/lib/boss-assignments/season-planner/snapshot', () => ({
  buildPlanFromNowSnapshot: mocks.buildPlanFromNowSnapshot
}))

vi.mock('@/app/lib/boss-assignments/progression-config', () => ({
  getActiveProgressionConfig: mocks.getActiveProgressionConfig
}))

vi.mock('@/app/lib/boss-assignments/season-sequence', () => ({
  computeRemainingBossSequence: mocks.computeRemainingBossSequence
}))

// Skips and officer targets load through one combined seam (one boss_target_tokens read).
vi.mock('@/app/lib/boss-assignments/resolve-officer-targets', () => ({
  loadPlanTargetSignalsForSeason: mocks.loadPlanTargetSignalsForSeason
}))

vi.mock(
  '@/app/lib/boss-assignments/season-planner/planner-engine',
  async () => {
    const actual = await vi.importActual<
      typeof import('@/app/lib/boss-assignments/season-planner/planner-engine')
    >('@/app/lib/boss-assignments/season-planner/planner-engine')
    return {
      ...actual,
      planSeason: mocks.planSeason
    }
  }
)

const makeQuery = <T>(data: T) => ({
  select: vi.fn().mockReturnThis(),
  eq: vi.fn().mockReturnThis(),
  in: vi.fn().mockReturnThis(),
  order: vi.fn().mockResolvedValue({ data, error: null })
})

const baseSnapshot = () => ({
  snapshotAt: '2026-07-08T12:00:00.000Z',
  guildCode: 'G1',
  season: '140',
  seasonId: 'live-config',
  stageCode: 'L1',
  loopIndex: 0,
  advancedStage: false,
  encounters: {
    main: {
      encounterId: 0,
      targetUid: 'main',
      targetLabel: 'L1 Main',
      stageCode: 'L1',
      loopIndex: 0,
      bossName: 'Avatar',
      maxHp: 1000,
      remainingHp: 1000,
      seededFromMax: false,
      confidence: 'high'
    },
    prime1: {
      encounterId: 1,
      targetUid: 'p1',
      targetLabel: 'L1 Prime 1',
      stageCode: 'L1',
      loopIndex: 0,
      bossName: 'Avatar_Prime1',
      maxHp: 0,
      remainingHp: 0,
      seededFromMax: true,
      confidence: 'low'
    },
    prime2: {
      encounterId: 2,
      targetUid: 'p2',
      targetLabel: 'L1 Prime 2',
      stageCode: 'L1',
      loopIndex: 0,
      bossName: 'Avatar_Prime2',
      maxHp: 0,
      remainingHp: 0,
      seededFromMax: true,
      confidence: 'low'
    }
  },
  warnings: []
})

describe('generateSeasonPlanForGuild', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAllBossHp.mockResolvedValue({
      legendary: { L1: 1000 },
      mythic: {},
      primes: {},
      byBossName: { Avatar_L1: 1000 }
    })
    mocks.ensureRotationSnapshot.mockResolvedValue({
      seasonId: 'live-config',
      currentBosses: [
        {
          encounter_id: 0,
          set: 0,
          rarity: 'Legendary',
          canonical: 'Avatar',
          boss_name: 'Avatar'
        }
      ]
    })
    mocks.buildPlanFromNowSnapshot.mockResolvedValue(baseSnapshot())
    mocks.loadPlanTargetSignalsForSeason.mockResolvedValue({
      skippedPrimes: new Map(),
      officerTargets: new Map()
    })
    mocks.getActiveProgressionConfig.mockResolvedValue({})
    mocks.computeRemainingBossSequence.mockReturnValue([
      {
        stageCode: 'L1',
        loopIndex: 0,
        encounters: {
          main: { bossName: 'Avatar', maxHp: 1000, remainingHp: 1000 },
          prime1: null,
          prime2: null
        }
      }
    ])
    mocks.planSeason.mockReturnValue({
      sessions: [],
      finalRaidState: {
        stageCode: 'L1',
        loopIndex: 0,
        encounters: {}
      },
      metrics: {
        tokensSpent: 0,
        overkillDamage: 0,
        bossesDefeated: 0,
        loopAdvances: 0,
        wastedTokens: 0,
        wastedTicks: 0
      },
      warnings: []
    })
  })

  it('passes current-season battle count into planner players as seasonSpent', async () => {
    const memberRows = [
      {
        player_id: 'p1',
        display_name: 'Player One'
      }
    ]
    const battleRows = [
      ...Array.from({ length: 28 }, (_, index) => ({
        userId: 'p1',
        displayName: 'Player One',
        damageType: 'Battle',
        startedOn: `2026-07-08T${String(index % 12).padStart(2, '0')}:00:00.000Z`,
        damageDealt: 100,
        Name: 'Avatar',
        encounterId: 0,
        rarity: 'Legendary',
        set: 0,
        Season: '104'
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        userId: 'p1',
        displayName: 'Player One',
        damageType: 'Battle',
        startedOn: `2026-07-08T1${index + 3}:00:00.000Z`,
        damageDealt: 100,
        Name: 'Avatar',
        encounterId: 0,
        rarity: 'Legendary',
        set: 0,
        Season: '104'
      }))
    ]
    const playerMappingQuery = makeQuery(memberRows)

    const service = {
      from: vi.fn((table: string) => {
        if (table === 'player_mapping') return playerMappingQuery
        if (table === 'EOT_GR_data') return makeQuery(battleRows)
        throw new Error(`Unexpected table ${table}`)
      })
    }
    mocks.serviceDb.mockReturnValue(service)

    const { generateSeasonPlanForGuild } =
      await import('@/app/lib/boss-assignments/season-planner/generate-season-plan')

    await generateSeasonPlanForGuild({
      guildCode: 'G1',
      season: '104',
      snapshotAt: '2026-07-08T12:00:00.000Z',
      lookbackDays: 30,
      sessionsPerDay: 1,
      timeZone: 'UTC'
    })

    expect(mocks.planSeason).toHaveBeenCalled()
    const planArgs = mocks.planSeason.mock.calls[0]?.[0]
    expect(planArgs?.players[0]).toMatchObject({
      playerId: 'p1',
      seasonSpent: 28
    })
    expect(playerMappingQuery.select).toHaveBeenCalledWith(
      'player_id, display_name'
    )
  })

  it('starts future-season generation at the target season start', async () => {
    const memberRows = [
      {
        player_id: 'p1',
        display_name: 'Player One'
      }
    ]
    const service = {
      from: vi.fn((table: string) => {
        if (table === 'player_mapping') return makeQuery(memberRows)
        if (table === 'EOT_GR_data') return makeQuery([])
        throw new Error(`Unexpected table ${table}`)
      })
    }
    mocks.serviceDb.mockReturnValue(service)

    const { generateSeasonPlanForGuild } =
      await import('@/app/lib/boss-assignments/season-planner/generate-season-plan')

    const result = await generateSeasonPlanForGuild({
      guildCode: 'G1',
      season: '140',
      snapshotAt: '1970-01-01T00:00:00.000Z',
      lookbackDays: 30,
      sessionsPerDay: 1,
      timeZone: 'UTC'
    })

    expect(result.snapshot_at).toBe(result.season_start_at)
    expect(mocks.buildPlanFromNowSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshotAt: result.season_start_at,
        preferAsOfStatus: true
      })
    )
    const planArgs = mocks.planSeason.mock.calls[0]?.[0]
    expect(planArgs?.options.snapshotAt).toBe(
      new Date(result.season_start_at).getTime()
    )
    expect(planArgs?.players[0]).toMatchObject({
      playerId: 'p1',
      tokenState: {
        available: 2
      },
      seasonSpent: 0
    })
  })

  // A skipped current-stage prime is zeroed so planSeason cannot book tokens against it.
  it('threads skipped primes and zeroes them in the sim initial raid state', async () => {
    const snapshot = baseSnapshot()
    snapshot.encounters.prime1.maxHp = 500
    snapshot.encounters.prime1.remainingHp = 500
    snapshot.encounters.prime2.maxHp = 400
    snapshot.encounters.prime2.remainingHp = 400
    mocks.buildPlanFromNowSnapshot.mockResolvedValue(snapshot)
    const skippedPrimes = new Map([['L1', new Set([1])]])
    mocks.loadPlanTargetSignalsForSeason.mockResolvedValue({
      skippedPrimes,
      officerTargets: new Map()
    })

    const service = {
      from: vi.fn((table: string) => {
        if (table === 'player_mapping')
          return makeQuery([{ player_id: 'p1', display_name: 'Player One' }])
        if (table === 'EOT_GR_data') return makeQuery([])
        throw new Error(`Unexpected table ${table}`)
      })
    }
    mocks.serviceDb.mockReturnValue(service)

    const { generateSeasonPlanForGuild } =
      await import('@/app/lib/boss-assignments/season-planner/generate-season-plan')

    await generateSeasonPlanForGuild({
      guildCode: 'G1',
      season: '104',
      snapshotAt: '2026-07-08T12:00:00.000Z',
      lookbackDays: 30,
      sessionsPerDay: 1,
      timeZone: 'UTC'
    })

    expect(mocks.loadPlanTargetSignalsForSeason).toHaveBeenCalledWith(
      service,
      'G1',
      '104'
    )
    const seqArgs = mocks.computeRemainingBossSequence.mock.calls[0]?.[0]
    expect(seqArgs?.skippedPrimes).toBe(skippedPrimes)
    expect(typeof seqArgs?.encounterDamagePerToken).toBe('function')

    const planArgs = mocks.planSeason.mock.calls[0]?.[0]
    expect(planArgs?.initialRaidState.encounters[1]).toMatchObject({
      maxHp: 0,
      remainingHp: 0
    })
    expect(planArgs?.initialRaidState.encounters[2]).toMatchObject({
      maxHp: 400,
      remainingHp: 400
    })
  })

  // Officer targets feed only the sequence budget; sim inputs stay HP-driven.
  it('threads officer targets into the sequence computation only', async () => {
    const officerTargets = new Map([['L1', new Map([[0, 20]])]])
    mocks.loadPlanTargetSignalsForSeason.mockResolvedValue({
      skippedPrimes: new Map(),
      officerTargets
    })

    const service = {
      from: vi.fn((table: string) => {
        if (table === 'player_mapping')
          return makeQuery([{ player_id: 'p1', display_name: 'Player One' }])
        if (table === 'EOT_GR_data') return makeQuery([])
        throw new Error(`Unexpected table ${table}`)
      })
    }
    mocks.serviceDb.mockReturnValue(service)

    const { generateSeasonPlanForGuild } =
      await import('@/app/lib/boss-assignments/season-planner/generate-season-plan')

    await generateSeasonPlanForGuild({
      guildCode: 'G1',
      season: '104',
      snapshotAt: '2026-07-08T12:00:00.000Z',
      lookbackDays: 30,
      sessionsPerDay: 1,
      timeZone: 'UTC'
    })

    const seqArgs = mocks.computeRemainingBossSequence.mock.calls[0]?.[0]
    expect(seqArgs?.officerTargets).toBe(officerTargets)

    const planArgs = mocks.planSeason.mock.calls[0]?.[0]
    expect(planArgs?.stageTemplates[0]).toMatchObject({
      stageCode: 'L1',
      encounters: { 0: { bossName: 'Avatar', maxHp: 1000 } }
    })
    expect(JSON.stringify(planArgs?.options)).not.toContain('target')
  })
})
