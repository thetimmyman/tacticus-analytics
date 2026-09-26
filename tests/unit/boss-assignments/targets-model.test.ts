import { describe, expect, it } from 'vitest'
import {
  filterAndSortTargetRows,
  mergeTargetRows,
  type SlotEntry,
  type TargetRow
} from '@/app/(dashboard)/boss-assignments/targets/model'

const slots: SlotEntry[] = [
  {
    boss_type: 'RawBoss',
    boss_name: 'Pretty Boss',
    rarity: 'Mythic',
    set: 2,
    encounter_id: 0
  },
  {
    boss_type: 'OtherBoss',
    boss_name: 'Other Boss',
    rarity: 'Legendary',
    set: 5,
    encounter_id: 1
  }
]

const target: TargetRow = {
  boss_name: 'RawBoss',
  rarity: 'Mythic',
  set: 2,
  encounter_id: 0,
  target_tokens: 4,
  source: 'officer_manual',
  seeded_from_seasons: null,
  notes: null,
  updated_by: null,
  updated_at: '2026-08-18T00:00:00Z',
  skip: false
}

describe('targets model', () => {
  it('joins targets using raw boss type rather than the display name', () => {
    const rows = mergeTargetRows(slots, [target])

    expect(rows[0]?.display_name).toBe('Pretty Boss')
    expect(rows[0]?.target).toBe(target)
    expect(rows[1]?.target).toBeNull()
  })

  it('filters primes and searches both raw and display names', () => {
    const rows = mergeTargetRows(slots, [target])
    const base = {
      rarity: 'all' as const,
      source: 'all' as const,
      sortKey: 'tier' as const,
      sortAsc: true
    }

    expect(
      filterAndSortTargetRows(rows, {
        ...base,
        name: 'rawboss',
        showPrimes: true
      }).map((row) => row.boss_type)
    ).toEqual(['RawBoss'])
    expect(
      filterAndSortTargetRows(rows, {
        ...base,
        name: '',
        showPrimes: false
      }).map((row) => row.boss_type)
    ).toEqual(['RawBoss'])
  })

  it('sorts unset targets before set targets by token value', () => {
    const rows = mergeTargetRows(slots, [target])

    expect(
      filterAndSortTargetRows(rows, {
        name: '',
        rarity: 'all',
        source: 'all',
        showPrimes: true,
        sortKey: 'target',
        sortAsc: true
      }).map((row) => row.boss_type)
    ).toEqual(['OtherBoss', 'RawBoss'])
  })
})
