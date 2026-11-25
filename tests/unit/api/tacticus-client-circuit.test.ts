import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mockFetch = vi.fn()

const mockLogger = vi.hoisted(() => ({
  log: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  info: vi.fn()
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => mockLogger
}))

vi.mock('@tacticus/app-core/app-config', () => ({
  TACTICUS_API: {
    BASE_URL: 'https://api.tacticus.test'
  }
}))

describe('TacticusAPIClient circuit isolation for caller-capped timeouts', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    mockFetch.mockReset()
    vi.stubGlobal('fetch', mockFetch)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('does not open the shared tacticus-api circuit on caller-capped batch timeouts', async () => {
    // 5 slow calls exceed the 40ms batch cap, then the 6th responds immediately.
    let call = 0
    mockFetch.mockImplementation((_url: string, init?: RequestInit) => {
      call += 1
      if (call <= 5) {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(
              init.signal?.reason ?? new DOMException('Aborted', 'TimeoutError')
            )
          })
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          player: { details: { name: 'SyntheticPlayer', powerLevel: 1000 } }
        })
      })
    })

    const { TacticusAPIClient, TACTICUS_CIRCUIT_NAME } =
      await import('@/app/lib/api/tacticus-client')
    const { circuitRegistry } = await import('@/app/lib/resilience')
    const client = new TacticusAPIClient()

    for (let i = 0; i < 5; i++) {
      const res = await client.getPlayerWithRetry('synthetic-key', {
        timeoutMs: 40,
        maxRetries: 0
      })
      expect(res).toBeNull()
    }

    // Circuit must still be CLOSED and allow the 6th call through.
    const next = await client.getPlayerWithRetry('synthetic-key', {
      timeoutMs: 500,
      maxRetries: 0
    })
    expect(next?.details.name).toBe('SyntheticPlayer')
    expect(mockFetch).toHaveBeenCalledTimes(6)
    await vi.waitFor(() =>
      expect(circuitRegistry.get(TACTICUS_CIRCUIT_NAME)?.getState()).toBe(
        'CLOSED'
      )
    )
  })

  it('still opens the shared tacticus-api circuit on repeated upstream 5xx errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      body: { cancel: vi.fn().mockResolvedValue(undefined) }
    })

    const { TacticusAPIClient } = await import('@/app/lib/api/tacticus-client')
    const client = new TacticusAPIClient()

    for (let i = 0; i < 5; i++) {
      const res = await client.getPlayerWithRetry('synthetic-key', {
        timeoutMs: 3000,
        maxRetries: 0
      })
      expect(res).toBeNull()
    }

    // 6th call is rejected by the OPEN circuit without calling fetch again.
    const blocked = await client.getPlayerWithRetry('synthetic-key', {
      timeoutMs: 3000,
      maxRetries: 0
    })
    expect(blocked).toBeNull()
    expect(mockFetch).toHaveBeenCalledTimes(5)
  })
})
