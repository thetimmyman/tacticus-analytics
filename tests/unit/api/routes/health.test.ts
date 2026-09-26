import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { mockExec, mockExecFile, mockExecState } = vi.hoisted(() => {
  const state: {
    stdout: string
    stderr: string
    error: Error | null
    responses: Array<{ stdout?: string; stderr?: string; error?: Error | null }>
    commands: string[]
  } = {
    stdout: 'HTTP/1.1 401 Unauthorized',
    stderr: '',
    error: null,
    responses: [],
    commands: []
  }

  const nextResponse = () => {
    const response = state.responses.shift()
    return {
      stdout: response?.stdout ?? state.stdout,
      stderr: response?.stderr ?? state.stderr,
      error: response?.error ?? state.error
    }
  }

  const execMock = vi.fn((cmd, opts, cb) => {
    state.commands.push(String(cmd))
    const callback = typeof opts === 'function' ? opts : cb
    const response = nextResponse()
    callback?.(response.error, response.stdout, response.stderr)
  })

  ;(execMock as unknown as Record<symbol, unknown>)[
    Symbol.for('nodejs.util.promisify.custom')
  ] = vi.fn(async (cmd) => {
    state.commands.push(String(cmd))
    const response = nextResponse()
    if (response.error) throw response.error
    return { stdout: response.stdout, stderr: response.stderr }
  })

  const execFileMock = vi.fn((file, args, opts, cb) => {
    state.commands.push([file, ...(args ?? [])].join(' '))
    const callback = typeof opts === 'function' ? opts : cb
    const response = nextResponse()
    callback?.(response.error, response.stdout, response.stderr)
  })

  ;(execFileMock as unknown as Record<symbol, unknown>)[
    Symbol.for('nodejs.util.promisify.custom')
  ] = vi.fn(async (file, args) => {
    state.commands.push([file, ...(args ?? [])].join(' '))
    const response = nextResponse()
    if (response.error) throw response.error
    return { stdout: response.stdout, stderr: response.stderr }
  })

  return {
    mockExec: execMock,
    mockExecFile: execFileMock,
    mockExecState: state
  }
})

vi.mock('child_process', () => ({
  default: { exec: mockExec, execFile: mockExecFile },
  exec: mockExec,
  execFile: mockExecFile
}))

vi.mock('@/app/lib/db', () => ({
  db: vi.fn(),
  retryMetrics: {
    getStats: vi.fn(() => ({
      totalOperations: 0,
      successfulRetries: 0,
      failedAfterRetries: 0,
      averageAttempts: 0,
      recentMetrics: []
    }))
  },
  writeQueue: {
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
  }
}))

vi.mock('@/app/lib/health', () => ({
  getMemoryMonitor: vi.fn(() => ({
    checkMemory: vi.fn(() => ({
      status: 'healthy',
      usedMB: 100,
      totalMB: 500,
      usedPercent: 20,
      trend: 'stable',
      leakSuspected: false,
      trendDetails: {}
    })),
    getHeapBreakdown: vi.fn(() => ({
      heapUsedMB: 50,
      heapTotalMB: 100,
      rssMB: 150
    }))
  })),
  attemptMemoryRecovery: vi.fn(() => Promise.resolve()),
  sendCriticalMemoryAlert: vi.fn(() => Promise.resolve())
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

vi.mock('@/app/lib/logging', () => ({
  withRequestContext: vi.fn((handler) => {
    return async (req: NextRequest) => {
      const mockContext = {
        log: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn()
        },
        requestId: 'test-request-id',
        startTime: Date.now()
      }
      return handler(req, mockContext)
    }
  }),
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  },
  generateRequestId: vi.fn(() => 'test-request-id'),
  logError: vi.fn()
}))

vi.mock('@/app/lib/middleware/errorHandler', () => ({
  withErrorHandler: vi.fn((handler) => handler)
}))

vi.mock('@/app/lib/errors/AppError', () => ({
  rethrowIfAppError: vi.fn()
}))

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn()
}))

