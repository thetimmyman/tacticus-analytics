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
  recentSyncs = [],
  guildConfig = null
}: {
  players: Array<Record<string, unknown>>
  recentSyncs?: Array<Record<string, unknown>>
  guildConfig?: Record<string, unknown> | null
}) {
  return {
    from: vi.fn((table: string) => {
      if (table === 'player_mapping') {
        return thenableQuery({ data: players, error: null })
      }
      if (table === 'player_roster') {
        return thenableQuery({ data: recentSyncs, error: null })
      }
      if (table === 'guild_config') {
        return thenableQuery({ data: guildConfig, error: null })
      }
      return thenableQuery({ data: null, error: null })
    })
  }
}

describe('POST /api/guild-teams/backfill', () => {
  let POST: () => Promise<Response>
  let mockServiceDb: ReturnType<typeof vi.fn>
  let mockGetPlayerApiKey: ReturnType<typeof vi.fn>
  let mockResolveStoredSecret: ReturnType<typeof vi.fn>
  let mockTacticusGetPlayer: ReturnType<typeof vi.fn>
  let mockResolveMachinesOfWar: ReturnType<typeof vi.fn>
  let mockCreateLokiClient: ReturnType<typeof vi.fn>
  let mockLokiGetPlayerInfo: ReturnType<typeof vi.fn>
  let mockPersistRosterSnapshot: ReturnType<typeof vi.fn>
  let mockCheckActionRateLimit: ReturnType<typeof vi.fn>

  const loadRoute = async () => {
    const mod = await import('@/app/api/guild-teams/backfill/route')
    POST = mod.POST
  }

  beforeEach(() => {
    vi.resetModules()
    vi.stubEnv('LOKI_SCRAPER_CLIENT_SECRET', 'server-loki-secret')

    mockServiceDb = vi.fn()
    mockGetPlayerApiKey = vi.fn()
    mockResolveStoredSecret = vi.fn().mockResolvedValue(null)
    mockTacticusGetPlayer = vi.fn()
    mockResolveMachinesOfWar = vi.fn().mockReturnValue([])
    mockLokiGetPlayerInfo = vi.fn()
    mockCreateLokiClient = vi.fn(() => ({
      getPlayerInfo: mockLokiGetPlayerInfo
    }))
    mockCheckActionRateLimit = vi.fn().mockResolvedValue({ allowed: true })
    mockPersistRosterSnapshot = vi
      .fn()
      .mockResolvedValue({ upserted: 1, playerPowerUpdated: true })

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
    vi.doMock('@tacticus/app-core/encryption', () => ({
      resolveStoredSecret: mockResolveStoredSecret
    }))
    vi.doMock('@/app/lib/api/tacticus-client', () => ({
      tacticusAPI: { getPlayer: mockTacticusGetPlayer },
      resolveMachinesOfWar: mockResolveMachinesOfWar
    }))
    vi.doMock('@/app/lib/loki/client', () => ({
      createLokiClient: mockCreateLokiClient
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
    expect(mockCreateLokiClient).not.toHaveBeenCalled()
  })

  it('forwards Tacticus profile power to roster snapshot persistence', async () => {
    const supabase = buildSupabase({
      players: [
        {
          id: 101,
          user_id: 'user-101',
          player_id: 'loki-player-101',
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
      { playerPower: 123456 }
    )
  })

  it('forwards Loki profile totalPower to roster snapshot persistence', async () => {
    const supabase = buildSupabase({
      players: [
        {
          id: 202,
          user_id: null,
          player_id: 'loki-player-202',
          display_name: 'Loki Player',
          tacticus_api_key_encrypted: null,
          api_key_is_valid: false
        }
      ],
      guildConfig: {
        user_id: 'loki-user',
        session_id: 'session',
        client_secret: 'encrypted-secret'
      }
    })
    mockServiceDb.mockReturnValue(supabase)
    mockResolveStoredSecret.mockResolvedValue('secret')
    mockLokiGetPlayerInfo.mockResolvedValue({
      ok: true,
      data: {
        heroInfo: {
          player: { totalPower: 654321 },
          units: {
            units: {
              hero_b: {
                progressionIndex: 2,
                rank: 3,
                xpLevel: 4,
                active: 5,
                passive: 6
              }
            }
          }
        }
      }
    })

    await loadRoute()
    const response = await POST()

    expect(response.status).toBe(200)
    expect(mockPersistRosterSnapshot).toHaveBeenCalledWith(
      null,
      [
        {
          id: 'hero_b',
          progressionIndex: 2,
          rank: 3,
          xpLevel: 4,
          abilities: [
            { id: 'active', level: 5 },
            { id: 'passive', level: 6 }
          ]
        }
      ],
      [],
      supabase,
      202,
      { playerPower: 654321 }
    )
    expect(mockCreateLokiClient).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ retryAttempts: 0 })
    )
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
    expect(mockLokiGetPlayerInfo).not.toHaveBeenCalled()
  })
})
