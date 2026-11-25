import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobHandler } from '@/app/lib/jobs/types'

const mocks = vi.hoisted(() => ({
  register: vi.fn(),
  direct: vi.fn(),
  rpc: vi.fn(),
  capture: vi.fn(),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  }
}))

vi.mock('@/app/lib/jobs/dispatcher', () => ({
  registerJobHandler: mocks.register
}))
vi.mock('@/app/lib/network/direct-supabase', () => ({
  createDirectClient: mocks.direct
}))
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => mocks.logger
}))
vi.mock('@/app/lib/monitoring/sentry', () => ({
  captureSentryException: mocks.capture
}))

import { registerRefreshExploreSnapshotsHandler } from '@/app/lib/jobs/refresh-explore-snapshots'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.direct.mockReturnValue({ rpc: mocks.rpc })
})
afterEach(() => vi.unstubAllEnvs())

function handler(): JobHandler {
  registerRefreshExploreSnapshotsHandler()
  expect(mocks.register).toHaveBeenCalledWith(
    'refresh-explore-snapshots',
    expect.any(Function)
  )
  return mocks.register.mock.calls[0][1]
}

const context = { jobId: 1, workerId: 'synthetic-worker', attempts: 1 }

describe('refresh-explore-snapshots handler', () => {
  it('returns ok with the RPC result on success', async () => {
    mocks.rpc.mockResolvedValue({ data: { refreshed: 3 }, error: null })

    const result = await handler()({}, context)

    expect(mocks.rpc).toHaveBeenCalledWith(
      'manual_refresh_guild_snapshots',
      {},
      { signal: undefined }
    )
    expect(result).toEqual({
      status: 'ok',
      durationMs: expect.any(Number),
      result: { refreshed: 3 }
    })
    expect(mocks.capture).not.toHaveBeenCalled()
  })

  it('serializes a string RPC error and preserves it as the cause', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: 'HTTP 500: upstream' })

    const err = await handler()({}, context).then(
      () => {
        throw new Error('expected the handler to reject')
      },
      (error: unknown) => error
    )

    expect((err as Error).message).toBe(
      'Failed to refresh explore snapshots: HTTP 500: upstream'
    )
    expect((err as Error).cause).toBe('HTTP 500: upstream')
    expect(mocks.capture).toHaveBeenCalledTimes(1)
  })

  it('serializes an Error RPC error via coerceErrorMessage', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: new Error('boom') })

    const err = await handler()({}, context).then(
      () => {
        throw new Error('expected the handler to reject')
      },
      (error: unknown) => error
    )

    expect((err as Error).message).toBe(
      'Failed to refresh explore snapshots: boom'
    )
    expect(mocks.capture).toHaveBeenCalledTimes(1)
    expect(mocks.logger.error).toHaveBeenCalledTimes(1)
    expect(mocks.logger.warn).not.toHaveBeenCalled()
  })

  it.each([
    ['a 504 gateway timeout', 'HTTP 504: gateway timeout'],
    ['a statement timeout', 'canceling statement due to statement timeout'],
    ['an httpFetch request timeout', 'httpFetch: request timed out after 120s']
  ])(
    'logs a warning instead of reporting %s and still rethrows',
    async (_label, rpcError) => {
      mocks.rpc.mockResolvedValue({ data: null, error: rpcError })

      const err = await handler()({}, context).then(
        () => {
          throw new Error('expected the handler to reject')
        },
        (error: unknown) => error
      )

      expect((err as Error).message).toBe(
        `Failed to refresh explore snapshots: ${rpcError}`
      )
      expect((err as Error).cause).toBe(rpcError)
      expect(mocks.capture).not.toHaveBeenCalled()
      expect(mocks.logger.error).not.toHaveBeenCalled()
      expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
    }
  )

  it.each([
    ['An AbortError cause', new DOMException('aborted', 'AbortError')],
    ['A TimeoutError cause', new DOMException('timed out', 'TimeoutError')]
  ])('treats %s as transient and still rethrows', async (_label, cause) => {
    mocks.rpc.mockResolvedValue({ data: null, error: cause })

    const err = await handler()({}, context).then(
      () => {
        throw new Error('expected the handler to reject')
      },
      (error: unknown) => error
    )

    expect(err).toBeInstanceOf(Error)
    expect(mocks.capture).not.toHaveBeenCalled()
    expect(mocks.logger.error).not.toHaveBeenCalled()
    expect(mocks.logger.warn).toHaveBeenCalledTimes(1)
  })

  it('passes the tick signal to the RPC and aborts a cancelled job early', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Synthetic cancellation'))

    await expect(
      handler()({}, { ...context, signal: controller.signal })
    ).rejects.toThrow('Synthetic cancellation')
    expect(mocks.direct).not.toHaveBeenCalled()
  })
})
