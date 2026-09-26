/** getLatestSeason returns `null` when both reads fail, never a stale hardcoded season. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('react', async () => {
  const actual = await vi.importActual('react')
  return { ...actual, cache: <T>(fn: T) => fn }
})

// Service role: both reads need table SELECT, and the max season is global.
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

// Resolves only through .limit(), so an unbounded fallback cannot pass.
function buildSupabase(opts: {
  rpc: { data: string | null; error: Error | null }
  rows?: Array<{ Season: string | null } | { season_num: number | null }> | null
  rowsError?: Error | null
}) {
  const result = { data: opts.rows ?? null, error: opts.rowsError ?? null }
  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve(result)),
    then: () => {
      throw new Error(
        'unbounded query: EOT_GR_data fallback was awaited without .limit()'
      )
    }
  }
  return {
    rpc: vi.fn().mockResolvedValue(opts.rpc),
    from: vi.fn().mockReturnValue(builder)
  }
}

async function mockedSeasonModule(supabase: ReturnType<typeof buildSupabase>) {
  const { createServiceClient } = await import('@/app/lib/auth/server')
  vi.mocked(createServiceClient).mockReturnValue(supabase as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.resetModules()
})
afterEach(() => {
  vi.resetAllMocks()
})

// The legacy import path must never resolve to an unbounded read.
describe('getLatestSeason — app/lib/utils/season.ts (re-export of the canonical implementation)', () => {
  it('returns the RPC value verbatim when RPC succeeds', async () => {
    await mockedSeasonModule(
      buildSupabase({ rpc: { data: '99', error: null } })
    )
    const { getLatestSeason } = await import('@/app/lib/utils/season')
    expect(await getLatestSeason()).toBe('99')
  })

  it('falls back to a single bounded MAX(season_num) row when RPC errors', async () => {
    const supabase = buildSupabase({
      rpc: { data: null, error: new Error('no rpc') },
      rows: [{ season_num: 100 }]
    })
    await mockedSeasonModule(supabase)
    const { getLatestSeason } = await import('@/app/lib/utils/season')
    expect(await getLatestSeason()).toBe('100')
    expect(supabase.from().limit).toHaveBeenCalledWith(1)
    expect(supabase.from().order).toHaveBeenCalledWith('season_num', {
      ascending: false,
      nullsFirst: false
    })
  })

  it('returns null on query error', async () => {
    await mockedSeasonModule(
      buildSupabase({
        rpc: { data: null, error: new Error('no rpc') },
        rows: null,
        rowsError: new Error('query failed')
      })
    )
    const { getLatestSeason } = await import('@/app/lib/utils/season')
    expect(await getLatestSeason()).toBeNull()
  })

  it('returns null on empty rows', async () => {
    await mockedSeasonModule(
      buildSupabase({
        rpc: { data: null, error: new Error('no rpc') },
        rows: []
      })
    )
    const { getLatestSeason } = await import('@/app/lib/utils/season')
    expect(await getLatestSeason()).toBeNull()
  })

  it('returns null when the client cannot be constructed (catch path)', async () => {
    const { createServiceClient } = await import('@/app/lib/auth/server')
    vi.mocked(createServiceClient).mockImplementation(() => {
      throw new Error('boom')
    })
    const { getLatestSeason } = await import('@/app/lib/utils/season')
    expect(await getLatestSeason()).toBeNull()
  })
})

describe('getLatestSeason — app/lib/data/get-latest-season.ts (cached, null on no data, bounded .limit(1) fallback)', () => {
  it('returns the RPC value verbatim when RPC succeeds', async () => {
    await mockedSeasonModule(
      buildSupabase({ rpc: { data: '86', error: null } })
    )
    const { getLatestSeason } = await import('@/app/lib/data/get-latest-season')
    expect(await getLatestSeason()).toBe('86')
  })

  it('falls back to a single bounded MAX(season_num) row when RPC errors', async () => {
    const supabase = buildSupabase({
      rpc: { data: null, error: new Error('no rpc') },
      rows: [{ season_num: 87 }]
    })
    await mockedSeasonModule(supabase)
    const { getLatestSeason } = await import('@/app/lib/data/get-latest-season')
    expect(await getLatestSeason()).toBe('87')
    expect(supabase.from().limit).toHaveBeenCalledWith(1)
    expect(supabase.from().order).toHaveBeenCalledWith('season_num', {
      ascending: false,
      nullsFirst: false
    })
  })

  it('returns null on query error (was 81)', async () => {
    await mockedSeasonModule(
      buildSupabase({
        rpc: { data: null, error: new Error('no rpc') },
        rows: null,
        rowsError: new Error('query failed')
      })
    )
    const { getLatestSeason } = await import('@/app/lib/data/get-latest-season')
    expect(await getLatestSeason()).toBeNull()
  })

  it('returns null on empty rows (was 81)', async () => {
    await mockedSeasonModule(
      buildSupabase({
        rpc: { data: null, error: new Error('no rpc') },
        rows: []
      })
    )
    const { getLatestSeason } = await import('@/app/lib/data/get-latest-season')
    expect(await getLatestSeason()).toBeNull()
  })

  it('returns null when the top row has no numeric season (was 81)', async () => {
    await mockedSeasonModule(
      buildSupabase({
        rpc: { data: null, error: new Error('no rpc') },
        rows: [{ season_num: null }]
      })
    )
    const { getLatestSeason } = await import('@/app/lib/data/get-latest-season')
    expect(await getLatestSeason()).toBeNull()
  })
})
