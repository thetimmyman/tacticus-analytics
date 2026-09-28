import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

// The real cleanupExpiredData() predicate deletes only expired rows, never a blanket delete.

describe('POST /api/cron/gdpr-cleanup (route handler)', () => {
  let POST: (req: NextRequest) => Promise<Response>
  let mockLogger: {
    info: ReturnType<typeof vi.fn>
    warn: ReturnType<typeof vi.fn>
    error: ReturnType<typeof vi.fn>
    debug: ReturnType<typeof vi.fn>
  }
  let mockCleanupExpiredData: ReturnType<typeof vi.fn>
  let mockExecuteScheduledDeletions: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.resetModules()
    mockCleanupExpiredData = vi.fn().mockResolvedValue({
      processingLogRowsDeleted: 3,
      expiredExportRowsDeleted: 1
    })
    mockExecuteScheduledDeletions = vi.fn().mockResolvedValue(undefined)

    vi.doMock('@/app/lib/compliance/gdpr-manager', () => ({
      gdprManager: {
        cleanupExpiredData: mockCleanupExpiredData,
        executeScheduledDeletions: mockExecuteScheduledDeletions
      }
    }))

    mockLogger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn()
    }
    vi.doMock('@/app/lib/logging', async (importOriginal) => ({
      ...(await importOriginal<typeof import('@/app/lib/logging')>()),
      createComponentLogger: () => mockLogger
    }))

    vi.stubEnv('CRON_SECRET', 'top-secret')

    const mod = await import('@/app/api/cron/gdpr-cleanup/route')
    POST = mod.POST
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  const makeRequest = (auth?: string) =>
    new NextRequest('http://localhost/api/cron/gdpr-cleanup', {
      method: 'POST',
      headers: auth ? { authorization: auth } : {}
    })

  it('returns 401 when the Authorization header is missing', async () => {
    const res = await POST(makeRequest())
    expect(res.status).toBe(401)
    expect(mockCleanupExpiredData).not.toHaveBeenCalled()
    expect(mockExecuteScheduledDeletions).not.toHaveBeenCalled()
  })

  it('returns 401 when the Bearer token is wrong', async () => {
    const res = await POST(makeRequest('Bearer not-the-secret'))
    expect(res.status).toBe(401)
    expect(mockCleanupExpiredData).not.toHaveBeenCalled()
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    vi.stubEnv('CRON_SECRET', '')
    vi.resetModules()
    vi.doMock('@/app/lib/compliance/gdpr-manager', () => ({
      gdprManager: {
        cleanupExpiredData: mockCleanupExpiredData,
        executeScheduledDeletions: mockExecuteScheduledDeletions
      }
    }))
    const mod = await import('@/app/api/cron/gdpr-cleanup/route')
    const freshPost = mod.POST
    const res = await freshPost(makeRequest('Bearer top-secret'))
    expect(res.status).toBe(500)
    expect(mockCleanupExpiredData).not.toHaveBeenCalled()
  })

  it('runs both cleanup phases on a valid cron secret', async () => {
    const res = await POST(makeRequest('Bearer top-secret'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(mockCleanupExpiredData).toHaveBeenCalledTimes(1)
    expect(mockExecuteScheduledDeletions).toHaveBeenCalledTimes(1)
  })

  // cron.job_run_details reports `succeeded` either way, so counts must be logged.
  it('logs BOTH DELETE row counts and returns them', async () => {
    const res = await POST(makeRequest('Bearer top-secret'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.processingLogRowsDeleted).toBe(3)
    expect(body.expiredExportRowsDeleted).toBe(1)

    const logged = mockLogger.info.mock.calls.find(
      (args) =>
        (args[0] as Record<string, unknown> | undefined)?.event ===
        'gdpr.cleanup.rows_deleted'
    )
    expect(logged).toBeDefined()
    expect(logged?.[0]).toMatchObject({
      processingLogRowsDeleted: 3,
      expiredExportRowsDeleted: 1
    })
  })

  it('returns 500 when a cleanup phase throws', async () => {
    mockCleanupExpiredData.mockRejectedValue(new Error('db exploded'))
    const res = await POST(makeRequest('Bearer top-secret'))
    expect(res.status).toBe(500)
  })
})

describe('gdprManager.cleanupExpiredData (predicate)', () => {
  let mockServiceDb: ReturnType<typeof vi.fn>
  let chains: Record<
    string,
    {
      delete: ReturnType<typeof vi.fn>
      lt: ReturnType<typeof vi.fn>
      not: ReturnType<typeof vi.fn>
    }
  >

  beforeEach(() => {
    vi.resetModules()
    vi.doUnmock('@/app/lib/compliance/gdpr-manager')
    chains = {}
    mockServiceDb = vi.fn(() => ({
      from: vi.fn((table: string) => {
        const notFn = vi.fn().mockResolvedValue({
          error: null,
          count: table === 'gdpr_processing_log' ? 2 : 0
        })
        const ltFn = vi.fn().mockReturnValue({ not: notFn })
        const deleteFn = vi.fn().mockReturnValue({ lt: ltFn })
        chains[table] = { delete: deleteFn, lt: ltFn, not: notFn }
        return { delete: deleteFn }
      })
    }))

    vi.doMock('@/app/lib/db', () => ({
      db: vi.fn(),
      serviceDb: mockServiceDb
    }))
    vi.doMock('@/app/lib/logging', () => ({
      createComponentLogger: () => ({
        error: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        debug: vi.fn()
      }),
      logError: vi.fn()
    }))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('deletes ONLY expired processing-log + export rows (lt + not-null predicate, not a blanket delete)', async () => {
    const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')
    await gdprManager.cleanupExpiredData()

    expect(chains['gdpr_processing_log']).toBeDefined()
    expect(chains['gdpr_data_exports']).toBeDefined()

    const logChain = chains['gdpr_processing_log']
    expect(logChain.delete).toHaveBeenCalledTimes(1)
    const [ltCol, ltVal] = logChain.lt.mock.calls[0]
    expect(ltCol).toBe('retention_until')
    expect(typeof ltVal).toBe('string')
    expect(Number.isNaN(Date.parse(ltVal as string))).toBe(false)
    expect(logChain.not).toHaveBeenCalledWith('retention_until', 'is', null)

    expect(logChain.delete).toHaveBeenCalledWith({ count: 'exact' })

    const exportChain = chains['gdpr_data_exports']
    expect(exportChain.delete).toHaveBeenCalledTimes(1)
    expect(exportChain.delete).toHaveBeenCalledWith({ count: 'exact' })
    expect(exportChain.lt.mock.calls[0][0]).toBe('expires_at')
    expect(exportChain.not).toHaveBeenCalledWith('expires_at', 'is', null)
  })

  it('returns the two DELETE row counts to its caller', async () => {
    const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')
    const counts = await gdprManager.cleanupExpiredData()
    expect(counts).toEqual({
      processingLogRowsDeleted: 2,
      expiredExportRowsDeleted: 0
    })
  })

  it('uses a cutoff that is no later than the current time (does not delete future-retained rows)', async () => {
    const before = Date.now()
    const { gdprManager } = await import('@/app/lib/compliance/gdpr-manager')
    await gdprManager.cleanupExpiredData()
    const after = Date.now()

    const cutoff = Date.parse(
      chains['gdpr_processing_log'].lt.mock.calls[0][1] as string
    )
    expect(cutoff).toBeGreaterThanOrEqual(before - 1000)
    expect(cutoff).toBeLessThanOrEqual(after + 1000)
  })
})
