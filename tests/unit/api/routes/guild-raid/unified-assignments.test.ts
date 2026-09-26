import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

let mockDb: ReturnType<typeof vi.fn>
let mockServiceDb: ReturnType<typeof vi.fn>
let mockComputeRemainingBossSequence: ReturnType<typeof vi.fn>
let mockLoadSkippedPrimes: ReturnType<typeof vi.fn>
const skippedPrimesFixture = new Map([['L1', new Set([1])]])

const createSupabase = (role: string, isAppAdmin = false) => ({
  auth: {
    getUser: vi.fn().mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null
    })
  },
  from: vi.fn().mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({
      data: { guild_code: 'TEST', role, is_app_admin: isAppAdmin },
      error: null
    })
  })
})

// Fixed: the byte-identity test compares two route instances.
const MEMBER_SYNC_AT = new Date().toISOString()

const createServiceQuery = (table: string, displayName = 'Player One') => {
  const query = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    in: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    limit: vi.fn()
  }

  if (table === 'boss_target_tokens') {
    // Double .in() chain: the first chains, the second resolves.
    query.in
      .mockReturnValueOnce(query)
      .mockResolvedValueOnce({ data: [], error: null })
  } else if (table === 'player_mapping') {
    query.eq.mockImplementation(() => query)
    query.eq.mockReturnValueOnce(query).mockResolvedValueOnce({
      data: [
        {
          player_id: 'player-1',
          display_name: displayName,
          last_sync_tokens: 3,
          last_sync_at: MEMBER_SYNC_AT
        }
      ],
      error: null
    })
  } else if (table === 'EOT_GR_data') {
    query.limit.mockResolvedValue({ data: [], error: null })
  }

  return query
}

const createServiceClient = (displayName?: string) => ({
  from: vi.fn((table: string) => createServiceQuery(table, displayName))
})

const bossSequence = [
  {
    stageCode: 'L1',
    loopIndex: 0,
    difficulty: 'Legendary',
    estimatedTokensNeeded: 0,
    isCurrentStage: true,
    encounters: {
      main: { bossName: 'Hive Tyrant' },
      prime1: { bossName: 'Prime One' },
      prime2: { bossName: 'Prime Two' }
    }
  }
]

const stageProjections = {
  main: {
    bossName: 'Hive Tyrant',
    startingHp: 100,
    projectedRemainingHp: 100,
    tokensPlanned: 0
  },
  prime1: {
    bossName: 'Prime One',
    startingHp: 50,
    projectedRemainingHp: 50,
    tokensPlanned: 0
  },
  prime2: {
    bossName: 'Prime Two',
    startingHp: 50,
    projectedRemainingHp: 50,
    tokensPlanned: 0
  }
}

const targetCapsFixture = [
  {
    bossId: 'L1_main',
    encounter: 'main',
    capTokens: 5,
    modelTokensNeeded: 12,
    shortfallTokens: 7
  }
]

const stageAssignments = [
  {
    stageCode: 'L1',
    loopIndex: 0,
    assignments: [],
    solverResult: { coverage: {} },
    projections: stageProjections,
    targetCaps: targetCapsFixture
  },
  {
    stageCode: 'L2',
    loopIndex: 0,
    assignments: [],
    solverResult: { coverage: {} },
    projections: stageProjections
  }
]

const targetlessStageAssignments = [
  {
    stageCode: 'L1',
    loopIndex: 0,
    assignments: [],
    solverResult: { coverage: {} },
    projections: stageProjections
  },
  {
    stageCode: 'L2',
    loopIndex: 0,
    assignments: [],
    solverResult: { coverage: {} },
    projections: stageProjections
  }
]

