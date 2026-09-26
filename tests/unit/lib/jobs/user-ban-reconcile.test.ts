import { afterEach, describe, expect, it, vi } from 'vitest'

const USER_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const USER_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const mocks = vi.hoisted(() => ({
  serviceDb: vi.fn(),
  enqueueUserBanReconciliation: vi.fn(),
  reconcileUserBanState: vi.fn(),
  registerJobHandler: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({ serviceDb: mocks.serviceDb }))
vi.mock('@/app/lib/auth/user-ban-reconciliation', () => ({
  USER_BAN_RECONCILIATION_JOB_TYPE: 'user-ban-reconcile',
  enqueueUserBanReconciliation: mocks.enqueueUserBanReconciliation,
  parseUserBanReconciliationPayload: (payload: Record<string, unknown>) =>
    payload,
  reconcileUserBanState: mocks.reconcileUserBanState
}))
vi.mock('@/app/lib/jobs/dispatcher', () => ({
  registerJobHandler: mocks.registerJobHandler
}))

import { __internal } from '@/app/lib/jobs/user-ban-reconcile'

describe('user-ban reconciliation job', () => {
  afterEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
  })

  it('splits a legacy multi-user payload into durable per-user jobs', async () => {
    const supabase = {}
    mocks.serviceDb.mockReturnValue(supabase)
    mocks.enqueueUserBanReconciliation.mockResolvedValue('dedupe-key')

    await expect(
      __internal.userBanReconcileHandler(
        {
          lockUserIds: [USER_A, USER_B],
          adminCandidateUserIds: [USER_A],
          credentialUserIds: [USER_B]
        },
        {
          jobId: 7,
          workerId: 'verify-worker',
          attempts: 1,
          softDeadlineAt: Date.now() + 10_000
        }
      )
    ).resolves.toEqual({
      status: 'split',
      jobsEnqueued: 2
    })

    expect(mocks.enqueueUserBanReconciliation).toHaveBeenCalledWith(supabase, {
      lockUserIds: [USER_A, USER_B],
      adminCandidateUserIds: [USER_A],
      credentialUserIds: [USER_B]
    })
    expect(mocks.reconcileUserBanState).not.toHaveBeenCalled()
  })

  it('reports the complete outcome of one independently retryable user', async () => {
    const supabase = {}
    mocks.serviceDb.mockReturnValue(supabase)
    mocks.reconcileUserBanState.mockResolvedValue({
      adminsRevoked: 1,
      credentialsReconciled: 1
    })

    await expect(
      __internal.userBanReconcileHandler(
        {
          lockUserIds: [USER_A],
          adminCandidateUserIds: [USER_A],
          credentialUserIds: [USER_A]
        },
        {
          jobId: 8,
          workerId: 'verify-worker',
          attempts: 1,
          softDeadlineAt: Date.now() + 10_000
        }
      )
    ).resolves.toEqual({
      status: 'reconciled',
      adminsRevoked: 1,
      credentialsReconciled: 1
    })
  })

  it('times out a user safely within the worker deadline', async () => {
    vi.useFakeTimers()
    mocks.serviceDb.mockReturnValue({})
    mocks.reconcileUserBanState.mockImplementation(
      (_lockClient, _payload, options: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          options.signal.addEventListener(
            'abort',
            () => reject(options.signal.reason),
            { once: true }
          )
        )
    )

    const operation = __internal.userBanReconcileHandler(
      {
        lockUserIds: [USER_A],
        adminCandidateUserIds: [],
        credentialUserIds: [USER_A]
      },
      {
        jobId: 8,
        workerId: 'verify-worker',
        attempts: 1,
        softDeadlineAt: Date.now() + 1_000
      }
    )

    const rejection = expect(operation).rejects.toThrow(
      'ban reconciliation user step'
    )
    await vi.advanceTimersByTimeAsync(1_000)
    await rejection
    const options = mocks.reconcileUserBanState.mock.calls[0]?.[2] as {
      signal: AbortSignal
    }
    expect(options.signal.aborted).toBe(true)
    expect(mocks.serviceDb).toHaveBeenCalledWith(expect.any(AbortSignal))
  })

  it('propagates scheduler abort and awaits underlying lock cleanup before rejecting', async () => {
    const parent = new AbortController()
    let releaseCleanup: (() => void) | undefined
    const cleanup = new Promise<void>((resolve) => {
      releaseCleanup = resolve
    })
    let operationSignal: AbortSignal | undefined
    mocks.serviceDb.mockImplementation((signal?: AbortSignal) => ({ signal }))
    mocks.reconcileUserBanState.mockImplementation(
      async (_lockClient, _payload, options: { signal: AbortSignal }) => {
        operationSignal = options.signal
        await new Promise<void>((resolve) =>
          options.signal.addEventListener('abort', () => resolve(), {
            once: true
          })
        )
        await cleanup
        throw options.signal.reason
      }
    )

    let settled = false
    const operation = __internal
      .userBanReconcileHandler(
        {
          lockUserIds: [USER_A],
          adminCandidateUserIds: [],
          credentialUserIds: [USER_A]
        },
        {
          jobId: 9,
          workerId: 'verify-worker',
          attempts: 1,
          softDeadlineAt: Date.now() + 10_000,
          signal: parent.signal
        }
      )
      .finally(() => {
        settled = true
      })

    parent.abort(new Error('scheduled verify worker timed out'))
    await Promise.resolve()
    expect(operationSignal?.aborted).toBe(true)
    expect(settled).toBe(false)

    releaseCleanup?.()
    await expect(operation).rejects.toThrow('scheduled verify worker timed out')
    expect(settled).toBe(true)
    expect(mocks.serviceDb).toHaveBeenNthCalledWith(1)
    expect(mocks.serviceDb).toHaveBeenNthCalledWith(2, operationSignal)
  })

  it('propagates scheduler abort through legacy split enqueue settlement', async () => {
    const parent = new AbortController()
    let enqueueSignal: AbortSignal | undefined
    mocks.serviceDb.mockImplementation((signal?: AbortSignal) => ({ signal }))
    mocks.enqueueUserBanReconciliation.mockImplementation(
      (_client: { signal?: AbortSignal }) => {
        enqueueSignal = _client.signal
        return new Promise((_resolve, reject) =>
          enqueueSignal?.addEventListener(
            'abort',
            () => reject(enqueueSignal?.reason),
            { once: true }
          )
        )
      }
    )

    const operation = __internal.userBanReconcileHandler(
      {
        lockUserIds: [USER_A, USER_B],
        adminCandidateUserIds: [],
        credentialUserIds: []
      },
      {
        jobId: 10,
        workerId: 'verify-worker',
        attempts: 1,
        softDeadlineAt: Date.now() + 10_000,
        signal: parent.signal
      }
    )
    parent.abort(new Error('scheduled verify worker timed out'))

    await expect(operation).rejects.toThrow('scheduled verify worker timed out')
    expect(enqueueSignal?.aborted).toBe(true)
  })
})
