/** @vitest-environment happy-dom */
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ClusterGuildSummary,
  ClusterSummary
} from '@tacticus/app-core/onboarding.types'
import { useClusterOnboarding } from '@/app/(public)/onboarding/dashboard/useClusterOnboarding'

const toast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  warning: vi.fn()
}))

vi.mock('@/app/hooks/useToast', () => ({ useToast: () => ({ toast }) }))

const cluster: ClusterSummary = {
  id: 'cluster-1',
  cluster_code: 'EOT',
  display_name: 'Example Guild',
  description: null,
  onboarding_completed: false
}
const guild: ClusterGuildSummary = {
  guild_code: 'ALPHA',
  display_name: 'Alpha Guild',
  enabled: true,
  onboarding_completed: true,
  job: null
}

function response(payload: unknown = {}) {
  return { ok: true, json: async () => payload } as Response
}

function setup(activeCluster: ClusterSummary | null, guilds = [guild]) {
  const setPendingAction = vi.fn()
  const refreshProgress = vi.fn(async () => undefined)
  const rendered = renderHook(() =>
    useClusterOnboarding({
      cluster: activeCluster,
      clusterGuilds: guilds,
      pendingAction: null,
      setPendingAction,
      refreshProgress
    })
  )
  return { ...rendered, setPendingAction, refreshProgress }
}

describe('useClusterOnboarding', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response())
    )
  })

  it('creates a cluster and refreshes progress', async () => {
    const { result, setPendingAction, refreshProgress } = setup(null, [])
    act(() => {
      result.current.setClusterForm({
        name: 'Example Guild',
        code: 'eot',
        description: 'Raid cluster'
      })
    })
    await act(() => result.current.handleCreateCluster())

    expect(fetch).toHaveBeenCalledWith(
      '/api/clusters/create-cluster',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          cluster_code: 'EOT',
          display_name: 'Example Guild',
          description: 'Raid cluster',
          primary_language: 'en',
          time_zone: 'UTC'
        })
      })
    )
    expect(setPendingAction).toHaveBeenNthCalledWith(1, 'cluster_create')
    expect(setPendingAction).toHaveBeenLastCalledWith(null)
    expect(refreshProgress).toHaveBeenCalledWith(true)
  })

  it('adds a guild with its API key and clears the form', async () => {
    const { result, setPendingAction, refreshProgress } = setup(cluster, [])
    act(() => {
      result.current.setClusterGuildForm({
        code: 'beta',
        name: 'Beta Guild',
        apiKey: 'secret-key'
      })
    })
    await act(() => result.current.handleAddClusterGuild())

    expect(fetch).toHaveBeenCalledWith(
      '/api/onboarding/cluster/add-guild',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          clusterCode: 'EOT',
          guildCode: 'BETA',
          guildName: 'Beta Guild',
          apiKey: 'secret-key'
        })
      })
    )
    expect(result.current.clusterGuildForm).toEqual({
      code: '',
      name: '',
      apiKey: ''
    })
    expect(setPendingAction).toHaveBeenNthCalledWith(1, 'cluster_guild')
    expect(refreshProgress).toHaveBeenCalledWith(true)
  })

  it('requeues the selected guild and reports its display label', async () => {
    const { result, setPendingAction, refreshProgress } = setup(cluster)
    await act(() => result.current.handleRequeueClusterGuild('ALPHA'))

    expect(fetch).toHaveBeenCalledWith(
      '/api/onboarding/cluster/requeue-guild',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ clusterCode: 'EOT', guildCode: 'ALPHA' })
      })
    )
    expect(toast.success).toHaveBeenCalledWith(
      'Sync queued',
      expect.stringContaining('Alpha Guild')
    )
    expect(setPendingAction).toHaveBeenNthCalledWith(1, 'cluster_requeue')
    expect(setPendingAction).toHaveBeenLastCalledWith(null)
    expect(refreshProgress).toHaveBeenCalledWith(true)
    expect(result.current.clusterRequeueTarget).toBeNull()
  })
})
