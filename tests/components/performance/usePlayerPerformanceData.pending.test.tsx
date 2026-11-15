import type { PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePlayerPerformanceData } from '@/app/components/performance/hooks/usePlayerPerformanceData'

vi.mock('@/app/lib/hooks/useDataContext', () => ({
  useDataContext: () => ({ context: { clusterCode: null }, loading: false })
}))

vi.mock('@/app/lib/db/client', () => {
  const pending = new Promise<never>(() => {})
  const request: unknown = new Proxy(
    {},
    {
      get: (_, key) =>
        key === 'then' ? pending.then.bind(pending) : () => request
    }
  )
  return {
    assertClientSession: async () => {},
    dbClient: () => ({ from: () => request, rpc: () => request })
  }
})

afterEach(() => vi.unstubAllGlobals())

describe('performance loading', () => {
  it('remains stable while membership and performance requests are pending', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<never>(() => {}))
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    }
    const { result, rerender, unmount } = renderHook(
      () =>
        usePlayerPerformanceData({
          selectedGuild: 'fixture-guild',
          selectedSeason: '1'
        }),
      { wrapper: Wrapper }
    )
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    rerender()
    expect(result.current.loading).toBe(true)
    unmount()
    client.clear()
  })

  it('remains stable across interactive state updates when guild selection is empty', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<never>(() => {}))
    )
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } }
    })
    function Wrapper({ children }: PropsWithChildren) {
      return (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      )
    }
    const { result, rerender, unmount } = renderHook(
      () =>
        usePlayerPerformanceData({
          selectedGuild: '',
          selectedSeason: '1'
        }),
      { wrapper: Wrapper }
    )
    await act(async () => {
      result.current.setCompareMode('cluster')
      result.current.setShowBossDetail(true)
    })
    rerender()
    expect(result.current.compareMode).toBe('cluster')
    expect(result.current.showBossDetail).toBe(true)
    unmount()
    client.clear()
  })
})
