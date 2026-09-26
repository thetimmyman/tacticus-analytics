import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { Providers } from '@/app/providers'

const session = vi.hoisted(() => ({ userId: null as string | null }))

vi.mock('@/app/hooks/useClusterContext', () => ({
  useClusterContext: () => ({
    guildCode: session.userId ? 'GUILD' : '',
    clusterCode: null,
    isLoading: false,
    userId: session.userId,
    role: null,
    displayName: null,
    themePreference: null
  }),
  useGuildCode: () => (session.userId ? 'GUILD' : '')
}))

vi.mock('@/app/contexts/ServiceHealthContext', () => ({
  ServiceHealthProvider: ({ children }: { children: React.ReactNode }) =>
    children
}))

vi.mock('@/app/components/status/ServiceHealthBanner', () => ({
  ServiceHealthBanner: () => null
}))

vi.mock('@/app/components/seasonal', () => ({
  WinterThemeProvider: ({ children }: { children: React.ReactNode }) =>
    children,
  BossEasterEggProvider: ({ children }: { children: React.ReactNode }) =>
    children
}))

function PageEffectProbe({ onMount }: { onMount: () => void }) {
  useEffect(() => onMount(), [onMount])
  return <div>public page</div>
}

function mockFetch() {
  const fetchMock = vi.fn(async (_input: RequestInfo | URL) => ({
    ok: true,
    status: 200,
    json: async () => ({ feeds: [] })
  }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

async function flushProviderEffects(onMount = vi.fn()) {
  render(
    <Providers>
      <PageEffectProbe onMount={onMount} />
    </Providers>
  )

  await waitFor(() => expect(onMount).toHaveBeenCalledOnce())
  await act(async () => {
    await Promise.resolve()
  })
}

describe('Providers sync status session gate', () => {
  beforeEach(() => {
    session.userId = null
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not mount the sync panel or fetch freshness without a session', async () => {
    const fetchMock = mockFetch()

    await flushProviderEffects()

    expect(
      fetchMock.mock.calls.filter(([url]) => url === '/api/sync/freshness')
    ).toHaveLength(0)
    expect(screen.queryByText('SYS')).not.toBeInTheDocument()
  })

  it('mounts the sync panel and fetches freshness with a session', async () => {
    session.userId = 'user-1'
    const fetchMock = mockFetch()

    await flushProviderEffects()

    expect(await screen.findByText('SYS')).toBeInTheDocument()
    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        '/api/sync/freshness',
        expect.objectContaining({
          credentials: 'include',
          signal: expect.any(AbortSignal)
        })
      )
    )
  })
})
