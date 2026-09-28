import { describe, it, expect, vi } from 'vitest'
import {
  loadPlanTargetSignalsForSeason,
  resolveOfficerTargetsFromRows
} from '@/app/lib/boss-assignments/resolve-officer-targets'
import type { TargetTokenSkipRow } from '@/app/lib/boss-assignments/resolve-skipped-primes'
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

const row = (
  overrides: Partial<TargetTokenSkipRow> = {}
): TargetTokenSkipRow => ({
  boss_name: 'Avatar',
  rarity: 'Legendary',
  // 1-indexed (CHECK 1..5).
  set: 4,
  encounter_id: 0,
  source: 'officer',
  seeded_from_seasons: null,
  skip: false,
  season_number: SEASON,
  target_tokens: 20,
  ...overrides
})

describe('resolveOfficerTargetsFromRows', () => {
  it('resolves a target per stage + encounter, mains included', () => {
    const targets = resolveOfficerTargetsFromRows({
      season: SEASON,
      targetTokenRows: [
        row(),
        row({ boss_name: 'Prime', encounter_id: 1, target_tokens: 6 })
      ]
    })
    expect(targets.get('L4')?.get(0)).toBe(20)
    expect(targets.get('L4')?.get(1)).toBe(6)
    expect(targets.size).toBe(1)
  })

  it('season-scopes rows: specific beats legacy, other seasons are ignored', () => {
    const targets = resolveOfficerTargetsFromRows({
      season: SEASON,
      targetTokenRows: [
        row({ season_number: '', target_tokens: 10 }),
        row({ season_number: SEASON, target_tokens: 22 }),
        row({ season_number: '999', target_tokens: 77 })
      ]
    })
    expect(targets.get('L4')?.get(0)).toBe(22)
  })

  it('falls back to the legacy row when no season-specific row exists', () => {
    const targets = resolveOfficerTargetsFromRows({
      season: SEASON,
      targetTokenRows: [row({ season_number: '', target_tokens: 10 })]
    })
    expect(targets.get('L4')?.get(0)).toBe(10)
  })

  it("an officer-skip row's target never enters the budget", () => {
    const targets = resolveOfficerTargetsFromRows({
      season: SEASON,
      targetTokenRows: [row({ encounter_id: 1, skip: true })]
    })
    expect(targets.size).toBe(0)
  })

  it("the seeder's no-data sentinel contributes nothing even with a value", () => {
    const targets = resolveOfficerTargetsFromRows({
      season: SEASON,
      targetTokenRows: [
        row({
          skip: true,
          source: 'historical_seed',
          seeded_from_seasons: 'none available',
          target_tokens: 5
        })
      ]
    })
    expect(targets.size).toBe(0)
  })

  it('drops non-positive, non-finite, and missing target values', () => {
    const targets = resolveOfficerTargetsFromRows({
      season: SEASON,
      targetTokenRows: [
        row({ target_tokens: 0 }),
        row({ encounter_id: 1, target_tokens: -3 }),
        row({ encounter_id: 2, target_tokens: Number.NaN }),
        row({ boss_name: 'Other', set: 2, target_tokens: null }),
        row({ boss_name: 'Missing', set: 3, target_tokens: undefined })
      ]
    })
    expect(targets.size).toBe(0)
  })

  it('drops malformed stage anchors and out-of-range encounters', () => {
    const targets = resolveOfficerTargetsFromRows({
      season: SEASON,
      targetTokenRows: [
        row({ set: 9 }),
        row({ rarity: null }),
        row({ encounter_id: 3 }),
        row({ encounter_id: null })
      ]
    })
    expect(targets.size).toBe(0)
  })

  it('keeps fractional targets verbatim (quantization is the consumer seam)', () => {
    const targets = resolveOfficerTargetsFromRows({
      season: SEASON,
      targetTokenRows: [row({ target_tokens: 6.4 })]
    })
    expect(targets.get('L4')?.get(0)).toBe(6.4)
  })
})

describe('loadPlanTargetSignalsForSeason (combined loader)', () => {
  type StoreResult = {
    data: readonly unknown[] | null
    error: { message: string } | null
  }

  const makeQuery = (result: StoreResult) => {
    const query: Record<string, unknown> = {}
    for (const method of ['select', 'eq', 'in']) {
      query[method] = vi.fn(() => query)
    }
    query.then = (resolve: (value: StoreResult) => void) =>
      Promise.resolve(result).then(resolve)
    return query
  }

  const makeClient = (results: {
    targetTokens: StoreResult
    seasonOps: StoreResult
  }) => {
    const from = vi.fn((table: string) =>
      table === 'boss_target_tokens'
        ? makeQuery(results.targetTokens)
        : makeQuery(results.seasonOps)
    )
    return { client: { from } as unknown as TypedSupabaseClient, from }
  }

  it('resolves skips and targets from ONE boss_target_tokens read', async () => {
    const { client, from } = makeClient({
      targetTokens: {
        data: [
          row(),
          row({ boss_name: 'SkipMe', encounter_id: 2, skip: true })
        ],
        error: null
      },
      seasonOps: { data: [], error: null }
    })

    const { skippedPrimes, officerTargets } =
      await loadPlanTargetSignalsForSeason(client, 'G1', SEASON)

    expect(officerTargets.get('L4')?.get(0)).toBe(20)
    expect(skippedPrimes.get('L4')).toEqual(new Set([2]))
    expect(
      from.mock.calls.filter(([table]) => table === 'boss_target_tokens')
    ).toHaveLength(1)
  })

  it('fails open to empty maps when both stores error (advisory input)', async () => {
    const { client } = makeClient({
      targetTokens: { data: null, error: { message: 'boom' } },
      seasonOps: { data: null, error: { message: 'down' } }
    })

    const { skippedPrimes, officerTargets } =
      await loadPlanTargetSignalsForSeason(client, 'G1', SEASON)

    expect(officerTargets.size).toBe(0)
    expect(skippedPrimes.size).toBe(0)
    expect(loggerWarn).toHaveBeenCalled()
  })
})
