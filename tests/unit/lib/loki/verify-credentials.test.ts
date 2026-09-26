import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

let mockRefreshSession: ReturnType<typeof vi.fn>
let mockCreateLokiClient: ReturnType<typeof vi.fn>

describe('verifyLokiCredentials', () => {
  let verifyLokiCredentials: typeof import('@/app/lib/loki/verify-credentials').verifyLokiCredentials

  beforeEach(async () => {
    vi.resetModules()
    mockRefreshSession = vi.fn()
    mockCreateLokiClient = vi.fn(() => ({ refreshSession: mockRefreshSession }))

    vi.doMock('@/app/lib/loki/client', () => ({
      createLokiClient: mockCreateLokiClient
    }))

    ;({ verifyLokiCredentials } =
      await import('@/app/lib/loki/verify-credentials'))
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('returns the sessionId and builds the client with the given credentials', async () => {
    mockRefreshSession.mockResolvedValue({
      ok: true,
      data: { sessionId: 'sess-abcdef123' }
    })

    const result = await verifyLokiCredentials('user-1', 'secret-1')

    expect(result).toEqual({ sessionId: 'sess-abcdef123' })
    expect(mockCreateLokiClient).toHaveBeenCalledWith({
      userId: 'user-1',
      clientSecret: 'secret-1'
    })
  })

  it('throws 401 when the credentials are rejected (isAuthError)', async () => {
    mockRefreshSession.mockResolvedValue({
      ok: false,
      error: { isAuthError: true, message: 'rejected' }
    })

    await expect(verifyLokiCredentials('u', 's')).rejects.toMatchObject({
      statusCode: 401
    })
  })

  it('throws 401 for a 403 status', async () => {
    mockRefreshSession.mockResolvedValue({
      ok: false,
      error: { status: 403, message: 'forbidden' }
    })

    await expect(verifyLokiCredentials('u', 's')).rejects.toMatchObject({
      statusCode: 401
    })
  })

  it('throws 408 on a timeout', async () => {
    mockRefreshSession.mockResolvedValue({
      ok: false,
      error: { message: 'LOKI request timed out after 5000ms' }
    })

    await expect(verifyLokiCredentials('u', 's')).rejects.toMatchObject({
      statusCode: 408
    })
  })

  it('throws 503 when LOKI is unreachable', async () => {
    mockRefreshSession.mockResolvedValue({
      ok: false,
      error: { message: 'Failed to reach LOKI API' }
    })

    await expect(verifyLokiCredentials('u', 's')).rejects.toMatchObject({
      statusCode: 503
    })
  })

  it('throws 502 when connect succeeds but returns no sessionId', async () => {
    mockRefreshSession.mockResolvedValue({ ok: true, data: {} })

    await expect(verifyLokiCredentials('u', 's')).rejects.toMatchObject({
      statusCode: 502
    })
  })

  it('preserves a specific non-auth 4xx status from LOKI', async () => {
    mockRefreshSession.mockResolvedValue({
      ok: false,
      error: { status: 429, message: 'rate limited' }
    })

    await expect(verifyLokiCredentials('u', 's')).rejects.toMatchObject({
      statusCode: 429
    })
  })
})
