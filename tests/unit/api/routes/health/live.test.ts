import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let mockCaptureSentryMessage: ReturnType<typeof vi.fn>
let mockFetch: ReturnType<typeof vi.fn>

describe('GET /api/health/live', () => {
  let GET: () => Promise<Response>

  beforeEach(async () => {
    vi.resetModules()

    mockCaptureSentryMessage = vi.fn()
    mockFetch = vi.fn()

    vi.doMock('@/app/lib/monitoring/sentry', () => ({
      captureSentryMessage: mockCaptureSentryMessage
    }))

    vi.stubEnv('SUPABASE_URL', 'http://kong:8000')
    vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'test-anon-key')
    vi.stubGlobal('fetch', mockFetch)

    const mod = await import('@/app/api/health/live/route')
    GET = mod.GET
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
  })

  it('returns 200 ok without pool check when SUPABASE_URL is not set', async () => {
    vi.stubEnv('SUPABASE_URL', '')

    vi.resetModules()
    vi.doMock('@/app/lib/monitoring/sentry', () => ({
      captureSentryMessage: mockCaptureSentryMessage
    }))
    const mod = await import('@/app/api/health/live/route')

    const response = await mod.GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns 200 ok when Supabase responds successfully', async () => {
    mockFetch.mockResolvedValue(new Response('ok', { status: 200 }))

    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
  })

  it('returns 503 degraded when fetch times out (AbortError)', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    mockFetch.mockRejectedValue(abortError)

    const response = await GET()
    expect(response.status).toBe(503)
    const body = await response.json()
    expect(body.status).toBe('degraded')
    expect(body.reason).toBe('fetch_pool_timeout')
  })

  it('calls captureSentryMessage on timeout', async () => {
    const abortError = new Error('The operation was aborted')
    abortError.name = 'AbortError'
    mockFetch.mockRejectedValue(abortError)

    await GET()
    expect(mockCaptureSentryMessage).toHaveBeenCalledWith(
      expect.stringContaining('Fetch pool degraded'),
      expect.objectContaining({ level: 'error' })
    )
  })

  it('returns 200 ok with upstream_unreachable on non-timeout fetch error', async () => {
    mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

    const response = await GET()
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.status).toBe('ok')
    expect(body.note).toBe('upstream_unreachable')
  })
})
