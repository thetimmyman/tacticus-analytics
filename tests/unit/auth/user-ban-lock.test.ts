import { describe, expect, it, vi } from 'vitest'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

vi.unmock('@/app/lib/auth/user-ban-lock')

import {
  UserBanLockLostError,
  UserBanOperationInProgressError,
  withUserBanLock,
  withUserBanLocksAfterLeaseLoss
} from '@/app/lib/auth/user-ban-lock'

const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function lockClient(
  insertError: unknown = null,
  renewalResult: { data: unknown; error: unknown } = {
    data: { lock_id: 'owned' },
    error: null
  }
) {
  const cleanup = {
    eq: vi.fn().mockReturnThis(),
    lt: vi.fn().mockResolvedValue({ error: null })
  }
  const release = {
    eq: vi.fn().mockReturnThis(),
    then: (resolve: (value: unknown) => unknown) =>
      Promise.resolve({ error: null }).then(resolve)
  }
  const renewal = {
    eq: vi.fn().mockReturnThis(),
    gt: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue(renewalResult)
  }
  const table = {
    delete: vi.fn().mockReturnValueOnce(cleanup).mockReturnValueOnce(release),
    insert: vi.fn().mockResolvedValue({ error: insertError }),
    update: vi.fn().mockReturnValue(renewal)
  }
  const client = {
    from: vi.fn().mockReturnValue(table)
  } as unknown as TypedSupabaseClient
  return { client, table, cleanup, release, renewal }
}

