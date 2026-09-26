import { beforeEach, describe, it, expect, vi } from 'vitest'
import {
  loadSkippedPrimesForSeason,
  resolveSkippedPrimesFromRows,
  type SeasonOpsSkipRow,
  type SubBossSkipFlags,
  type TargetTokenSkipRow
} from '@/app/lib/boss-assignments/resolve-skipped-primes'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'

vi.mock('server-only', () => ({}))

const loggerWarn = vi.hoisted(() => vi.fn())
vi.mock('@/app/lib/logging', () => ({
  createComponentLogger: () => ({
    warn: loggerWarn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn()
  })
}))

const SEASON = '104'

const targetRow = (
  overrides: Partial<TargetTokenSkipRow> = {}
): TargetTokenSkipRow => ({
  boss_name: 'Avatar',
  rarity: 'Legendary',
  set: 4,
  encounter_id: 1,
  source: 'officer',
  seeded_from_seasons: null,
  skip: true,
  season_number: SEASON,
  ...overrides
})

const opsRow = (
  level: string,
  subBosses: SeasonOpsSkipRow['sub_bosses']
): SeasonOpsSkipRow => ({
  level,
  sub_bosses: subBosses
})

describe('resolveSkippedPrimesFromRows — WI-2716 union', () => {
  it('resolves a boss_target_tokens officer skip alone', () => {
    const skipped = resolveSkippedPrimesFromRows({
      season: SEASON,
      targetTokenRows: [targetRow()],
      seasonOpsRows: []
    })
    expect(skipped.get('L4')).toEqual(new Set([1]))
    expect(skipped.size).toBe(1)
  })

  it('resolves an upcoming_season_bosses subN_skip alone (object and JSON-string forms)', () => {
    const skipped = resolveSkippedPrimesFromRows({
      season: SEASON,
      targetTokenRows: [],
      seasonOpsRows: [
        opsRow('L2', { sub2_skip: true }),
        opsRow('M3', JSON.stringify({ sub1_skip: true, sub2_skip: false }))
      ]
    })
    expect(skipped.get('L2')).toEqual(new Set([2]))
    expect(skipped.get('M3')).toEqual(new Set([1]))
  })

  it('unions both stores for the same stage', () => {
    const skipped = resolveSkippedPrimesFromRows({
      season: SEASON,
      targetTokenRows: [targetRow({ encounter_id: 1 })],
      seasonOpsRows: [opsRow('L4', { sub2_skip: true })]
    })
    expect(skipped.get('L4')).toEqual(new Set([1, 2]))
  })

  it('a __pending__ placeholder row WITHOUT the true flag is NOT a skip', () => {
    // The writer inserts '__pending__' rows; existence is not intent.
    const skipped = resolveSkippedPrimesFromRows({
      season: SEASON,
      targetTokenRows: [],
      seasonOpsRows: [
        opsRow('L4', {}),
        // A string 'true' must not read as a skip.
        opsRow('L5', {
          sub1_skip: false,
          sub2_skip: 'true'
        } as unknown as SubBossSkipFlags),
        opsRow('M1', null)
      ]
    })
    expect(skipped.size).toBe(0)
  })

  it("the seeder's no-data sentinel is not an officer skip (WI-666)", () => {
    const skipped = resolveSkippedPrimesFromRows({
      season: SEASON,
      targetTokenRows: [
        targetRow({
          source: 'historical_seed',
          seeded_from_seasons: 'none available'
        })
      ],
      seasonOpsRows: []
    })
    expect(skipped.size).toBe(0)
  })

  it('season-scopes target rows: specific beats legacy, other seasons are ignored', () => {
    const skipped = resolveSkippedPrimesFromRows({
      season: SEASON,
      targetTokenRows: [
        targetRow({ season_number: '', skip: true }),
        targetRow({ season_number: SEASON, skip: false }),
        targetRow({ encounter_id: 2, season_number: '' }),
        targetRow({ set: 2, season_number: '103' })
      ],
      seasonOpsRows: []
    })
    expect(skipped.get('L4')).toEqual(new Set([2]))
    expect(skipped.size).toBe(1)
  })

  it('ignores main-boss rows and malformed stage anchors', () => {
    const skipped = resolveSkippedPrimesFromRows({
      season: SEASON,
      targetTokenRows: [
        targetRow({ encounter_id: 0 }),
        targetRow({ set: 9 }),
        targetRow({ rarity: null })
      ],
      seasonOpsRows: [opsRow('X9', { sub1_skip: true })]
    })
    expect(skipped.size).toBe(0)
  })
})

