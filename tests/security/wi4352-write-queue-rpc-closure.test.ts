import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: () => ({
    rpc: mocks.rpc,
    from: mocks.from
  })
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => mocks.logger
}))

vi.mock('@/app/lib/resilience', () => ({
  circuitRegistry: {
    getState: () => 'CLOSED'
  }
}))

import { withWriteQueue, writeQueue } from '@/app/lib/db/write-queue'

describe('WI-4352 P1A generic RPC queue closure', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('preserves ordinary table-write enqueue behavior', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: 'queued-job-id', error: null })

    const result = await withWriteQueue(
      'insert',
      'user_preferences',
      { user_id: 'user-1', theme: 'dark' },
      async () => {
        throw new Error('database unavailable')
      }
    )

    expect(result).toEqual({ success: false, queued: true })
    expect(mocks.rpc).toHaveBeenCalledWith(
      'enqueue_write',
      expect.objectContaining({
        p_operation_type: 'insert',
        p_target_table: 'user_preferences',
        p_payload: { user_id: 'user-1', theme: 'dark' }
      })
    )
  })

  it('still processes a queued table insert', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    mocks.from.mockReturnValue({ insert })
    mocks.rpc
      .mockResolvedValueOnce({
        data: {
          id: 'job-1',
          operation_type: 'insert',
          target_table: 'user_preferences',
          payload: { user_id: 'user-1', theme: 'dark' }
        },
        error: null
      })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: null })

    await expect(writeQueue.processQueue(undefined, 2)).resolves.toEqual({
      processed: 1,
      failed: 0
    })
    expect(mocks.from).toHaveBeenCalledWith('user_preferences')
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-1',
      theme: 'dark'
    })
  })

  it('fails a legacy RPC job without dispatching its stored name', async () => {
    mocks.rpc
      .mockResolvedValueOnce({
        data: {
          id: 'job-rpc',
          operation_type: 'rpc',
          target_table: 'rpc',
          rpc_name: 'dangerous_dynamic_target',
          rpc_params: { p_scope: 'all' },
          payload: {}
        },
        error: null
      })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: null, error: null })

    await expect(writeQueue.processQueue(undefined, 2)).resolves.toEqual({
      processed: 0,
      failed: 1
    })
    expect(mocks.rpc).not.toHaveBeenCalledWith(
      'dangerous_dynamic_target',
      expect.anything()
    )
    expect(mocks.from).not.toHaveBeenCalled()
  })
})
