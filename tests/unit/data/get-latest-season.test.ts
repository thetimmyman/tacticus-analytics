import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react', async () => {
  const actual = await vi.importActual('react')
  return {
    ...actual,
    cache: (fn: Function) => fn
  }
})

vi.mock('@/app/lib/auth/server', () => ({
  createClient: vi.fn(),
  createServiceClient: vi.fn()
}))

vi.mock('@tacticus/app-core/logger', () => ({
  legacyConsoleLogger: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn()
  }
}))

describe('Get Latest Season Module', () => {
  type FallbackRow = { season_num: number | null }

  /** Resolves only through `.limit()`, so an unbounded scan fails loudly. */
  const mockManualSeasonQuery = (result: {
    data: FallbackRow[] | null
    error: Error | null
  }) => {
    const calls = {
      select: vi.fn(),
      order: vi.fn(),
      limit: vi.fn()
    }
    const builder = {
      select: (...args: unknown[]) => {
        calls.select(...args)
        return builder
      },
      order: (...args: unknown[]) => {
        calls.order(...args)
        return builder
      },
      limit: (...args: unknown[]) => {
        calls.limit(...args)
        return Promise.resolve(result)
      },
      then: () => {
        throw new Error(
          'unbounded query: EOT_GR_data fallback was awaited without .limit()'
        )
      }
    }
    return { builder, calls }
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  afterEach(() => {
    vi.resetAllMocks()
  })

  describe('getLatestSeason (cached)', () => {
    it('should call RPC through the service-role client (WI-4660)', async () => {
      const mockSupabase = {
        rpc: vi.fn().mockResolvedValue({ data: '86', error: null })
      }

      const { createServiceClient } = await import('@/app/lib/auth/server')
      vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)

      const { getLatestSeason } =
        await import('@/app/lib/data/get-latest-season')
      const result = await getLatestSeason()

      expect(result).toBe('86')
      expect(createServiceClient).toHaveBeenCalled()
    })

    it('should fallback to manual query when RPC fails', async () => {
      const { builder } = mockManualSeasonQuery({
        data: [{ season_num: 87 }],
        error: null
      })
      const mockSupabase = {
        rpc: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('No RPC') }),
        from: vi.fn().mockReturnValue(builder)
      }

      const { createServiceClient } = await import('@/app/lib/auth/server')
      vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)

      const { getLatestSeason } =
        await import('@/app/lib/data/get-latest-season')
      const result = await getLatestSeason()

      expect(result).toBe('87')
    })

    it('should return null when all queries fail', async () => {
      const { builder } = mockManualSeasonQuery({
        data: null,
        error: new Error('Query error')
      })
      const mockSupabase = {
        rpc: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('RPC error') }),
        from: vi.fn().mockReturnValue(builder)
      }

      const { createServiceClient } = await import('@/app/lib/auth/server')
      vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)

      const { getLatestSeason } =
        await import('@/app/lib/data/get-latest-season')
      const result = await getLatestSeason()

      expect(result).toBe(null)
    })

    it('should return null when the RPC fails and the table has no seasons', async () => {
      const { builder } = mockManualSeasonQuery({ data: [], error: null })
      const mockSupabase = {
        rpc: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('RPC error') }),
        from: vi.fn().mockReturnValue(builder)
      }

      const { createServiceClient } = await import('@/app/lib/auth/server')
      vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)

      const { getLatestSeason } =
        await import('@/app/lib/data/get-latest-season')

      expect(await getLatestSeason()).toBe(null)
    })

    it('should return null when the only row has a NULL season_num', async () => {
      const { builder } = mockManualSeasonQuery({
        data: [{ season_num: null }],
        error: null
      })
      const mockSupabase = {
        rpc: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('RPC error') }),
        from: vi.fn().mockReturnValue(builder)
      }

      const { createServiceClient } = await import('@/app/lib/auth/server')
      vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)

      const { getLatestSeason } =
        await import('@/app/lib/data/get-latest-season')

      expect(await getLatestSeason()).toBe(null)
    })

    it('should bound the RPC fallback to one index-backed row (no table scan)', async () => {
      const { builder, calls } = mockManualSeasonQuery({
        data: [{ season_num: 104 }],
        error: null
      })
      const mockSupabase = {
        rpc: vi
          .fn()
          .mockResolvedValue({ data: null, error: new Error('schema cache') }),
        from: vi.fn().mockReturnValue(builder)
      }

      const { createServiceClient } = await import('@/app/lib/auth/server')
      vi.mocked(createServiceClient).mockReturnValue(mockSupabase as never)

      const { getLatestSeason } =
        await import('@/app/lib/data/get-latest-season')

      expect(await getLatestSeason()).toBe('104')

      expect(calls.limit).toHaveBeenCalledTimes(1)
      expect(calls.limit).toHaveBeenCalledWith(1)

      // Order on indexed season_num: TEXT "Season" lex-sorts '99' above '100'.
      expect(calls.order).toHaveBeenCalledTimes(1)
      expect(calls.order).toHaveBeenCalledWith('season_num', {
        ascending: false,
        nullsFirst: false
      })

      expect(calls.select).toHaveBeenCalledWith('season_num')
    })
  })
})
