import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGuildData } from './useGuildData'

const { fromMock, rpcMock, channelMock } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  rpcMock: vi.fn(),
  channelMock: vi.fn()
}))

vi.mock('@/app/lib/db/client', () => ({
  dbClient: () => ({
    from: fromMock,
    rpc: rpcMock,
    channel: channelMock
  })
}))

vi.mock('@/app/lib/logging/client', () => ({
  createComponentLogger: () => ({
    debug: vi.fn(),
    error: vi.fn()
  })
}))

describe('useGuildData snapshot refresh boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    fromMock.mockImplementation((table: string) => {
      if (table === 'public_guild_snapshots_explore') {
        return {
          select: vi.fn(() => ({
            order: vi.fn(() => ({
              limit: vi.fn().mockResolvedValue({ data: [], error: null })
            }))
          }))
        }
      }

      if (table === 'guild_config') {
        return {
          select: vi.fn().mockResolvedValue({ data: [], error: null })
        }
      }

      throw new Error(`Unexpected table query: ${table}`)
    })
  })

  it('does not invoke the refresh RPC when the initial snapshot query is empty', async () => {
    const { result } = renderHook(() => useGuildData())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(fromMock).toHaveBeenCalledWith('public_guild_snapshots_explore')
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('manually refreshes by re-fetching snapshots without invoking the refresh RPC', async () => {
    const { result } = renderHook(() => useGuildData())

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(
      fromMock.mock.calls.filter(
        ([table]) => table === 'public_guild_snapshots_explore'
      )
    ).toHaveLength(1)

    await act(async () => {
      await result.current.handleManualRefresh()
    })

    expect(
      fromMock.mock.calls.filter(
        ([table]) => table === 'public_guild_snapshots_explore'
      )
    ).toHaveLength(2)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('does not open a Realtime channel for cron-owned snapshots', async () => {
    const { result } = renderHook(() => useGuildData())

    await waitFor(() => expect(result.current.loading).toBe(false))

    expect(channelMock).not.toHaveBeenCalled()
  })
})