describe('loadSkippedPrimesForSeason', () => {
  type StoreRow = TargetTokenSkipRow | SeasonOpsSkipRow
  type StoreResult = {
    data: readonly StoreRow[] | null
    error: { message: string } | null
  }
  type FilterArg = string | number | ReadonlyArray<string | number>
  type FilterCall = { method: string; args: FilterArg[] }

  const makeQuery = (result: StoreResult, log: FilterCall[]) => {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in']) {
      query[method] = vi.fn((...args: FilterArg[]) => {
        log.push({ method, args })
        return query
      })
    }
    query.then = (resolve: (value: StoreResult) => void) =>
      Promise.resolve(result).then(resolve)
    return query
  }

  const makeClient = (results: {
    targetTokens: StoreResult
    seasonOps: StoreResult
  }) => {
    const filterLog: Record<string, FilterCall[]> = {
      boss_target_tokens: [],
      upcoming_season_bosses: []
    }
    const from = vi.fn((table: string) =>
      table === 'boss_target_tokens'
        ? makeQuery(results.targetTokens, filterLog.boss_target_tokens!)
        : makeQuery(results.seasonOps, filterLog.upcoming_season_bosses!)
    )
    return {
      client: { from } as unknown as TypedSupabaseClient,
      from,
      filterLog
    }
  }

  const ok = (data: readonly StoreRow[]): StoreResult => ({
    data,
    error: null
  })
  const fail = (message: string): StoreResult => ({
    data: null,
    error: { message }
  })

  beforeEach(() => {
    loggerWarn.mockClear()
  })

  it('fails open when the target-token store read errors: other store still applies, warn logged, no throw', async () => {
    const { client } = makeClient({
      targetTokens: fail('boom'),
      seasonOps: ok([{ level: 'L2', sub_bosses: { sub2_skip: true } }])
    })
    const skipped = await loadSkippedPrimesForSeason(client, 'G1', SEASON)
    expect(skipped.get('L2')).toEqual(new Set([2]))
    expect(skipped.size).toBe(1)
    expect(loggerWarn).toHaveBeenCalledTimes(1)
  })

  it('fails open when the season-ops store read errors: target-token skips still apply', async () => {
    const { client } = makeClient({
      targetTokens: ok([targetRow()]),
      seasonOps: fail('down')
    })
    const skipped = await loadSkippedPrimesForSeason(client, 'G1', SEASON)
    expect(skipped.get('L4')).toEqual(new Set([1]))
    expect(skipped.size).toBe(1)
    expect(loggerWarn).toHaveBeenCalledTimes(1)
  })

  it('returns the empty union (not a throw) when both stores fail', async () => {
    const { client } = makeClient({
      targetTokens: fail('boom'),
      seasonOps: fail('down')
    })
    const skipped = await loadSkippedPrimesForSeason(client, 'G1', SEASON)
    expect(skipped.size).toBe(0)
    expect(loggerWarn).toHaveBeenCalledTimes(2)
  })

  it('preloaded targetTokenRows skip the boss_target_tokens re-query', async () => {
    const { client, from } = makeClient({
      targetTokens: ok([]),
      seasonOps: ok([])
    })
    const skipped = await loadSkippedPrimesForSeason(client, 'G1', SEASON, {
      targetTokenRows: [targetRow()]
    })
    expect(skipped.get('L4')).toEqual(new Set([1]))
    expect(from).not.toHaveBeenCalledWith('boss_target_tokens')
    expect(from).toHaveBeenCalledWith('upcoming_season_bosses')
  })

  it('scopes both store queries to the guild and season', async () => {
    const { client, filterLog } = makeClient({
      targetTokens: ok([]),
      seasonOps: ok([])
    })
    await loadSkippedPrimesForSeason(client, 'G1', SEASON)

    expect(filterLog.boss_target_tokens).toEqual([
      {
        method: 'select',
        args: [
          'boss_name, rarity, set, encounter_id, source, seeded_from_seasons, skip, season_number, target_tokens'
        ]
      },
      { method: 'eq', args: ['guild_code', 'G1'] },
      { method: 'in', args: ['encounter_id', [0, 1, 2]] },
      { method: 'in', args: ['season_number', [SEASON, '']] }
    ])
    expect(filterLog.upcoming_season_bosses).toEqual([
      { method: 'select', args: ['level, sub_bosses'] },
      { method: 'eq', args: ['guild_code', 'G1'] },
      { method: 'eq', args: ['season_number', SEASON] }
    ])
  })
})
