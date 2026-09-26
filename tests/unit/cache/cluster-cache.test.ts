import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Cluster context lives in the shared appCache; one fake store stands in for Redis on every replica. */
const store = vi.hoisted(() => new Map<string, unknown>())

vi.mock('@tacticus/app-core/app-cache', () => ({
  appCache: {
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value)
    }),
    del: vi.fn(async (key: string) => {
      store.delete(key)
    })
  }
}))

import {
  getCachedClusterContext,
  invalidateClusterCache
} from '@tacticus/app-core/cluster-cache'

describe('cluster cache', () => {
  beforeEach(() => {
    store.clear()
    vi.clearAllMocks()
  })

  it('returns cluster context with nullable cluster code and caches result', async () => {
    const fetchContext = vi.fn(async () => ({
      guild_code: 'IW',
      cluster_code: null,
      role: 'officer'
    }))

    const context = await getCachedClusterContext('user-1', fetchContext)
    expect(context).not.toBeNull()
    expect(context?.clusterCode).toBeNull()
    expect(fetchContext).toHaveBeenCalledTimes(1)

    const cached = await getCachedClusterContext('user-1', fetchContext)
    expect(cached).not.toBeNull()
    expect(fetchContext).toHaveBeenCalledTimes(1)
  })

  it('returns null when lookup fails', async () => {
    const fetchContext = vi.fn(async () => null)

    const context = await getCachedClusterContext('user-2', fetchContext)
    expect(context).toBeNull()
    expect(fetchContext).toHaveBeenCalledTimes(1)
  })

  it('invalidation reaches a replica that did not handle the move', async () => {
    const oldScope = vi.fn(async () => ({
      guild_code: 'OLD1',
      cluster_code: 'C1',
      role: 'member'
    }))
    await getCachedClusterContext('user-3', oldScope)
    expect(oldScope).toHaveBeenCalledTimes(1)

    await invalidateClusterCache('user-3')

    const newScope = vi.fn(async () => ({
      guild_code: 'NEW1',
      cluster_code: 'C2',
      role: 'leader'
    }))
    const context = await getCachedClusterContext('user-3', newScope)
    expect(newScope).toHaveBeenCalledTimes(1)
    expect(context?.guildCode).toBe('NEW1')
  })

  it('never throws when the shared cache is unreachable', async () => {
    const { appCache } = await import('@tacticus/app-core/app-cache')
    vi.mocked(appCache.del).mockRejectedValueOnce(new Error('redis down'))

    await expect(invalidateClusterCache('user-4')).resolves.toBeUndefined()
  })
})
