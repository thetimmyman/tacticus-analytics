/** Batch upsert errors must leave full_sync and incremental_sync retryable. */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const mockRpc = vi.fn()
const mockFrom = vi.fn()

vi.mock('@/app/lib/auth/server', () => ({
  createServiceClient: vi.fn(() => ({
    rpc: mockRpc,
    from: mockFrom,
    functions: {
      invoke: vi.fn().mockResolvedValue({ data: null, error: null })
    }
  }))
}))

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

const mockDecryptApiKey = vi.fn()
const mockResolveStoredSecret = vi.fn()
vi.mock('@tacticus/app-core/encryption', () => ({
  decryptApiKey: mockDecryptApiKey,
  resolveStoredSecret: mockResolveStoredSecret
}))

vi.mock('@tacticus/app-core/app-config', () => ({
  TACTICUS_API: { BASE_URL: 'https://api.tacticusgame.com' }
}))

vi.mock('@/app/lib/middleware/errorHandler', () => ({
  withErrorHandler: vi.fn((handler) => handler)
}))

vi.mock('@/app/lib/errors/AppError', () => ({
  Errors: {
    fromResponse: vi.fn((status: number, body: object) => {
      const err = Object.assign(new Error('AppError'), {
        statusCode: status,
        body,
        isAppError: true
      })
      return err
    })
  },
  rethrowIfAppError: vi.fn((err: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if ((err as any)?.isAppError) throw err
  })
}))

vi.mock('@/app/lib/monitoring/sentry', () => ({
  captureSentryException: vi.fn()
}))

vi.mock('@/app/lib/sync/api-operations', () => ({
  fetchGuildMembersViaLoki: vi
    .fn()
    .mockResolvedValue({ members: [], authFailed: false }),
  fetchGuildRankings: vi.fn().mockResolvedValue([])
}))

vi.mock('@/app/lib/services/season-timing-service', () => ({
  getSeasonTiming: vi.fn().mockResolvedValue({ seasonNumber: 1, weekNumber: 1 })
}))

const mockEntry = {
  Name: 'player1',
  displayName: 'Player One',
  score: 100,
  completedOn: new Date().toISOString()
}
// handleDuplicateDisplayNames stays real (load-bearing join key).
vi.mock('@/app/lib/sync/transformers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/sync/transformers')>()),
  extractEntries: vi.fn(() => [mockEntry]),
  sanitizeRaidEntries: vi.fn((entries: Record<string, unknown>[]) => ({
    sanitized: entries,
    dropped: 0
  })),
  processRaidEntry: vi.fn((_entry, guild, season) => ({
    Guild: guild,
    Season: season,
    Name: 'player1',
    displayName: 'Player One',
    score: 100
  })),
  filterProcessedData: vi.fn((entries: Record<string, unknown>[]) => entries)
}))

vi.mock('@/app/lib/sync/db-operations', () => ({
  loadExistingPlayerMappings: vi.fn().mockResolvedValue(new Map()),
  fetchBossMappings: vi.fn().mockResolvedValue(new Map()),
  updateBombTracking: vi.fn().mockResolvedValue(undefined)
}))

const makeRequest = (authHeader?: string) =>
  new NextRequest('http://localhost:3000/api/sync/worker', {
    method: 'POST',
    headers: authHeader ? { authorization: authHeader } : {}
  })

function buildRpcMock(
  overrides: Record<string, (args?: Record<string, unknown>) => unknown> = {}
) {
  const calls: Record<string, Array<Record<string, unknown> | undefined>> = {}
  const impl = (fn: string, args?: Record<string, unknown>) => {
    ;(calls[fn] ??= []).push(args)
    if (overrides[fn]) return overrides[fn](args)
    return Promise.resolve({ data: null, error: null })
  }
  return { impl, calls }
}

function buildFromMock(
  tableOverrides: Record<string, Record<string, unknown>> = {}
) {
  return (table: string) => {
    const overrides = tableOverrides[table] ?? {}
    const chainable: Record<string, unknown> = {
      select: () => chainable,
      eq: () => chainable,
      gte: () => chainable,
      lte: () => chainable,
      in: () => chainable,
      single: () =>
        Promise.resolve({
          data: overrides.singleData ?? null,
          error: overrides.singleError ?? null
        }),
      upsert: () => {
        const upsertResult = {
          data: overrides.upsertError
            ? null
            : (overrides.upsertData ?? [{ id: 1 }]),
          error: overrides.upsertError ?? null
        }
        return {
          select: () => Promise.resolve(upsertResult),
          then: (resolve: (v: typeof upsertResult) => unknown) =>
            resolve(upsertResult)
        }
      },
      delete: () => chainable,
      update: () => chainable,
      insert: () => chainable,
      not: () => Promise.resolve({ error: overrides.deleteError ?? null })
    }
    return chainable
  }
}

