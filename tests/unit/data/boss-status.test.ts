import { describe, it, expect } from 'vitest'
import {
  deriveLifecycleAndWarded,
  type BossStatusRow
} from '@/app/lib/data/boss-status'

const mainRow = (overrides: Partial<BossStatusRow> = {}): BossStatusRow => ({
  boss_name: 'Magnus',
  rarity: 'Legendary',
  set: 1,
  encounter_id: 0,
  max_hp: 1_000_000,
  remaining_hp: 500_000,
  loop_index: 0,
  completed_on: null,
  ...overrides
})

const primeRow = (
  encounterId: 1 | 2,
  overrides: Partial<BossStatusRow> = {}
): BossStatusRow => ({
  boss_name: encounterId === 1 ? 'Thaumacus' : 'Calcuminus',
  rarity: 'Legendary',
  set: 1,
  encounter_id: encounterId,
  max_hp: 250_000,
  remaining_hp: 100_000,
  loop_index: 0,
  completed_on: null,
  ...overrides
})

describe('deriveLifecycleAndWarded (F16/F17)', () => {
  it('returns empty array for empty input', () => {
    expect(deriveLifecycleAndWarded([])).toEqual([])
  })

  it('marks main boss as warded when both primes are alive', () => {
    const rows = [mainRow(), primeRow(1), primeRow(2)]
    const decorated = deriveLifecycleAndWarded(rows)
    const main = decorated[0]
    expect(main.lifecycle_state).toBe('warded')
    expect(main.warded).toBe(true)
    expect(main.alive_primes).toBe(2)
  })

  it('marks main as active (not warded) when both primes are defeated', () => {
    const rows = [
      mainRow(),
      primeRow(1, { remaining_hp: 0, completed_on: '2026-05-15T00:00:00Z' }),
      primeRow(2, { remaining_hp: 0, completed_on: '2026-05-15T00:00:00Z' })
    ]
    const decorated = deriveLifecycleAndWarded(rows)
    const main = decorated[0]
    expect(main.lifecycle_state).toBe('active')
    expect(main.warded).toBe(false)
    expect(main.alive_primes).toBe(0)
  })

  it('marks defeated encounters via remaining_hp = 0', () => {
    const rows = [mainRow({ remaining_hp: 0 }), primeRow(1), primeRow(2)]
    const decorated = deriveLifecycleAndWarded(rows)
    expect(decorated[0].lifecycle_state).toBe('defeated')
    expect(decorated[0].warded).toBe(false)
  })

  it('a set completed_on does NOT mean defeated — only remaining HP does', () => {
    // "completedOn" is the battle-end time on every row, never a kill marker.
    const rows = [
      mainRow({ completed_on: '2026-05-15T00:00:00Z', remaining_hp: 500_000 })
    ]
    const decorated = deriveLifecycleAndWarded(rows)
    expect(decorated[0].lifecycle_state).toBe('active')
  })

  it('marks upcoming when max_hp is missing/zero and not defeated', () => {
    const rows = [mainRow({ max_hp: null, remaining_hp: null })]
    const decorated = deriveLifecycleAndWarded(rows)
    expect(decorated[0].lifecycle_state).toBe('upcoming')
  })

  it('counts only encounter_id 1/2 as primes', () => {
    const rows = [
      mainRow(),
      primeRow(1),
      primeRow(2, { remaining_hp: 0, completed_on: '2026-05-15T00:00:00Z' })
    ]
    const decorated = deriveLifecycleAndWarded(rows)
    expect(decorated[0].alive_primes).toBe(1)
    expect(decorated[0].lifecycle_state).toBe('warded')
  })

  it('preserves input row order', () => {
    const rows = [primeRow(2), mainRow(), primeRow(1)]
    const decorated = deriveLifecycleAndWarded(rows)
    expect(decorated.map((r) => r.encounter_id)).toEqual([2, 0, 1])
  })

  it('propagates derived fields to primes too (lifecycle reflects own state)', () => {
    const rows = [
      mainRow(),
      primeRow(1),
      primeRow(2, { remaining_hp: 0, completed_on: '2026-05-15T00:00:00Z' })
    ]
    const decorated = deriveLifecycleAndWarded(rows)
    const primeA = decorated.find((r) => r.encounter_id === 1)
    const primeB = decorated.find((r) => r.encounter_id === 2)
    expect(primeA?.lifecycle_state).toBe('active')
    expect(primeA?.warded).toBe(false) // only main can be warded
    expect(primeB?.lifecycle_state).toBe('defeated')
    expect(primeB?.alive_primes).toBe(1) // same count across all rows
  })

  it('handles main-only payload (no primes) — lifecycle = active', () => {
    const decorated = deriveLifecycleAndWarded([mainRow()])
    expect(decorated[0].lifecycle_state).toBe('active')
    expect(decorated[0].warded).toBe(false)
    expect(decorated[0].alive_primes).toBe(0)
  })
})

