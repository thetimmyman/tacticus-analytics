import { describe, it, expect, vi, beforeEach } from 'vitest'

type Row = Record<string, unknown>
type Predicate = (row: Row) => boolean

interface UpsertCall {
  table: string
  values: Row
  options: { onConflict?: string; ignoreDuplicates?: boolean } | undefined
}

interface FakeState {
  briefingRow: Row | null
  carousel: Row[]
  upserts: UpsertCall[]
  upsertError: { message: string } | null
}

function makeState(overrides: Partial<FakeState> = {}): FakeState {
  return {
    briefingRow: null,
    carousel: [],
    upserts: [],
    upsertError: null,
    ...overrides
  }
}

let state: FakeState

function makeBuilder(table: string) {
  const filters: Predicate[] = []
  const b = {
    select: () => b,
    eq: (col: string, val: unknown) => {
      filters.push((r) => r[col] === val)
      return b
    },
    gt: (col: string, val: string) => {
      filters.push((r) => String(r[col]) > val)
      return b
    },
    lte: (col: string, val: string) => {
      filters.push((r) => String(r[col]) <= val)
      return b
    },
    maybeSingle: async () => {
      const row = state.briefingRow
      const hit = row && filters.every((f) => f(row)) ? row : null
      return { data: hit, error: null }
    },
    upsert: async (values: Row, options: UpsertCall['options']) => {
      state.upserts.push({ table, values, options })
      if (state.upsertError) return { data: null, error: state.upsertError }
      if (state.briefingRow === null || options?.ignoreDuplicates !== true) {
        state.briefingRow = { ...values }
      }
      return { data: null, error: null }
    },
    then: (
      resolve: (v: { data: null; count: number; error: null }) => void
    ) => {
      const rows = state.carousel.filter((r) => filters.every((f) => f(r)))
      resolve({ data: null, count: rows.length, error: null })
    }
  }
  return b
}

vi.mock('@/app/lib/db', () => ({
  db: async () => ({ from: (table: string) => makeBuilder(table) })
}))

const bossRows: Array<{ completed_on: string | null }> = []
vi.mock('@/app/lib/data/boss-status', () => ({
  getCurrentBossStatusWithLifecycle: async () => bossRows
}))

import { loadSinceLastVisit } from '@/app/lib/briefing/load-since-last-visit'

const USER = '11111111-1111-1111-1111-111111111111'
const GUILD = 'EOT_GR'
const SEASON = '104'

const T1 = Date.parse('2026-07-01T00:00:00.000Z') // first visit
const T2 = Date.parse('2026-07-05T00:00:00.000Z') // second visit

beforeEach(() => {
  state = makeState()
  bossRows.length = 0
})

describe('loadSinceLastVisit — bootstrap catch-22 (Part D)', () => {
  it('seeds the baseline on the first visit so the SECOND visit can produce deltas', async () => {
    expect(state.briefingRow).toBeNull()
    const first = await loadSinceLastVisit({
      userId: USER,
      guildCode: GUILD,
      season: SEASON,
      nowMs: T1
    })

    expect(first.isFirstVisit).toBe(true)
    expect(first.deltas).toEqual([])

    expect(state.briefingRow).not.toBeNull()
    expect(state.briefingRow?.previous_cutoff_at).toBe(first.snapshotAtIso)

    state.carousel.push({
      id: 'a1',
      is_active: true,
      created_at: '2026-07-03T12:00:00.000Z'
    })

    const second = await loadSinceLastVisit({
      userId: USER,
      guildCode: GUILD,
      season: SEASON,
      nowMs: T2
    })

    expect(second.isFirstVisit).toBe(false)
    expect(second.deltas.length).toBeGreaterThan(0)
    expect(second.deltas[0]).toMatchObject({
      kind: 'announcement',
      label: '1 new announcement'
    })
  })

  it('seeds the cutoff at the render snapshot, never backdated', async () => {
    const res = await loadSinceLastVisit({
      userId: USER,
      guildCode: GUILD,
      season: SEASON,
      nowMs: T1
    })

    // A backdated seed would invent a window the user never missed.
    expect(state.briefingRow?.previous_cutoff_at).toBe(
      new Date(T1).toISOString()
    )
    expect(res.deltas).toEqual([])
  })

  it('writes the seed with ON CONFLICT DO NOTHING so concurrent loads cannot double-insert or clobber', async () => {
    await loadSinceLastVisit({
      userId: USER,
      guildCode: GUILD,
      season: SEASON,
      nowMs: T1
    })

    expect(state.upserts).toHaveLength(1)
    const seed = state.upserts[0]
    if (!seed) throw new Error('expected exactly one seed upsert')
    expect(seed.table).toBe('user_briefing_state')
    expect(seed.options).toMatchObject({
      onConflict: 'user_id,guild_code',
      ignoreDuplicates: true
    })
    expect(seed.values).toMatchObject({
      user_id: USER,
      guild_code: GUILD
    })
  })

  it('does not touch an already-advanced cutoff (the /api/briefing/seen path stays authoritative)', async () => {
    state.briefingRow = {
      user_id: USER,
      guild_code: GUILD,
      previous_cutoff_at: '2026-07-02T00:00:00.000Z'
    }

    const res = await loadSinceLastVisit({
      userId: USER,
      guildCode: GUILD,
      season: SEASON,
      nowMs: T2
    })

    expect(state.upserts).toHaveLength(0)
    expect(state.briefingRow.previous_cutoff_at).toBe(
      '2026-07-02T00:00:00.000Z'
    )
    expect(res.isFirstVisit).toBe(false)
  })

  it('treats a failed seed as non-fatal and still renders an empty first visit', async () => {
    state.upsertError = {
      message: 'permission denied for table user_briefing_state'
    }

    const res = await loadSinceLastVisit({
      userId: USER,
      guildCode: GUILD,
      season: SEASON,
      nowMs: T1
    })

    expect(res).toMatchObject({ isFirstVisit: true, deltas: [] })
    expect(state.briefingRow).toBeNull()
  })

  it('never writes without a guild context', async () => {
    const res = await loadSinceLastVisit({
      userId: USER,
      guildCode: undefined,
      season: SEASON,
      nowMs: T1
    })

    expect(res).toMatchObject({ isFirstVisit: true, deltas: [] })
    expect(state.upserts).toHaveLength(0)
    expect(state.briefingRow).toBeNull()
  })
})