describe('user ban mutation lock', () => {
  it('holds the per-user lock through the operation and releases it', async () => {
    const { client, table, release } = lockClient()
    const operation = vi.fn().mockResolvedValue('done')

    await expect(
      withUserBanLock(client, USER_ID.toUpperCase(), operation)
    ).resolves.toBe('done')
    expect(operation).toHaveBeenCalledOnce()
    expect(table.insert).toHaveBeenCalledWith(
      expect.objectContaining({ lock_key: `user_ban_${USER_ID}` })
    )
    expect(release.eq).toHaveBeenCalledWith('lock_key', `user_ban_${USER_ID}`)
    expect(release.eq).toHaveBeenCalledWith('lock_id', expect.any(String))
  })

  it('rejects a concurrent operation when the lock key already exists', async () => {
    const { client } = lockClient({ code: '23505', message: 'duplicate key' })
    const operation = vi.fn()

    await expect(
      withUserBanLock(client, USER_ID, operation)
    ).rejects.toBeInstanceOf(UserBanOperationInProgressError)
    expect(operation).not.toHaveBeenCalled()
  })

  it('renews a long-running operation before the fixed lease can expire', async () => {
    vi.useFakeTimers()
    try {
      const { client, table } = lockClient()
      let finishOperation!: () => void
      const operationDone = new Promise<void>((resolve) => {
        finishOperation = resolve
      })

      const operation = withUserBanLock(client, USER_ID, async () => {
        await operationDone
        return 'done'
      })

      await vi.advanceTimersByTimeAsync(30_001)
      expect(table.update).toHaveBeenCalled()
      finishOperation()
      await expect(operation).resolves.toBe('done')
    } finally {
      vi.useRealTimers()
    }
  })

  it('stops renewing a stuck operation when its abort signal fires', async () => {
    vi.useFakeTimers()
    try {
      const { client, table } = lockClient()
      const controller = new AbortController()
      let finishOperation!: () => void
      const operationDone = new Promise<void>((resolve) => {
        finishOperation = resolve
      })

      const operation = withUserBanLock(
        client,
        USER_ID,
        async () => {
          await operationDone
          return 'late-result'
        },
        controller.signal
      )

      await vi.advanceTimersByTimeAsync(30_001)
      expect(table.update).toHaveBeenCalledTimes(1)
      controller.abort(new Error('worker deadline'))
      await vi.advanceTimersByTimeAsync(60_000)
      expect(table.update).toHaveBeenCalledTimes(1)

      finishOperation()
      await expect(operation).rejects.toThrow('worker deadline')
    } finally {
      vi.useRealTimers()
    }
  })

  it('fails closed when the renewed row no longer belongs to this operation', async () => {
    const { client } = lockClient(null, { data: null, error: null })

    await expect(
      withUserBanLock(client, USER_ID, async (lease) => {
        await lease.assertHeld()
        return 'unreachable'
      })
    ).rejects.toBeInstanceOf(UserBanLockLostError)
  })

  it('treats renewal database failures as uncertain lease ownership', async () => {
    const { client } = lockClient(null, {
      data: null,
      error: { message: 'connection reset after update' }
    })

    await expect(
      withUserBanLock(client, USER_ID, async (lease) => {
        await lease.assertHeld()
        return 'unreachable'
      })
    ).rejects.toMatchObject({
      name: 'UserBanLockLostError',
      message: expect.stringContaining('ownership is uncertain')
    })
  })

  it('treats rejected renewal requests as uncertain lease ownership', async () => {
    const { client, renewal } = lockClient()
    renewal.maybeSingle.mockRejectedValueOnce(
      new Error('transport disconnected')
    )

    await expect(
      withUserBanLock(client, USER_ID, async (lease) => {
        await lease.assertHeld()
        return 'unreachable'
      })
    ).rejects.toMatchObject({
      name: 'UserBanLockLostError',
      message: expect.stringContaining('ownership is uncertain')
    })
  })

  it('does not let an operation error mask concurrent lease loss', async () => {
    const { client } = lockClient(null, { data: null, error: null })

    await expect(
      withUserBanLock(client, USER_ID, async () => {
        throw new Error('write response was lost')
      })
    ).rejects.toBeInstanceOf(UserBanLockLostError)
  })

  it('rejects non-UUID user identifiers before deriving a lock key', async () => {
    const { client, table } = lockClient()

    await expect(
      withUserBanLock(client, 'not-a-user-uuid', async () => undefined)
    ).rejects.toThrow('A valid auth user ID is required')
    expect(table.insert).not.toHaveBeenCalled()
  })

  it('waits for a successor lock before running lost-lease compensation', async () => {
    vi.useFakeTimers()
    try {
      const { client, table, cleanup, release } = lockClient()
      table.delete
        .mockReset()
        .mockReturnValueOnce(cleanup)
        .mockReturnValueOnce(cleanup)
        .mockReturnValueOnce(release)
      table.insert
        .mockResolvedValueOnce({
          error: { code: '23505', message: 'successor still owns lock' }
        })
        .mockResolvedValueOnce({ error: null })
      const operation = vi.fn().mockResolvedValue('reconciled')

      const result = withUserBanLocksAfterLeaseLoss(
        client,
        [USER_ID],
        operation
      )
      await vi.advanceTimersByTimeAsync(251)

      await expect(result).resolves.toBe('reconciled')
      expect(table.insert).toHaveBeenCalledTimes(2)
      expect(operation).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reacquires and retries when the compensation lease is also lost', async () => {
    vi.useFakeTimers()
    try {
      const { client, table, cleanup, release, renewal } = lockClient()
      table.delete
        .mockReset()
        .mockReturnValueOnce(cleanup)
        .mockReturnValueOnce(release)
        .mockReturnValueOnce(cleanup)
        .mockReturnValueOnce(release)
      table.insert.mockResolvedValue({ error: null })
      renewal.maybeSingle
        .mockRejectedValueOnce(new UserBanLockLostError())
        .mockResolvedValue({ data: { lock_id: 'owned' }, error: null })
      const operation = vi.fn(
        async (leases: Array<{ assertHeld: () => Promise<void> }>) => {
          await leases[0]!.assertHeld()
          return 'reconciled'
        }
      )

      const result = withUserBanLocksAfterLeaseLoss(
        client,
        [USER_ID],
        operation
      )
      await vi.advanceTimersByTimeAsync(251)

      await expect(result).resolves.toBe('reconciled')
      expect(table.insert).toHaveBeenCalledTimes(2)
      expect(operation).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps failed reconciliation pending until a retry succeeds', async () => {
    vi.useFakeTimers()
    try {
      const { client, table, cleanup, release } = lockClient()
      table.delete
        .mockReset()
        .mockReturnValueOnce(cleanup)
        .mockReturnValueOnce(release)
        .mockReturnValueOnce(cleanup)
        .mockReturnValueOnce(release)
      table.insert.mockResolvedValue({ error: null })
      const operation = vi
        .fn()
        .mockRejectedValueOnce(new Error('GoTrue unavailable'))
        .mockResolvedValueOnce('reconciled')

      const result = withUserBanLocksAfterLeaseLoss(
        client,
        [USER_ID],
        operation
      )
      await vi.advanceTimersByTimeAsync(251)

      await expect(result).resolves.toBe('reconciled')
      expect(operation).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