// The API sometimes omits the kill hit; mirrors the SQL rule in the boss-status migration.
describe('deriveLifecycleAndWarded (omitted-kill inference)', () => {
  it('rule (b): main with omitted kill reads defeated once a later loop is engaged', () => {
    const rows = [
      mainRow({ loop_index: 0, completed_on: '2026-05-15T00:00:00Z' }),
      primeRow(1, { loop_index: 1, completed_on: '2026-05-16T00:00:00Z' })
    ]
    const decorated = deriveLifecycleAndWarded(rows)
    expect(decorated[0].lifecycle_state).toBe('defeated')
    expect(decorated[0].warded).toBe(false)
    expect(decorated[1].lifecycle_state).toBe('active')
    expect(decorated[0].alive_primes).toBe(1)
  })

  it('rule (b): stale prime reads defeated once a later stage is engaged', () => {
    const rows = [
      primeRow(1, { set: 1, completed_on: '2026-05-15T00:00:00Z' }),
      mainRow({ set: 2, completed_on: '2026-05-16T00:00:00Z' })
    ]
    const decorated = deriveLifecycleAndWarded(rows)
    const prime = decorated.find((r) => r.encounter_id === 1)
    const main = decorated.find((r) => r.encounter_id === 0)
    expect(prime?.lifecycle_state).toBe('defeated')
    expect(main?.lifecycle_state).toBe('active')
    expect(main?.alive_primes).toBe(0)
  })

  it('control: the homepage inferMainBossDeath heuristic is NOT imported — alive main with NEWER same-stage prime hits stays warded', () => {
    // Primes clear before the main, so newer same-stage prime activity is not a defeat.
    const rows = [
      mainRow({ completed_on: '2026-05-15T00:00:00Z' }),
      primeRow(1, { completed_on: '2026-05-16T00:00:00Z' }),
      primeRow(2, { completed_on: '2026-05-16T01:00:00Z' })
    ]
    const decorated = deriveLifecycleAndWarded(rows)
    expect(decorated[0].lifecycle_state).toBe('warded')
    expect(decorated[0].warded).toBe(true)
    expect(decorated[0].alive_primes).toBe(2)
  })

  it('strictness: an EQUAL different-stage timestamp never infers a defeat', () => {
    const rows = [
      mainRow({ completed_on: '2026-05-15T00:00:00Z' }),
      primeRow(1, { set: 2, completed_on: '2026-05-15T00:00:00Z' })
    ]
    const decorated = deriveLifecycleAndWarded(rows)
    expect(decorated[0].lifecycle_state).toBe('warded')
  })

  it('unknown recency: rows without completed_on neither receive nor provide inference', () => {
    const rows = [
      mainRow({ completed_on: null }),
      primeRow(1, { set: 2, completed_on: '2026-05-16T00:00:00Z' })
    ]
    const decorated = deriveLifecycleAndWarded(rows)
    expect(decorated[0].lifecycle_state).toBe('warded')
  })

  it('upcoming rows (no HP pool) are never promoted to defeated', () => {
    const rows = [
      mainRow({
        max_hp: null,
        remaining_hp: null,
        completed_on: '2026-05-15T00:00:00Z'
      }),
      primeRow(1, { set: 2, completed_on: '2026-05-16T00:00:00Z' })
    ]
    const decorated = deriveLifecycleAndWarded(rows)
    expect(decorated[0].lifecycle_state).toBe('upcoming')
  })
})
