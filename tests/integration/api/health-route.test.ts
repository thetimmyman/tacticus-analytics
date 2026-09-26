import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NextResponse } from 'next/server'

const dbMock = vi.hoisted(() => vi.fn())
const { execMock, execFileMock, execMockState } = vi.hoisted(() => {
  const state: {
    stdout: string
    stderr: string
    error: Error | null
    responses: Array<{ stdout?: string; stderr?: string; error?: Error | null }>
  } = {
    stdout: 'HTTP/1.1 200 OK\n[]',
    stderr: '',
    error: null,
    responses: []
  }

  const nextResponse = () => {
    const response = state.responses.shift()
    return {
      stdout: response?.stdout ?? state.stdout,
      stderr: response?.stderr ?? state.stderr,
      error: response?.error ?? state.error
    }
  }

  const exec = vi.fn((_cmd, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb
    const response = nextResponse()
    callback?.(response.error, response.stdout, response.stderr)
  })

  const execFile = vi.fn((_file, _args, opts, cb) => {
    const callback = typeof opts === 'function' ? opts : cb
    const response = nextResponse()
    callback?.(response.error, response.stdout, response.stderr)
  })

  ;(exec as unknown as Record<symbol, unknown>)[
    Symbol.for('nodejs.util.promisify.custom')
  ] = vi.fn(async () => {
    const response = nextResponse()
    if (response.error) throw response.error
    return { stdout: response.stdout, stderr: response.stderr }
  })

  ;(execFile as unknown as Record<symbol, unknown>)[
    Symbol.for('nodejs.util.promisify.custom')
  ] = vi.fn(async () => {
    const response = nextResponse()
    if (response.error) throw response.error
    return { stdout: response.stdout, stderr: response.stderr }
  })

  return { execMock: exec, execFileMock: execFile, execMockState: state }
})
const retryMetricsMock = vi.hoisted(() => ({
  getStats: vi.fn(() => ({
    totalOperations: 0,
    successfulRetries: 0,
    failedAfterRetries: 0,
    averageAttempts: 0,
    recentMetrics: []
  }))
}))
const writeQueueMock = vi.hoisted(() => ({
  getStats: vi.fn(() =>
    Promise.resolve({
      pending: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      oldestPending: null,
      byCircuit: {}
    })
  )
}))

vi.mock('@/app/lib/db', () => ({
  db: dbMock,
  retryMetrics: retryMetricsMock,
  writeQueue: writeQueueMock
}))

vi.mock('@/app/lib/logging', () => ({
  withRequestContext: vi.fn((handler) => {
    return async (req?: Request) => {
      const context = {
        log: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn()
        },
        requestId: 'test-request-id'
      }
      return handler(req, context)
    }
  }),
  createComponentLogger: vi.fn(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  })),
  logError: vi.fn()
}))

vi.mock('@/app/lib/middleware/errorHandler', () => ({
  withErrorHandler: vi.fn((handler) => handler)
}))

vi.mock('@/app/lib/errors/AppError', () => ({
  rethrowIfAppError: vi.fn()
}))

vi.mock('@/app/lib/resilience', () => ({
  circuitRegistry: {
    getSnapshot: vi.fn(() => ({
      summary: { total: 0, closed: 0, open: 0, halfOpen: 0 }
    })),
    getOpenCircuitNames: vi.fn(() => []),
    getStateMap: vi.fn(() => ({}))
  },
  notificationQueue: {
    getStats: vi.fn(() => ({
      totalQueued: 0,
      queuesByCircuit: {},
      oldestNotification: null
    }))
  },
  retryMetricsCollector: {
    getStats: vi.fn(() => ({
      totalOperations: 0,
      successfulOperations: 0,
      failedOperations: 0,
      totalRetries: 0,
      averageRetries: 0
    }))
  }
}))

vi.mock('@/app/lib/health', () => ({
  getMemoryMonitor: vi.fn(() => ({
    checkMemory: vi.fn(() => ({
      usedMB: 100,
      totalMB: 512,
      usedPercent: 19.5,
      status: 'healthy',
      trend: 'stable',
      leakSuspected: false,
      trendDetails: {}
    })),
    getHeapBreakdown: vi.fn(() => ({
      heapUsedMB: 50,
      heapTotalMB: 100,
      rssMB: 120
    }))
  })),
  attemptMemoryRecovery: vi.fn(),
  sendCriticalMemoryAlert: vi.fn()
}))