async function loadRoute(
  role: string,
  isAppAdmin = false,
  opts: {
    stageAssignments?: typeof targetlessStageAssignments
    displayName?: string
    emptyTargetsResolver?: boolean
  } = {}
) {
  vi.resetModules()

  const stages = opts.stageAssignments ?? stageAssignments

  if (opts.emptyTargetsResolver) {
    vi.doMock('@/app/lib/boss-assignments/resolve-officer-targets', () => ({
      resolveOfficerTargetsFromRows: vi.fn(() => new Map())
    }))
  }

  mockDb = vi.fn().mockResolvedValue(createSupabase(role, isAppAdmin))
  mockServiceDb = vi.fn().mockReturnValue(createServiceClient(opts.displayName))

  vi.doMock('@/app/lib/db', () => ({
    db: mockDb,
    serviceDb: mockServiceDb
  }))

  vi.doMock('@/app/lib/boss-assignments/progression-config', () => ({
    getActiveProgressionConfig: vi.fn().mockResolvedValue({})
  }))

  mockComputeRemainingBossSequence = vi.fn(() => bossSequence)
  vi.doMock('@/app/lib/boss-assignments/season-sequence', () => ({
    computeRemainingBossSequence: mockComputeRemainingBossSequence
  }))

  mockLoadSkippedPrimes = vi.fn().mockResolvedValue(skippedPrimesFixture)
  vi.doMock('@/app/lib/boss-assignments/resolve-skipped-primes', () => ({
    loadSkippedPrimesForSeason: mockLoadSkippedPrimes
  }))

  vi.doMock('@/app/lib/boss-assignments/player-classifier', () => ({
    classifyPlayers: vi.fn(() => [{ playerId: 'player-1' }])
  }))

  vi.doMock('@/app/lib/boss-assignments/unified-orchestrator', () => ({
    orchestrateMultiStage: vi.fn(() => ({
      stageAssignments: stages,
      playerBudgets: { 'player-1': { allocated: 0 } },
      sequence: bossSequence,
      warnings: [],
      metrics: {}
    }))
  }))

  vi.doMock('@/app/lib/boss-assignments/season-planner/damage-model', () => ({
    buildDamageModel: vi.fn(() => ({})),
    // Must be exported or the route throws.
    computeMeanDamagePerBattle: vi.fn(() => 0),
    computeRosterEncounterDamagePerToken: vi.fn(() => null)
  }))

  vi.doMock('@/app/lib/boss-assignments/target-ids', () => ({
    normalizeBossTargetId: vi.fn((value: string) => value)
  }))

  vi.doMock('@/app/lib/data/boss-hp', () => ({
    getAllBossHp: vi.fn().mockResolvedValue({})
  }))

  vi.doMock('@/app/lib/loki/rotation-cache', () => ({
    ensureRotationSnapshot: vi.fn().mockResolvedValue({
      seasonNumber: 83,
      currentBosses: []
    })
  }))

  vi.doMock('@/app/lib/boss-assignments/season-planner/snapshot', () => ({
    buildPlanFromNowSnapshot: vi.fn().mockResolvedValue({
      stageCode: 'L1',
      loopIndex: 0,
      encounters: {
        main: { remainingHp: 100 },
        prime1: { remainingHp: 50 },
        prime2: { remainingHp: 50 }
      }
    })
  }))

  vi.doMock('@/app/lib/boss-assignments/season-planner/snapshot-logic', () => ({
    deriveStageCodeFromSetAndRarity: vi.fn(() => 'L1')
  }))

  vi.doMock('@/app/lib/loki/season-configs', () => ({
    getSeasonConfigById: vi.fn(() => ({ id: 'season-83', bosses: [] })),
    getSeasonConfigIdForOffset: vi.fn(() => ({ id: 'season-83' })),
    getSeasonPosition: vi.fn(() => ({ seasonNumber: 83 })),
    SEASON_DURATION_SECONDS: 14 * 24 * 60 * 60
  }))

  vi.doMock('@/app/lib/calculations/token-calculation', () => ({
    MAX_TOKENS: 3,
    TWELVE_HOURS_IN_SECONDS: 12 * 60 * 60
  }))

  vi.doMock('@/app/lib/boss-assignments/stage-timing', () => ({
    loadStageKillDurationMedians: vi.fn().mockResolvedValue([]),
    projectStageStartSeconds: vi.fn(() => [
      { startSeconds: 0, inboundDurationSource: null }
    ])
  }))

  vi.doMock('@/app/lib/boss-assignments/live-tokens', () => ({
    loadLiveGuildTokens: vi.fn().mockResolvedValue({
      source: 'api_unavailable',
      tokens: {},
      apiCalledAt: null
    })
  }))

  vi.doMock('@/app/lib/logging', () => ({
    logger: {
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    },
    createComponentLogger: vi.fn(() => ({
      error: vi.fn(),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn()
    })),
    generateRequestId: vi.fn(() => 'test-request-id'),
    logError: vi.fn()
  }))

  return import('@/app/api/guild-raid/unified-assignments/route')
}