describe('GET /api/health', () => {
  let mockDb: ReturnType<typeof vi.fn>
  let mockSupabase: {
    from: ReturnType<typeof vi.fn>
    auth: object | undefined
  }

  beforeEach(async () => {
    vi.clearAllMocks()
    mockExecState.stdout = 'HTTP/1.1 401 Unauthorized'
    mockExecState.stderr = ''
    mockExecState.error = null
    mockExecState.responses = []
    mockExecState.commands = []
    process.env.SUPABASE_INTERNAL_URL = 'http://internal-supabase.test'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-anon-key'
    // Snapshot cache is off because modules are not reset between tests.
    process.env.HEALTH_CHECK_SECRET = 'test-health-secret'
    process.env.HEALTH_CACHE_TTL_MS = '0'

    mockSupabase = {
      from: vi.fn(),
      auth: {}
    }

    const dbModule = await import('@/app/lib/db')
    mockDb = vi.mocked(dbModule.db)
    mockDb.mockResolvedValue(mockSupabase)
  })

  const createMockRequest = () => {
    return new NextRequest('http://localhost:3000/api/health', {
      method: 'GET',
      headers: { authorization: 'Bearer test-health-secret' }
    })
  }

  it('returns 200 with auth and metrics data-layer checks', async () => {
    const { GET } = await import('@/app/api/health/route')
    mockExecState.responses = [
      { stdout: 'HTTP/1.1 401 Unauthorized' },
      { stdout: 'HTTP/1.1 200 OK\n{\"version\":\"test\"}' },
      { stdout: 'HTTP/1.1 200 OK\n[]' },
      { stdout: 'HTTP/1.1 200 OK\n[]' }
    ]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      }

      if (table === 'player_with_cluster') {
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      }

      return {
        select: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    })

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.checks.auth.status).toBe('pass')
    expect(body.checks.auth.details).toEqual(
      expect.objectContaining({
        provider: 'supabase-auth',
        probe: 'kong-auth-health',
        statusCode: 200
      })
    )
    expect(body.checks.calculations.status).toBe('pass')
    expect(body.checks.calculations.details.provider).toBe(
      'rpc-dashboard-calculations'
    )
    expect(body.checks.calculations.details.failedProbe).toBeNull()
    // The probe reads no table, so revoking anon EXECUTE on data RPCs cannot break it.
    expect(body.checks.calculations.details.probes).toEqual([
      expect.objectContaining({
        probe: 'postgrest-rpc:postgrest_anon_probe',
        status: 'pass',
        statusCode: 200,
        rowCount: 0,
        validBody: true
      })
    ])
    expect(
      mockExecState.commands.some((command) =>
        command.includes('http://internal-supabase.test/auth/v1/health')
      )
    ).toBe(true)
    expect(
      mockExecState.commands.some((command) =>
        command.includes(
          'http://internal-supabase.test/rest/v1/rpc/postgrest_anon_probe'
        )
      )
    ).toBe(true)
    expect(
      mockExecState.commands.every(
        (command) => !command.includes('/rest/v1/rpc/get_player_token_state')
      )
    ).toBe(true)
  })

  it('recognizes GNU wget2 output formats (dev workstations where wget is wget2)', async () => {
    // Verbatim wget2 2.x output: HTTP/2 status comes as `:status: NNN` on stderr.
    const { GET } = await import('@/app/api/health/route')
    mockExecState.responses = [
      {
        stdout: '',
        stderr:
          'HTTP ERROR response 401  [http://internal-supabase.test/rest/v1/]'
      },
      {
        stdout: '{"version":"test"}',
        stderr:
          ':status: 200\nHTTP response 200  [http://internal-supabase.test/auth/v1/health]'
      },
      { stdout: '[]', stderr: ':status: 200' },
      { stdout: '[]', stderr: ':status: 200' }
    ]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'player_with_cluster') {
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      }
      return {
        select: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    })

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.checks.database.status).toBe('pass')
    expect(body.checks.auth.status).toBe('pass')
    expect(body.checks.auth.details.statusCode).toBe(200)
    expect(body.checks.calculations.status).toBe('pass')
    expect(body.checks.calculations.details.failedProbe).toBeNull()
  })

  it('returns degraded status when database connectivity check fails', async () => {
    const { GET } = await import('@/app/api/health/route')
    mockExecState.responses = [
      { stdout: '' },
      { stdout: 'HTTP/1.1 200 OK\n{\"version\":\"test\"}' },
      { stdout: 'HTTP/1.1 200 OK\n[]' },
      { stdout: 'HTTP/1.1 200 OK\n[]' }
    ]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockResolvedValue({
            data: null,
            error: { message: 'Connection refused' }
          })
        }
      }

      if (table === 'player_with_cluster') {
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      }

      return {
        select: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    })

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.database.status).toBe('fail')
    expect(body.checks.database.details.error).toBe(
      'No HTTP response from Kong'
    )
  })

  it('returns degraded status when metrics RPC probe fails', async () => {
    const { GET } = await import('@/app/api/health/route')
    mockExecState.responses = [
      { stdout: 'HTTP/1.1 401 Unauthorized' },
      { stdout: 'HTTP/1.1 200 OK\n{\"version\":\"test\"}' },
      { stdout: 'HTTP/1.1 404 Not Found\n{"message":"not found"}' },
      { stdout: 'HTTP/1.1 200 OK\n[]' }
    ]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      }

      if (table === 'player_with_cluster') {
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      }

      return {
        select: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    })

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.calculations.status).toBe('fail')
    expect(body.checks.calculations.details.failedProbe).toBe(
      'postgrest-rpc:postgrest_anon_probe'
    )
    expect(body.checks.calculations.details.probes[0]).toEqual(
      expect.objectContaining({
        probe: 'postgrest-rpc:postgrest_anon_probe',
        status: 'fail',
        statusCode: 404
      })
    )
  })

  it('returns degraded status when metrics RPC probe returns a non-array body', async () => {
    const { GET } = await import('@/app/api/health/route')
    mockExecState.responses = [
      { stdout: 'HTTP/1.1 401 Unauthorized' },
      { stdout: 'HTTP/1.1 200 OK\n{\"version\":\"test\"}' },
      { stdout: 'HTTP/1.1 200 OK\n<html>not postgrest json</html>' },
      { stdout: 'HTTP/1.1 200 OK\n[]' }
    ]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      }

      if (table === 'player_with_cluster') {
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      }

      return {
        select: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    })

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.calculations.status).toBe('fail')
    expect(body.checks.calculations.details.failedProbe).toBe(
      'postgrest-rpc:postgrest_anon_probe'
    )
    expect(body.checks.calculations.details.probes[0]).toEqual(
      expect.objectContaining({
        probe: 'postgrest-rpc:postgrest_anon_probe',
        status: 'fail',
        statusCode: 200,
        rowCount: null,
        validBody: false
      })
    )
  })

  it('returns degraded status when metrics RPC credentials are missing', async () => {
    const { GET } = await import('@/app/api/health/route')
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    delete process.env.SUPABASE_ANON_KEY
    mockExecState.responses = [{ stdout: 'HTTP/1.1 401 Unauthorized' }]

    mockSupabase.from.mockImplementation((table: string) => {
      if (table === 'guild_config') {
        return {
          select: vi.fn().mockResolvedValue({ data: null, error: null })
        }
      }

      if (table === 'player_with_cluster') {
        return {
          select: vi.fn().mockReturnValue({
            limit: vi.fn().mockResolvedValue({ data: [], error: null })
          })
        }
      }

      return {
        select: vi.fn().mockResolvedValue({ data: null, error: null })
      }
    })

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.calculations.status).toBe('fail')
    expect(body.checks.calculations.details.error).toBe(
      'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY'
    )
    expect(body.checks.calculations.details.probes).toEqual([])
  })

  it('returns degraded status when auth health probe fails', async () => {
    const { GET } = await import('@/app/api/health/route')
    mockExecState.responses = [
      { stdout: 'HTTP/1.1 401 Unauthorized' },
      { stdout: 'HTTP/1.1 502 Bad Gateway\n{"message":"bad gateway"}' },
      { stdout: 'HTTP/1.1 200 OK\n[]' },
      { stdout: 'HTTP/1.1 200 OK\n[]' }
    ]

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.auth.status).toBe('fail')
    expect(body.checks.auth.details).toEqual(
      expect.objectContaining({
        provider: 'supabase-auth',
        probe: 'kong-auth-health',
        statusCode: 502
      })
    )
  })

  it('includes memory usage metrics', async () => {
    const { GET } = await import('@/app/api/health/route')

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: null })
    })

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(body.memory).toBeDefined()
    expect(body.memory.heapUsed).toBeGreaterThan(0)
    expect(body.memory.heapTotal).toBeGreaterThan(0)
    expect(body.memory.rss).toBeGreaterThan(0)
    expect(body.memory.unit).toBe('MB')
  })

  it('includes uptime and environment', async () => {
    const { GET } = await import('@/app/api/health/route')

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: null })
    })

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(body.uptime).toBeGreaterThanOrEqual(0)
    expect(body.environment).toBeDefined()
    expect(body.timestamp).toBeDefined()
  })

  it('includes response time measurement', async () => {
    const { GET } = await import('@/app/api/health/route')

    mockSupabase.from.mockReturnValue({
      select: vi.fn().mockResolvedValue({ data: null, error: null })
    })

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(body.responseTime).toBeGreaterThanOrEqual(0)
  })

  it('returns 200 while marking auth failed when auth probe has no HTTP response', async () => {
    const { GET } = await import('@/app/api/health/route')
    mockExecState.responses = [
      { stdout: 'HTTP/1.1 401 Unauthorized' },
      { stdout: '' },
      { stdout: 'HTTP/1.1 200 OK\n[]' },
      { stdout: 'HTTP/1.1 200 OK\n[]' }
    ]

    const response = await GET(createMockRequest())
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body.status).toBe('degraded')
    expect(body.checks.auth.status).toBe('fail')
    expect(body.checks.auth.details.statusCode).toBeNull()
  })
})
