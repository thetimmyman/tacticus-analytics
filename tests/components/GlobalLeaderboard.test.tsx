import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { GlobalLeaderboard } from '@/app/components/homepage/GlobalLeaderboard'

const { rpcSpy, fromSpy } = vi.hoisted(() => ({
  rpcSpy: vi.fn(),
  fromSpy: vi.fn()
}))

vi.mock('@/app/lib/db/client', () => ({
  assertClientSession: vi.fn(),
  dbClient: () => ({ rpc: rpcSpy, from: fromSpy })
}))

function renderLeaderboard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } }
  })
  return render(
    <QueryClientProvider client={client}>
      <GlobalLeaderboard />
    </QueryClientProvider>
  )
}

describe('GlobalLeaderboard (WI-4660 anon boundary)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    rpcSpy.mockResolvedValue({
      data: [
        {
          rank: 1,
          display_name: 'TestPlayerA',
          guild_display_name: '[Demo] Alpha Guild',
          cluster_display_name: 'Example Alliance',
          battle_count: 42,
          total_damage: 41750000,
          avg_damage: 994048,
          max_damage: 2500000,
          performance_score: 98.4,
          is_obfuscated: true
        },
        {
          rank: 2,
          display_name: 'TestPlayerB',
          guild_display_name: '[TG] Test Guild',
          cluster_display_name: 'Test Cluster',
          battle_count: 40,
          total_damage: 36512345,
          avg_damage: 912809,
          max_damage: 2400000,
          performance_score: 97.1,
          is_obfuscated: false
        }
      ],
      error: null
    })
  })

  it('reads through the privacy-aware RPC, never the raw view', async () => {
    renderLeaderboard()

    await waitFor(() => expect(rpcSpy).toHaveBeenCalled())

    expect(rpcSpy).toHaveBeenCalledWith('get_public_global_leaderboard', {
      p_limit: 10
    })
    // global_leaderboard bypasses the privacy mode and carries the raw guild UUID.
    expect(fromSpy).not.toHaveBeenCalled()
  })

  it('marks obfuscated damage so it is not presented as exact', async () => {
    renderLeaderboard()

    const marked = await screen.findAllByText('~41.75M')
    expect(marked.length).toBeGreaterThan(0)

    const exact = await screen.findAllByText('36.51M')
    expect(exact.length).toBeGreaterThan(0)
    exact.forEach((node) => expect(node.textContent).not.toContain('~'))
  })

  it('renders no guild UUID anywhere in the output', async () => {
    const { container } = renderLeaderboard()

    await waitFor(() => expect(rpcSpy).toHaveBeenCalled())

    const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i
    expect(uuid.test(container.innerHTML)).toBe(false)
  })
})