const createRequest = () =>
  new NextRequest(
    'http://localhost/api/guild-raid/unified-assignments?debug=1',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'current' })
    }
  )

describe('/api/guild-raid/unified-assignments', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('hides debug payload from member role', async () => {
    const { POST } = await loadRoute('member')

    const response = await POST(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.debug).toBeUndefined()
  })

  it.each(['officer', 'leader', 'admin'])(
    'shows debug payload to %s role',
    async (role) => {
      const { POST } = await loadRoute(role)

      const response = await POST(createRequest())
      const body = await response.json()

      expect(response.status).toBe(200)
      expect(body.debug).toBeDefined()
      expect(body.debug.snapshot.stageCode).toBe('L1')
    }
  )

  it('shows debug payload to app admins regardless of guild role', async () => {
    const { POST } = await loadRoute('member', true)

    const response = await POST(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.debug).toBeDefined()
  })

  it('threads the WI-4500 skip union + roster divisor into the sequence computation', async () => {
    const { POST } = await loadRoute('officer')

    const response = await POST(createRequest())
    expect(response.status).toBe(200)

    expect(mockLoadSkippedPrimes).toHaveBeenCalledWith(
      expect.anything(),
      'TEST',
      '83',
      { targetTokenRows: [] }
    )

    const seqArgs = mockComputeRemainingBossSequence.mock.calls[0]?.[0]
    expect(seqArgs.skippedPrimes).toBe(skippedPrimesFixture)
    expect(typeof seqArgs.encounterDamagePerToken).toBe('function')
  })

  it('threads the WI-4530 officer targets into the sequence computation', async () => {
    const { POST } = await loadRoute('officer')

    const response = await POST(createRequest())
    expect(response.status).toBe(200)

    const seqArgs = mockComputeRemainingBossSequence.mock.calls[0]?.[0]
    expect(seqArgs.officerTargets).toBeInstanceOf(Map)
    expect(seqArgs.officerTargets.size).toBe(0)
  })

  it('passes orchestrator targetCaps through and omits the key when absent', async () => {
    const { POST } = await loadRoute('officer')

    const response = await POST(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.stage_assignments[0].targetCaps).toEqual(targetCapsFixture)
    expect('targetCaps' in body.stage_assignments[1]).toBe(false)
  })

  it('serializes reserved display names without prototype pollution', async () => {
    const targetId = 'L4_main'
    expect(Object.hasOwn(Object.prototype, targetId)).toBe(false)

    const reservedAssignments = [
      {
        ...targetlessStageAssignments[0]!,
        assignments: [
          {
            playerId: 'player-1',
            bossId: targetId,
            tokens: 1,
            score: 1
          }
        ]
      }
    ] as unknown as typeof targetlessStageAssignments
    const { POST } = await loadRoute('officer', false, {
      displayName: '__proto__',
      stageAssignments: reservedAssignments
    })

    const response = await POST(createRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(Object.hasOwn(body.allocations, '__proto__')).toBe(true)
    expect(body.allocations['__proto__']).toEqual({ [targetId]: 1 })
    expect(Object.hasOwn(Object.prototype, targetId)).toBe(false)
  })

  it('serializes a target-less guild response byte-identically (empty vs absent targets signal)', async () => {
    const realResolverRoute = await loadRoute('member', false, {
      stageAssignments: targetlessStageAssignments
    })
    const realResponse = await realResolverRoute.POST(createRequest())
    const realBody = await realResponse.json()

    const mockedResolverRoute = await loadRoute('member', false, {
      stageAssignments: targetlessStageAssignments,
      emptyTargetsResolver: true
    })
    const mockedResponse = await mockedResolverRoute.POST(createRequest())
    const mockedBody = await mockedResponse.json()

    expect(realResponse.status).toBe(200)
    expect(mockedResponse.status).toBe(200)
    expect(mockedBody).toStrictEqual(realBody)

    const serialized = JSON.stringify(realBody)
    expect(serialized).not.toContain('targetCaps')
    expect(serialized).not.toContain('budgetTokensNeeded')
    expect(serialized).not.toContain('budgetVarianceTokens')
    expect(serialized).not.toContain('officer_target')
  })
})