describe('POST /api/sync/worker', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.resetAllMocks()
    mockResolveStoredSecret.mockResolvedValue(null)
    process.env.CRON_SECRET = 'test-secret'
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({ season: 1, currentSeason: 1, entries: [mockEntry] })
      })
    )
  })

  it('returns 401 when Authorization header is missing', async () => {
    const { POST } = await import('@/app/api/sync/worker/route')
    const req = makeRequest()
    try {
      await POST(req)
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((err as any).statusCode).toBe(401)
    }
  })

  it('returns 401 when Authorization header has wrong secret', async () => {
    const { POST } = await import('@/app/api/sync/worker/route')
    const req = makeRequest('Bearer wrong-secret')
    try {
      await POST(req)
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((err as any).statusCode).toBe(401)
    }
  })

  it('returns 200 with empty queue when no jobs are pending', async () => {
    mockRpc.mockResolvedValue({ data: null, error: null })

    const { POST } = await import('@/app/api/sync/worker/route')
    const req = makeRequest('Bearer test-secret')
    const response = await POST(req)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.success).toBe(true)
    expect(body.jobsProcessed).toBe(0)
  })

  it('returns 500 when CRON_SECRET env var is not configured', async () => {
    delete process.env.CRON_SECRET

    const { POST } = await import('@/app/api/sync/worker/route')
    const req = makeRequest('Bearer test-secret')
    try {
      await POST(req)
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      expect((err as any).statusCode).toBe(500)
    }
  })

  describe('batch upsert failure handling (WI-531)', () => {
    const mockJob = {
      id: 'job-1',
      guild_code: 'GUILD01',
      job_type: 'full_sync',
      payload: null
    }

    const mockGuildConfig = {
      guild_code: 'GUILD01',
      api_key_encrypted: 'encrypted-key',
      cluster_code: 'C1',
      cluster_id: 'cluster-1'
    }

    it('full_sync with batch upsert errors calls fail_job instead of complete_job', async () => {
      mockDecryptApiKey.mockResolvedValue('test-api-key')
      let claimCount = 0
      const rpc = buildRpcMock({
        claim_next_job: () => {
          if (claimCount++ === 0)
            return Promise.resolve({ data: mockJob, error: null })
          return Promise.resolve({ data: null, error: null })
        },
        fail_job: () => Promise.resolve({ data: true, error: null }),
        complete_job: () => Promise.resolve({ data: true, error: null })
      })
      mockRpc.mockImplementation(rpc.impl)

      mockFrom.mockImplementation(
        buildFromMock({
          guild_config: { singleData: mockGuildConfig },
          EOT_GR_data: { upsertError: { message: 'row too large' } }
        })
      )

      const { POST } = await import('@/app/api/sync/worker/route')
      const response = await POST(makeRequest('Bearer test-secret'))

      expect(response.status).toBe(200)
      const body = await response.json()

      expect(body.jobsProcessed).toBe(1)

      expect(rpc.calls['fail_job']).toBeDefined()
      expect(rpc.calls['fail_job']!.length).toBe(1)

      const failArgs = rpc.calls['fail_job']![0]!
      expect(failArgs['p_error']).toContain('Batch upsert failed')

      expect(rpc.calls['complete_job']).toBeUndefined()

      const jobResult = body.results[0]
      expect(jobResult.success).toBe(false)
    })

    it('incremental_sync with batch upsert errors fails retryably instead of completing', async () => {
      mockDecryptApiKey.mockResolvedValue('test-api-key')
      const incrementalJob = { ...mockJob, job_type: 'incremental_sync' }
      let claimCount = 0
      const rpc = buildRpcMock({
        claim_next_job: () => {
          if (claimCount++ === 0)
            return Promise.resolve({ data: incrementalJob, error: null })
          return Promise.resolve({ data: null, error: null })
        },
        complete_job: () => Promise.resolve({ data: true, error: null }),
        fail_job: () => Promise.resolve({ data: true, error: null })
      })
      mockRpc.mockImplementation(rpc.impl)

      mockFrom.mockImplementation(
        buildFromMock({
          guild_config: { singleData: mockGuildConfig },
          EOT_GR_data: { upsertError: { message: 'row too large' } },
          guild_sync_status: {
            singleData: {
              last_sync: new Date(
                Date.now() - 48 * 60 * 60 * 1000
              ).toISOString()
            }
          }
        })
      )

      const { POST } = await import('@/app/api/sync/worker/route')
      const response = await POST(makeRequest('Bearer test-secret'))

      expect(response.status).toBe(200)
      const body = await response.json()
      expect(body.jobsProcessed).toBe(1)

      // A partial incremental write must stay retryable even though the worker returned 200.
      expect(rpc.calls['fail_job']).toBeDefined()
      expect(rpc.calls['fail_job']!.length).toBe(1)
      expect(rpc.calls['fail_job']![0]!['p_error']).toContain(
        'Batch upsert failed'
      )
      expect(rpc.calls['complete_job']).toBeUndefined()
      expect(body.results[0].success).toBe(false)
    })
  })
})
