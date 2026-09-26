import { describe, it, expect, vi, beforeEach } from 'vitest'

// meta-atlas reads SEASON_CONFIGS off disk; mock it to isolate throttle + race-guard behavior.
vi.mock('@/app/lib/herald/meta-atlas', () => ({
  fetchHeraldSeedFromMetaAtlas: vi.fn()
}))

// Avoids server-only import issues.
vi.mock('@/app/lib/discord/webhook-service', () => ({
  postToWebhook: vi.fn()
}))

import { __testing } from '@/app/lib/herald/engine'
import { fetchHeraldSeedFromMetaAtlas } from '@/app/lib/herald/meta-atlas'

const { refreshAutoUpdateMappings, AUTO_UPDATE_THROTTLE_MS } = __testing

const NOW_MS = 1_700_000_000_000

interface FlaggedRow {
  id: number
  meta_team_slug: string
  last_auto_updated_at: string | null
}

const makeSupabase = (flagged: FlaggedRow[]) => {
  const updates: Array<{
    id: number
    autoUpdateFilter: boolean | undefined
    payload: Record<string, unknown>
  }> = []

  const buildSelectChain = () => {
    const chain = {
      eq: vi.fn().mockReturnThis(),
      then: undefined as unknown
    }
    const rowsPromise = Promise.resolve({ data: flagged, error: null })
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      rowsPromise.then(onFulfilled)
    return chain
  }

  const buildUpdateChain = (payload: Record<string, unknown>) => {
    let capturedId: number | undefined
    let capturedAutoUpdate: boolean | undefined
    const chain = {
      eq: vi.fn().mockImplementation((col: string, val: number | boolean) => {
        if (col === 'id') capturedId = val as number
        if (col === 'auto_update') capturedAutoUpdate = val as boolean
        return chain
      }),
      then: undefined as unknown
    }
    const finalize = () => {
      updates.push({
        id: capturedId ?? -1,
        autoUpdateFilter: capturedAutoUpdate,
        payload
      })
      return { error: null }
    }
    chain.then = (onFulfilled: (v: unknown) => unknown) =>
      Promise.resolve(finalize()).then(onFulfilled)
    return chain
  }

  return {
    from: vi.fn((table: string) => {
      if (table !== 'herald_meta_role_mapping') {
        throw new Error(`unexpected table ${table}`)
      }
      return {
        select: () => buildSelectChain(),
        update: (payload: Record<string, unknown>) => buildUpdateChain(payload)
      }
    }),
    __captured: updates
  } as unknown as Parameters<typeof refreshAutoUpdateMappings>[0] & {
    __captured: typeof updates
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('refreshAutoUpdateMappings', () => {
  it('is a no-op when the guild has no auto_update=true mappings', async () => {
    const supabase = makeSupabase([])
    await refreshAutoUpdateMappings(supabase, 'TEST_GUILD', 'inv-1', NOW_MS)
    expect(vi.mocked(fetchHeraldSeedFromMetaAtlas)).not.toHaveBeenCalled()
    expect(
      (supabase as { __captured: Array<Record<string, unknown>> }).__captured
    ).toHaveLength(0)
  })

  it('updates a stale row (last_auto_updated_at older than throttle) with fresh top-2 bosses', async () => {
    vi.mocked(fetchHeraldSeedFromMetaAtlas).mockResolvedValue({
      teams: [
        {
          meta_team: 'AdMech',
          boss_ids: ['Ghazghkull_E0', 'Belisarius_E0'],
          sample_rows: 2
        }
      ],
      unmappedBosses: [],
      season: '98'
    })
    const staleIso = new Date(
      NOW_MS - AUTO_UPDATE_THROTTLE_MS - 60_000
    ).toISOString()
    const supabase = makeSupabase([
      { id: 10, meta_team_slug: 'AdMech', last_auto_updated_at: staleIso }
    ])

    await refreshAutoUpdateMappings(supabase, 'TEST_GUILD', 'inv-2', NOW_MS)

    const captured = (
      supabase as { __captured: Array<Record<string, unknown>> }
    ).__captured
    expect(captured).toHaveLength(1)
    expect(captured[0].id).toBe(10)
    expect(captured[0].autoUpdateFilter).toBe(true) // race guard applied
    expect(
      (captured[0].payload as { active_boss_ids: string[] }).active_boss_ids
    ).toEqual(['Ghazghkull_E0', 'Belisarius_E0'])
  })

  it('skips the atlas query entirely when ALL flagged rows are fresh (<1h old)', async () => {
    const freshIso = new Date(NOW_MS - 30 * 60 * 1000).toISOString() // 30 min ago
    const supabase = makeSupabase([
      { id: 11, meta_team_slug: 'AdMech', last_auto_updated_at: freshIso },
      { id: 12, meta_team_slug: 'Custodes', last_auto_updated_at: freshIso }
    ])

    await refreshAutoUpdateMappings(supabase, 'TEST_GUILD', 'inv-3', NOW_MS)

    expect(vi.mocked(fetchHeraldSeedFromMetaAtlas)).not.toHaveBeenCalled()
    expect(
      (supabase as { __captured: Array<Record<string, unknown>> }).__captured
    ).toHaveLength(0)
  })

  it('still runs for rows whose last_auto_updated_at is NULL (never refreshed)', async () => {
    vi.mocked(fetchHeraldSeedFromMetaAtlas).mockResolvedValue({
      teams: [
        { meta_team: 'Neuro', boss_ids: ['Belisarius_E0'], sample_rows: 1 }
      ],
      unmappedBosses: [],
      season: '98'
    })
    const supabase = makeSupabase([
      { id: 20, meta_team_slug: 'Neuro', last_auto_updated_at: null }
    ])

    await refreshAutoUpdateMappings(supabase, 'TEST_GUILD', 'inv-4', NOW_MS)

    expect(vi.mocked(fetchHeraldSeedFromMetaAtlas)).toHaveBeenCalledOnce()
    const captured = (
      supabase as { __captured: Array<Record<string, unknown>> }
    ).__captured
    expect(captured).toHaveLength(1)
    expect(
      (captured[0].payload as { active_boss_ids: string[] }).active_boss_ids
    ).toEqual(['Belisarius_E0'])
  })

  it('clears active_boss_ids to [] for mappings whose team dropped out of top-2', async () => {
    vi.mocked(fetchHeraldSeedFromMetaAtlas).mockResolvedValue({
      teams: [], // no teams seeded this round
      unmappedBosses: [],
      season: '98'
    })
    const supabase = makeSupabase([
      { id: 30, meta_team_slug: 'Abaddon', last_auto_updated_at: null }
    ])

    await refreshAutoUpdateMappings(supabase, 'TEST_GUILD', 'inv-5', NOW_MS)

    const captured = (
      supabase as { __captured: Array<Record<string, unknown>> }
    ).__captured
    expect(captured).toHaveLength(1)
    expect(
      (captured[0].payload as { active_boss_ids: string[] }).active_boss_ids
    ).toEqual([])
  })

  it('applies race-guard filter on UPDATE (auto_update eq true) so concurrent opt-out survives', async () => {
    vi.mocked(fetchHeraldSeedFromMetaAtlas).mockResolvedValue({
      teams: [
        { meta_team: 'AdMech', boss_ids: ['Ghazghkull_E0'], sample_rows: 1 }
      ],
      unmappedBosses: [],
      season: '98'
    })
    const supabase = makeSupabase([
      { id: 40, meta_team_slug: 'AdMech', last_auto_updated_at: null }
    ])

    await refreshAutoUpdateMappings(supabase, 'TEST_GUILD', 'inv-6', NOW_MS)

    const captured = (
      supabase as { __captured: Array<Record<string, unknown>> }
    ).__captured
    expect(captured[0].autoUpdateFilter).toBe(true)
  })

  it('writes last_auto_updated_at = now on each refreshed row', async () => {
    vi.mocked(fetchHeraldSeedFromMetaAtlas).mockResolvedValue({
      teams: [
        { meta_team: 'AdMech', boss_ids: ['Ghazghkull_E0'], sample_rows: 1 }
      ],
      unmappedBosses: [],
      season: '98'
    })
    const supabase = makeSupabase([
      { id: 50, meta_team_slug: 'AdMech', last_auto_updated_at: null }
    ])

    await refreshAutoUpdateMappings(supabase, 'TEST_GUILD', 'inv-7', NOW_MS)

    const captured = (
      supabase as { __captured: Array<Record<string, unknown>> }
    ).__captured
    const payload = captured[0].payload as { last_auto_updated_at: string }
    expect(payload.last_auto_updated_at).toBe(new Date(NOW_MS).toISOString())
  })
})
