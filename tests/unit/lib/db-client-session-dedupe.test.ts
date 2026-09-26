import { describe, it, expect, vi, beforeEach } from 'vitest'

// Concurrent checks share one getSession(); each call takes the serial auth-js processLock.

const { mockGetSession, mockCreateDataClient } = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockCreateDataClient: vi.fn()
}))

vi.mock('@/app/lib/auth/browser', () => ({
  createBrowserClient: vi.fn(() => ({
    auth: { getSession: mockGetSession }
  })),
  createStorageClient: vi.fn(),
  createAuthenticatedDataClient: mockCreateDataClient
}))

async function freshModule() {
  vi.resetModules()
  return import('@/app/lib/db/client')
}

const SESSION = { data: { session: { access_token: 't' } } }
const NO_SESSION = { data: { session: null } }

describe('assertClientSession dedupe', () => {
  beforeEach(() => {
    mockGetSession.mockReset()
    mockCreateDataClient.mockReset()
    mockCreateDataClient.mockReturnValue({ rpc: vi.fn() })
  })

  it('resolves when a session is present', async () => {
    mockGetSession.mockResolvedValue(SESSION)
    const { assertClientSession } = await freshModule()

    await expect(assertClientSession()).resolves.toBeUndefined()
    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('throws AUTH_PENDING when the session has not hydrated', async () => {
    mockGetSession.mockResolvedValue(NO_SESSION)
    const { assertClientSession } = await freshModule()

    await expect(assertClientSession()).rejects.toThrow(/^AUTH_PENDING/)
  })

  it('collapses a concurrent burst into a single getSession call', async () => {
    let release!: (value: typeof SESSION) => void
    mockGetSession.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const { assertClientSession } = await freshModule()

    const burst = Promise.all(
      Array.from({ length: 20 }, () => assertClientSession())
    )
    release(SESSION)

    await expect(burst).resolves.toHaveLength(20)
    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('feeds the asserted token to a data client without another session lock', async () => {
    mockGetSession.mockResolvedValue(SESSION)
    const { assertClientSession, authenticatedDbClient } = await freshModule()

    await assertClientSession()
    const first = authenticatedDbClient()
    const second = authenticatedDbClient()

    expect(first).toBe(second)
    expect(mockCreateDataClient).toHaveBeenCalledTimes(1)
    const accessToken = mockCreateDataClient.mock.calls[0]![0] as () => Promise<
      string | null
    >
    await expect(accessToken()).resolves.toBe('t')
    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('propagates a shared rejection to every concurrent caller', async () => {
    let release!: (value: typeof NO_SESSION) => void
    mockGetSession.mockReturnValue(
      new Promise((resolve) => {
        release = resolve
      })
    )
    const { assertClientSession } = await freshModule()

    const first = assertClientSession()
    const second = assertClientSession()
    release(NO_SESSION)

    await expect(first).rejects.toThrow(/^AUTH_PENDING/)
    await expect(second).rejects.toThrow(/^AUTH_PENDING/)
    expect(mockGetSession).toHaveBeenCalledTimes(1)
  })

  it('re-checks fresh after settle so React Query retries can succeed', async () => {
    mockGetSession.mockResolvedValueOnce(NO_SESSION)
    const { assertClientSession } = await freshModule()

    await expect(assertClientSession()).rejects.toThrow(/^AUTH_PENDING/)

    mockGetSession.mockResolvedValueOnce(SESSION)
    await expect(assertClientSession()).resolves.toBeUndefined()
    expect(mockGetSession).toHaveBeenCalledTimes(2)
  })
})
