import { beforeEach, describe, expect, it, vi } from 'vitest'

type Handler = (
  payload: Record<string, unknown>,
  context: { jobId: number; workerId: string; attempts: number }
) => Promise<Record<string, unknown> | void>

type QueryResult = {
  data: Record<string, string | number | boolean | null>[] | null
  error: { message: string } | null
}

/**
 * A PostgREST-shaped client whose every guild_config read resolves to
 * `result`. The builder methods the job chains are all accepted.
 */
function clientReturning(result: (select: string) => QueryResult) {
  const queries: { select: string; eq: [string, unknown][] }[] = []
  const from = vi.fn((_table: string) => {
    let selected = ''
    const query = { select: '', eq: [] as [string, unknown][] }
    queries.push(query)
    const builder = {
      select: (columns: string) => {
        selected = columns
        query.select = columns
        return builder
      },
      gte: () => builder,
      eq: (column: string, value: unknown) => {
        query.eq.push([column, value])
        return builder
      },
      or: () => builder,
      order: () => builder,
      limit: () => Promise.resolve(result(selected)),
      then: (resolve: (value: QueryResult) => unknown) =>
        Promise.resolve(result(selected)).then(resolve)
    }
    return builder
  })
  return { from, queries }
}

const ANON_DENIED: QueryResult = {
  data: null,
  error: { message: 'permission denied for table guild_config' }
}

const addSyncAlert = vi.fn()
const addApiKeyAlert = vi.fn()
const addDatabaseAlert = vi.fn()
const warn = vi.fn()

function rowsFor(select: string): QueryResult {
  if (select.includes('api_key_is_valid')) {
    return {
      data: [
        {
          guild_code: 'TG01',
          display_name: '[TG] Test Guild',
          api_key_is_valid: false
        }
      ],
      error: null
    }
  }
  if (select.includes('auto_sync_enabled')) {
    return {
      data: [
        {
          guild_code: 'TG02',
          display_name: '[TG] Test Guild Two',
          consecutive_sync_failures: 6,
          auto_sync_enabled: true,
          last_successful_sync: null
        }
      ],
      error: null
    }
  }
  return { data: [], error: null }
}

async function loadHandler(dbModule: Record<string, unknown>) {
  vi.resetModules()
  addSyncAlert.mockReset()
  addApiKeyAlert.mockReset()
  addDatabaseAlert.mockReset()
  warn.mockReset()
  const registered: Handler[] = []
  vi.doMock('@/app/lib/jobs/dispatcher', () => ({
    registerJobHandler: (_type: string, handler: Handler) => {
      registered.push(handler)
    }
  }))
  vi.doMock('@/app/lib/logging', () => ({
    createComponentLogger: () => ({
      info: vi.fn(),
      warn,
      error: vi.fn(),
      debug: vi.fn()
    })
  }))
  vi.doMock('@/app/lib/health', () => ({
    runAllHealthChecks: vi.fn(async () => ({ summary: {} }))
  }))
  vi.doMock('@/app/lib/services/api-key-incident-notifications', () => ({
    sendApiKeyIncidentNotifications: vi.fn(async () => ({}))
  }))
  vi.doMock('@tacticus/app-core/daily-alert-summary', () => ({
    addSyncAlert,
    addApiKeyAlert,
    addDatabaseAlert,
    addInfrastructureAlert: vi.fn(),
    getAlertSummary: () => ({ alerts: [], stats: {} }),
    sendDailySummary: vi.fn()
  }))
  vi.doMock('@/app/lib/db', () => dbModule)
  const mod = await import('@/app/lib/jobs/daily-alert-summary')
  mod.registerDailyAlertSummaryHandler()
  expect(registered).toHaveLength(1)
  return registered[0]
}

describe('daily alert summary job reads guild_config with the service client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('raises sync and API-key alerts from service-role rows, never touching the cookie client', async () => {
    const cookieClient = clientReturning(() => ANON_DENIED)
    const serviceClient = clientReturning(rowsFor)
    const handler = await loadHandler({
      db: vi.fn(async () => cookieClient),
      serviceDb: vi.fn(() => serviceClient)
    })

    await handler({}, { jobId: 1, workerId: 'test-worker', attempts: 1 })

    expect(cookieClient.from).not.toHaveBeenCalled()
    expect(serviceClient.from).toHaveBeenCalledWith('guild_config')
    // The service client bypasses RLS, so each read must exclude disabled guilds itself.
    expect(serviceClient.queries).toHaveLength(4)
    for (const query of serviceClient.queries) {
      expect(query.eq).toContainEqual(['enabled', true])
    }
    expect(addSyncAlert).toHaveBeenCalledWith(
      'Guild Sync Failures',
      expect.stringContaining('6 consecutive sync failures'),
      'error',
      expect.objectContaining({ guildCode: 'TG02', failures: 6 })
    )
    expect(addApiKeyAlert).toHaveBeenCalledWith(
      'Invalid API Key',
      expect.stringContaining('invalid or expired API key'),
      'error',
      expect.objectContaining({ guildCode: 'TG01' })
    )
    expect(warn).not.toHaveBeenCalled()
  })

  it('logs a failed read instead of silently dropping its alerts', async () => {
    const serviceClient = clientReturning(() => ANON_DENIED)
    const handler = await loadHandler({
      db: vi.fn(async () => serviceClient),
      serviceDb: vi.fn(() => serviceClient)
    })

    await handler({}, { jobId: 2, workerId: 'test-worker', attempts: 1 })

    expect(addSyncAlert).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledTimes(4)
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        query: 'failed-guilds',
        err: 'permission denied for table guild_config'
      }),
      'Sync health alert query failed'
    )
  })
})

describe('infrastructure database check uses the service client', () => {
  it('reports connected when the service client can count guild_config, whatever the cookie client says', async () => {
    vi.resetModules()
    const cookieClient = clientReturning(() => ANON_DENIED)
    const serviceClient = clientReturning(() => ({ data: [], error: null }))
    vi.doMock('@tacticus/app-core/daily-alert-summary', () => ({
      addInfrastructureAlert: vi.fn(),
      addDatabaseAlert
    }))
    vi.doMock('@/app/lib/db', () => ({
      db: vi.fn(async () => cookieClient),
      serviceDb: vi.fn(() => serviceClient)
    }))
    addDatabaseAlert.mockReset()
    const { runInfrastructureHealthChecks } =
      await import('@/app/lib/health/infrastructure-health')

    const result = await runInfrastructureHealthChecks({ emitAlerts: true })

    expect(result.database.connected).toBe(true)
    expect(cookieClient.from).not.toHaveBeenCalled()
    expect(addDatabaseAlert).not.toHaveBeenCalledWith(
      'Database Query Failed',
      expect.anything(),
      expect.anything(),
      expect.anything()
    )
  })
})