vi.mock('child_process', async (importOriginal) => {
  const actual = (await importOriginal()) as object
  return {
    ...actual,
    default: {
      ...(actual as { default?: object }).default,
      exec: execMock,
      execFile: execFileMock
    },
    exec: execMock,
    execFile: execFileMock
  }
})

type SupabaseSelectResult = {
  error: null | { message: string }
}

const createSupabaseMock = (result: SupabaseSelectResult) => {
  return {
    from: vi.fn(() => ({
      select: vi.fn().mockResolvedValue(result)
    })),
    auth: {}
  }
}

describe('GET /api/health', () => {
  // Full payload needs the HEALTH_CHECK_SECRET bearer; anonymous callers get a projection.
  const makeRequest = () =>
    new Request('http://localhost/api/health', {
      headers: { authorization: 'Bearer test-health-secret' }
    })

  beforeEach(() => {
    vi.resetModules()
    process.env.HEALTH_CHECK_SECRET = 'test-health-secret'
    process.env.HEALTH_CACHE_TTL_MS = '0'
    dbMock.mockReset()
    execMock.mockClear()
    execMockState.stdout = 'HTTP/1.1 200 OK\n[]'
    execMockState.stderr = ''
    execMockState.error = null
    execMockState.responses = []
    // Without an anon key the probes fail and drag status to 'degraded'.
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
  })

  it('returns healthy status when dependencies succeed', async () => {
    const supabase = createSupabaseMock({ error: null })
    dbMock.mockResolvedValue(supabase)

    const { GET } = await import('@/app/api/health/route')
    const response = (await GET(makeRequest())) as NextResponse
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.status).toBe('healthy')
    expect(payload.checks.database.status).toBe('pass')
    expect(payload.checks.auth.status).toBe('pass')
    expect(payload.checks.auth.details).toEqual(
      expect.objectContaining({
        provider: 'supabase-auth',
        probe: 'kong-auth-health'
      })
    )
  })

  it('sanitizes the payload for unauthenticated callers', async () => {
    const supabase = createSupabaseMock({ error: null })
    dbMock.mockResolvedValue(supabase)

    const { GET } = await import('@/app/api/health/route')
    const response = (await GET(
      new Request('http://localhost/api/health')
    )) as NextResponse
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.status).toBe('healthy')
    expect(payload.checks.database.status).toBe('pass')
    expect(payload.checks.auth.details.provider).toBe('supabase-auth')
    expect(payload.memory).toBeUndefined()
    expect(payload.uptime).toBeUndefined()
    expect(payload.environment).toBeUndefined()
    expect(payload.deployment).toBeUndefined()
    expect(payload.cronRole).toBeUndefined()
  })

  it('coalesces rapid requests into a single check computation', async () => {
    process.env.HEALTH_CACHE_TTL_MS = '60000'
    const supabase = createSupabaseMock({ error: null })
    dbMock.mockResolvedValue(supabase)

    const { GET } = await import('@/app/api/health/route')
    await GET(makeRequest())
    const computations = writeQueueMock.getStats.mock.calls.length
    await GET(makeRequest())
    expect(writeQueueMock.getStats.mock.calls.length).toBe(computations)
  })

  it('returns degraded status when database probe has no HTTP response', async () => {
    const supabase = createSupabaseMock({ error: null })
    dbMock.mockResolvedValue(supabase)
    execMockState.stdout = ''

    const { GET } = await import('@/app/api/health/route')
    const response = await GET(makeRequest())
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.status).toBe('degraded')
    expect(payload.checks.database.status).toBe('fail')
  })

  it('returns degraded when database probe throws', async () => {
    dbMock.mockRejectedValue(new Error('connection refused'))
    execMockState.error = new Error('probe failed')

    const { GET } = await import('@/app/api/health/route')
    const response = await GET(makeRequest())
    expect(response.status).toBe(200)

    const payload = await response.json()
    expect(payload.status).toBe('degraded')
    expect(payload.checks.database.status).toBe('fail')
  })
})
