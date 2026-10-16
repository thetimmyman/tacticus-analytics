import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type QueryResponse = {
  data: Array<Record<string, unknown>> | Record<string, unknown> | null
  error: { message: string } | null
}

function thenableQuery(response: QueryResponse) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    in: vi.fn(() => query),
    gte: vi.fn(() => query),
    update: vi.fn(() => query),
    single: vi.fn(() => Promise.resolve(response)),
    maybeSingle: vi.fn(() => Promise.resolve(response)),
    then: (
      resolve: (value: QueryResponse) => unknown,
      reject?: (reason: unknown) => unknown
    ) => Promise.resolve(response).then(resolve, reject)
  }
  return query
}

function buildSupabase({
  players,
  recentSyncs = []
}: {
  players: Array<Record<string, unknown>>
  recentSyncs?: Array<Record<string, unknown>>
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'player_mapping') {
        return thenableQuery({ data: players, error: null })
      }
      if (table === 'player_roster') {
        return thenableQuery({ data: recentSyncs, error: null })
      }
      return thenableQuery({ data: null, error: null })
    })
  }
}

describe('POST /api/guild-teams/backfill', () => {
  let POST: () => Promise<Response>
  let mockServiceDb: ReturnType<typeof vi.fn>
  let mockGetPlayerApiKey: ReturnType<typeof vi.fn>
  let mockTacticusGetPlayer: ReturnType<typeof vi.fn>
  let mockResolveMachinesOfWar: ReturnType<typeof vi.fn>
  let mockSelectRosterRefreshCandidates: ReturnType<typeof vi.fn>
  let mockTryBeginPlayerRosterRefresh: ReturnType<typeof vi.fn>
  let mockPersistRosterSnapshot: ReturnType<typeof vi.fn>
  let mockCheckActionRateLimit: ReturnType<typeof vi.fn>

  const loadRoute = async () => {
    const mod = await import('@/app/api/guild-teams/backfill/route')
    POST = mod.POST
  }

  beforeEach(() => {
    vi.resetModules()

    mockServiceDb = vi.fn()
    mockGetPlayerApiKey = vi.fn()
    mockTacticusGetPlayer = vi.fn()
    mockResolveMachinesOfWar = vi.fn().mockReturnValue([])
    mockSelectRosterRefreshCandidates = vi.fn(async (rows) => rows)
    mockTryBeginPlayerRosterRefresh = vi.fn(
      async (_user: string | null, id: number) => ({
        playerMappingId: id,
        attemptId: '00000000-0000-4000-8000-000000000001',
        observedAt: '2026-01-01T00:00:00.000Z'
      })
    )
    mockCheckActionRateLimit = vi.fn().mockResolvedValue({ allowed: true })
    mockPersistRosterSnapshot = vi.fn().mockResolvedValue({
      status: 'applied',
      upserted: 1,
      playerPowerUpdated: true,
      complete: true,
      unchanged: false
    })

    vi.doMock('@/app/lib/db', () => ({
      serviceDb: mockServiceDb
    }))
    vi.doMock('@/app/lib/auth', () => ({
      requireRoleForApi: vi.fn().mockResolvedValue({
        profile: { guild_code: 'EOT', role: 'officer' }
      })
    }))
    vi.doMock('@tacticus/app-core/api-key-helper', () => ({
      getPlayerApiKey: mockGetPlayerApiKey
    }))
    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: { getPlayer: mockTacticusGetPlayer },
      resolveMachinesOfWar: mockResolveMachinesOfWar
    }))
    vi.doMock('@/app/lib/middleware/errorHandler', () => ({
      withErrorHandler: (handler: () => Promise<Response>) => handler
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      })
    }))
    vi.doMock('@/app/lib/player/roster-sync', () => ({
      persistRosterSnapshot: mockPersistRosterSnapshot
    }))
    vi.doMock('@/app/lib/player/roster-snapshot-store', () => ({
      selectRosterRefreshCandidates: mockSelectRosterRefreshCandidates,
      tryBeginPlayerRosterRefresh: mockTryBeginPlayerRosterRefresh
    }))
    vi.doMock('@/app/lib/middleware/rate-limit', () => ({
      checkActionRateLimit: mockCheckActionRateLimit
    }))
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('refuses hosted roster backfill in desktop mode before reading keys', async () => {
    vi.stubEnv('NEXT_PUBLIC_RUNTIME_PROFILE', 'desktop')
    await loadRoute()
    const response = await POST()
    expect(response.status).toBe(409)
    expect(mockServiceDb).not.toHaveBeenCalled()
    expect(mockGetPlayerApiKey).not.toHaveBeenCalled()
    expect(mockTacticusGetPlayer).not.toHaveBeenCalled()
  })

  it('forwards Tacticus profile power to roster snapshot persistence', async () => {
    const supabase = buildSupabase({
      players: [
        {
          id: 101,
          user_id: 'user-101',
          player_id: 'player-101',
          display_name: 'Api Key Player',
          tacticus_api_key_encrypted: 'encrypted-key',
          api_key_is_valid: true
        }
      ]
    })
    mockServiceDb.mockReturnValue(supabase)
    mockGetPlayerApiKey.mockResolvedValue('api-key')
    const units = [{ id: 'hero_a', progressionIndex: 1, rank: 1, xpLevel: 1 }]
    const mows = [{ id: 'mow_a', progressionIndex: 1, rank: 1, xpLevel: 1 }]
    mockTacticusGetPlayer.mockResolvedValue({
      details: { powerLevel: 123456 },
      units,
      machinesOfWar: mows
    })
    mockResolveMachinesOfWar.mockReturnValue(mows)

    await loadRoute()
    const response = await POST()

    expect(response.status).toBe(200)
    expect(mockPersistRosterSnapshot).toHaveBeenCalledWith(
      'user-101',
      units,
      mows,
      supabase,
      101,
      {
        playerPower: 123456,
        observation: expect.objectContaining({ playerMappingId: 101 })
      }
    )
  })

  it('skips members without a valid key and claims no refresh slot for them', async () => {
    const supabase = buildSupabase({
      players: [
        {
          id: 202,
          user_id: null,
          player_id: 'player-202',
          display_name: 'Keyless Player',
          tacticus_api_key_encrypted: null,
          api_key_is_valid: false
        },
        {
          id: 303,
          user_id: 'user-303',
          player_id: 'player-303',
          display_name: 'Revoked Key Player',
          tacticus_api_key_encrypted: 'encrypted-key',
          api_key_is_valid: false
        }
      ]
    })
    mockServiceDb.mockReturnValue(supabase)

    await loadRoute()
    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ processed: 0, failed: 0, skipped: 2 })
    expect(mockSelectRosterRefreshCandidates).toHaveBeenCalledWith(
      [],
      expect.any(Object),
      supabase
    )
    expect(mockTryBeginPlayerRosterRefresh).not.toHaveBeenCalled()
    expect(mockGetPlayerApiKey).not.toHaveBeenCalled()
    expect(mockPersistRosterSnapshot).not.toHaveBeenCalled()
  })

  it('returns without provider calls when the guild backfill is rate limited', async () => {
    mockCheckActionRateLimit.mockResolvedValue({
      allowed: false,
      remainingTime: 120
    })
    mockServiceDb.mockReturnValue(
      buildSupabase({
        players: []
      })
    )

    await loadRoute()
    const response = await POST()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({
      success: true,
      processed: 0,
      rateLimited: true,
      retryAfter: 120
    })
    expect(mockServiceDb).not.toHaveBeenCalled()
    expect(mockTacticusGetPlayer).not.toHaveBeenCalled()
  })
})
