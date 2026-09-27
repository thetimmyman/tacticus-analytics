import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock
} from 'vitest'

// vitest 5 types a bare vi.fn() as function-or-constructor; these mocks are called.
type AnyMock = Mock<(...args: any[]) => any>

type Handler = (
  payload: Record<string, unknown>,
  context: {
    jobId: number
    workerId: string
    attempts: number
    softDeadlineAt?: number
  }
) => Promise<Record<string, unknown> | void>

type QueryResponse = {
  data: Record<string, unknown>[] | Record<string, unknown> | null
  error: { message: string } | null
}

function thenableQuery(response: QueryResponse) {
  const query = {
    select: vi.fn(() => query),
    eq: vi.fn(() => query),
    not: vi.fn(() => query),
    in: vi.fn(() => query),
    gte: vi.fn(() => query),
    update: vi.fn(() => query),
    then: (
      resolve: (value: QueryResponse) => unknown,
      reject?: (reason: unknown) => void
    ) => Promise.resolve(response).then(resolve, reject)
  }
  return query
}

function memberRows(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    user_id: `user-${index + 1}`,
    player_id: `player-${index + 1}`,
    display_name: `Player ${index + 1}`,
    api_key_is_valid: false,
    tacticus_api_key_encrypted: null
  }))
}

describe('roster-loki-backfill handler', () => {
  let currentTime: number
  let getPlayerInfoMock: AnyMock
  let persistRosterSnapshotMock: AnyMock
  let providerFetchMock: AnyMock
  let physicalCallsPerPlayer: number
  let handler: Handler
  let members: ReturnType<typeof memberRows>

  beforeEach(async () => {
    vi.resetModules()
    vi.stubEnv('LOKI_SCRAPER_CLIENT_SECRET', 'server-loki-secret')
    currentTime = 1_000
    vi.spyOn(Date, 'now').mockImplementation(() => currentTime)
    vi.spyOn(Math, 'random').mockReturnValue(0)
    members = memberRows(20)
    physicalCallsPerPlayer = 1
    providerFetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', providerFetchMock)

    getPlayerInfoMock = vi.fn(async () => {
      currentTime = 3_000
      return {
        ok: true,
        data: {
          heroInfo: {
            player: {
              powerLevel: 98765
            },
            units: {
              units: {
                hero_a: {
                  progressionIndex: 1,
                  rank: 1,
                  xpLevel: 1,
                  active: 1,
                  passive: 1,
                  items: {}
                }
              }
            }
          }
        }
      }
    })
    persistRosterSnapshotMock = vi.fn().mockResolvedValue({ upserted: 1 })

    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'guild_config') {
          return thenableQuery({
            data: [
              {
                guild_code: 'EOT',
                user_id: 'loki-user',
                session_id: 'session',
                client_secret: 'encrypted',
                enabled: true,
                auto_sync_enabled: true,
                consecutive_sync_failures: 0
              }
            ],
            error: null
          })
        }
        if (table === 'player_mapping') {
          return thenableQuery({
            data: members,
            error: null
          })
        }
        if (table === 'player_roster') {
          return thenableQuery({
            data: [],
            error: null
          })
        }
        return thenableQuery({ data: null, error: null })
      })
    }

    vi.doMock('@/app/lib/db', () => ({
      serviceDb: () => supabase
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn()
      })
    }))
    vi.doMock('@/app/lib/errors/AppError', () => ({
      rethrowIfAppError: vi.fn()
    }))
    vi.doMock('@/app/lib/monitoring/sentry', () => ({
      captureSentryException: vi.fn()
    }))
    vi.doMock('@/app/lib/loki/client', () => ({
      createLokiClient: (
        _credentials: unknown,
        options: { fetchImpl?: typeof fetch }
      ) => ({
        getPlayerInfo: async (playerId: string) => {
          for (let call = 0; call < physicalCallsPerPlayer; call += 1) {
            await options.fetchImpl?.('https://provider.invalid/player')
          }
          return getPlayerInfoMock(playerId)
        }
      })
    }))
    vi.doMock('@tacticus/app-core/encryption', () => ({
      resolveStoredSecret: vi.fn(async () => 'secret')
    }))
    vi.doMock('@/app/lib/loki/batch-session-refresh', () => ({
      refreshSharedLokiSession: vi.fn(
        async (options: { fetchImpl?: typeof fetch }) => {
          await options.fetchImpl?.('https://provider.invalid/connect')
          return { success: true, sessionId: 'shared-session', durationMs: 1 }
        }
      )
    }))
    vi.doMock('@/app/lib/player/roster-sync', () => ({
      persistRosterSnapshot: persistRosterSnapshotMock
    }))
    vi.doMock('@/app/lib/jobs/dispatcher', () => ({
      registerJobHandler: vi.fn()
    }))

    const module = await import('@/app/lib/jobs/roster-loki-backfill')
    handler = module.__internal.rosterLokiBackfillHandler as Handler
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('stops before starting the second member chunk when ctx.softDeadlineAt is crossed', async () => {
    const result = (await handler(
      {},
      {
        jobId: 1710,
        workerId: 'vitest',
        attempts: 1,
        softDeadlineAt: 2_000
      }
    )) as Record<string, unknown>

    expect(getPlayerInfoMock).toHaveBeenCalledTimes(2)
    expect(persistRosterSnapshotMock).toHaveBeenCalledTimes(2)
    expect(persistRosterSnapshotMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Array),
      [],
      expect.anything(),
      expect.any(Number),
      { playerPower: 98765 }
    )
    expect(result.processed).toBe(2)
    expect(result.skipped).toBe(18)
    expect(result.partialDueToTimeout).toBe(true)
  })

  it('caps one run at 400 physical provider requests including CONNECT', async () => {
    members = memberRows(410)

    const result = (await handler(
      {},
      {
        jobId: 1711,
        workerId: 'vitest',
        attempts: 1
      }
    )) as Record<string, unknown>

    expect(providerFetchMock).toHaveBeenCalledTimes(400)
    expect(getPlayerInfoMock).toHaveBeenCalledTimes(399)
    expect(persistRosterSnapshotMock).toHaveBeenCalledTimes(399)
    expect(result.processed).toBe(399)
    expect(result.requestsStarted).toBe(400)
    expect(result.skipped).toBe(11)
    expect(result.partialDueToBudget).toBe(true)
    expect(result.partialDueToTimeout).toBe(false)
  })

  it('does not exceed the physical ceiling when session refresh and replay add calls', async () => {
    members = memberRows(410)
    physicalCallsPerPlayer = 3

    const result = (await handler(
      {},
      {
        jobId: 1712,
        workerId: 'vitest',
        attempts: 1
      }
    )) as Record<string, unknown>

    expect(providerFetchMock).toHaveBeenCalledTimes(400)
    expect(result.requestsStarted).toBe(400)
    expect(result.partialDueToBudget).toBe(true)
  })
})
