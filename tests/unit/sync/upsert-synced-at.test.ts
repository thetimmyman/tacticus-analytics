import { describe, it, expect, vi, beforeEach } from 'vitest'

/** Inserted vs updated comes from the RETURNed timestamp, so an update-only re-sync cannot hide a stalled ingest. */

vi.mock(
  '@tacticus/app-core/logger',
  () => import('@/tests/helpers/logger-mock')
)

vi.mock('@/app/lib/utils/error-handling', () => ({
  parseSupabaseError: vi.fn((error) => ({
    message: error?.message || 'Unknown error'
  }))
}))

const RECENT = () => new Date(Date.now() - 1000).toISOString() // < 5s -> inserted
const OLD = () => new Date(Date.now() - 60_000).toISOString() // > 5s -> updated

function makeSupabaseReturning(
  rows: Array<{ id: number; timestamp: string | null }>
) {
  const select = vi.fn().mockResolvedValue({ data: rows, error: null })
  const upsert = vi.fn().mockReturnValue({ select })
  return {
    supabase: { from: vi.fn().mockReturnValue({ upsert }) },
    upsert,
    select
  }
}

function validRecords(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    Guild: 'TEST',
    Season: '81',
    userId: `player${i}`
  }))
}

describe('upsertDataBatches inserted/updated split from returned timestamp', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('counts a recently-stamped returned row as INSERTED (new)', async () => {
    const { upsertDataBatches } = await import('@/app/lib/sync/db-operations')
    const { supabase } = makeSupabaseReturning([{ id: 1, timestamp: RECENT() }])

    const result = await upsertDataBatches(
      supabase as never,
      'TEST',
      validRecords(1) as never
    )

    expect(result.upserted).toBe(1)
    expect(result.inserted).toBe(1)
    expect(result.updated).toBe(0)
  })

  it('counts an old-stamped returned row as UPDATED, not a fresh insert', async () => {
    const { upsertDataBatches } = await import('@/app/lib/sync/db-operations')
    const { supabase } = makeSupabaseReturning([{ id: 1, timestamp: OLD() }])

    const result = await upsertDataBatches(
      supabase as never,
      'TEST',
      validRecords(1) as never
    )

    expect(result.upserted).toBe(1)
    expect(result.inserted).toBe(0)
    expect(result.updated).toBe(1)
  })

  it('splits a mixed batch by each row timestamp, not in bulk', async () => {
    const { upsertDataBatches } = await import('@/app/lib/sync/db-operations')
    const { supabase } = makeSupabaseReturning([
      { id: 1, timestamp: RECENT() },
      { id: 2, timestamp: OLD() },
      { id: 3, timestamp: RECENT() }
    ])

    const result = await upsertDataBatches(
      supabase as never,
      'TEST',
      validRecords(3) as never
    )

    expect(result.upserted).toBe(3)
    expect(result.inserted).toBe(2)
    expect(result.updated).toBe(1)
  })

  it('treats a null/missing returned timestamp as updated (not recent)', async () => {
    const { upsertDataBatches } = await import('@/app/lib/sync/db-operations')
    const { supabase } = makeSupabaseReturning([{ id: 1, timestamp: null }])

    const result = await upsertDataBatches(
      supabase as never,
      'TEST',
      validRecords(1) as never
    )

    expect(result.inserted).toBe(0)
    expect(result.updated).toBe(1)
  })

  it('falls back to per-record upsert on batch error and still splits by timestamp', async () => {
    const { upsertDataBatches } = await import('@/app/lib/sync/db-operations')

    const batchSelect = vi
      .fn()
      .mockResolvedValue({ data: null, error: { message: 'batch boom' } })
    const singleSelectNew = vi.fn().mockResolvedValue({
      data: [{ id: 1, timestamp: RECENT() }],
      error: null
    })
    const singleSelectOld = vi
      .fn()
      .mockResolvedValue({ data: [{ id: 2, timestamp: OLD() }], error: null })

    const upsert = vi
      .fn()
      .mockReturnValueOnce({ select: batchSelect })
      .mockReturnValueOnce({ select: singleSelectNew })
      .mockReturnValueOnce({ select: singleSelectOld })

    const supabase = { from: vi.fn().mockReturnValue({ upsert }) }

    const result = await upsertDataBatches(
      supabase as never,
      'TEST',
      validRecords(2) as never
    )

    expect(result.upserted).toBe(2)
    expect(result.inserted).toBe(1)
    expect(result.updated).toBe(1)
    expect(result.errors).toBe(0)
  })

  it('returns all-zero for empty data without touching the client', async () => {
    const { upsertDataBatches } = await import('@/app/lib/sync/db-operations')
    const supabase = { from: vi.fn() }

    const result = await upsertDataBatches(supabase as never, 'TEST', [])

    expect(result).toEqual({ upserted: 0, inserted: 0, updated: 0, errors: 0 })
    expect(supabase.from).not.toHaveBeenCalled()
  })
})
