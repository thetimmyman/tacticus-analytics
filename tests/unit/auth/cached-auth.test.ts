import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mockAppCache = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn()
}))

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn()
}))

vi.mock('@/app/lib/db', () => ({
  serviceDb: vi.fn()
}))

vi.mock('@tacticus/app-core/app-cache', () => ({
  appCache: mockAppCache
}))

vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: vi.fn(() => mockLogger)
}))

// getServerClusterContext uses a lean fetcher, so `api_key_encrypted` never enters Redis.
describe('Cached Auth', () => {
  let mockSupabaseClient: {
    from: ReturnType<typeof vi.fn>
  }
  let serviceDb: ReturnType<typeof vi.fn>

  const mockScopeRow = {
    guild_code: 'TEST',
    cluster_code: 'EOT',
    role: 'officer'
  }

  const mockScopeQuery = (
    data: typeof mockScopeRow | null,
    error: { message: string } | null = null
  ) => {
    mockSupabaseClient.from.mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data, error })
          })
        })
      })
    })
  }

  beforeEach(async () => {
    vi.resetModules()
    vi.clearAllMocks()

    mockSupabaseClient = {
      from: vi.fn()
    }

    const dbModule = await import('@/app/lib/db')
    serviceDb = vi.mocked(dbModule.serviceDb)
    serviceDb.mockReturnValue(mockSupabaseClient)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('getServerClusterContext', () => {
    it('serves from the shared cluster-context cache without hitting the DB', async () => {
      mockAppCache.get.mockResolvedValue({
        userId: 'user-123',
        guildCode: 'TEST',
        clusterCode: 'EOT',
        role: 'officer',
        timestamp: 1
      })

      const { getServerClusterContext } =
        await import('@/app/lib/auth/cached-auth')
      const result = await getServerClusterContext('user-123')

      expect(result).toEqual({ clusterCode: 'EOT', guildCode: 'TEST' })
      expect(mockAppCache.get).toHaveBeenCalledWith('cluster-context:user-123')
      expect(serviceDb).not.toHaveBeenCalled()
    })

    it('fetches scope columns on cache miss and writes the shared key', async () => {
      mockAppCache.get.mockResolvedValue(null)
      mockScopeQuery(mockScopeRow)

      const { getServerClusterContext } =
        await import('@/app/lib/auth/cached-auth')
      const result = await getServerClusterContext('user-123')

      expect(result).toEqual({ clusterCode: 'EOT', guildCode: 'TEST' })
      expect(serviceDb).toHaveBeenCalled()
      expect(mockAppCache.set).toHaveBeenCalledWith(
        'cluster-context:user-123',
        expect.objectContaining({
          userId: 'user-123',
          guildCode: 'TEST',
          clusterCode: 'EOT',
          role: 'officer'
        }),
        5 * 60
      )
      const selected = mockSupabaseClient.from.mock.results
        .map((r) => r.value.select.mock.calls)
        .flat()
        .join(' ')
      expect(selected).not.toContain('api_key_encrypted')
    })

    it('returns an empty scope when the row is missing', async () => {
      mockAppCache.get.mockResolvedValue(null)
      mockScopeQuery(null)

      const { getServerClusterContext } =
        await import('@/app/lib/auth/cached-auth')
      const result = await getServerClusterContext('user-123')

      expect(result).toEqual({ clusterCode: null, guildCode: '' })
    })

    it('returns an empty scope when the query errors', async () => {
      mockAppCache.get.mockResolvedValue(null)
      mockScopeQuery(null, { message: 'boom' })

      const { getServerClusterContext } =
        await import('@/app/lib/auth/cached-auth')
      const result = await getServerClusterContext('user-123')

      expect(result).toEqual({ clusterCode: null, guildCode: '' })
      expect(mockLogger.error).toHaveBeenCalled()
    })

    it('returns an empty scope when the cache layer throws', async () => {
      mockAppCache.get.mockRejectedValue(new Error('Cache error'))
      mockScopeQuery(null)

      const { getServerClusterContext } =
        await import('@/app/lib/auth/cached-auth')
      const result = await getServerClusterContext('user-123')

      expect(result).toEqual({ clusterCode: null, guildCode: '' })
    })
  })
})
