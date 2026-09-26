import { describe, expect, it } from 'vitest'
import {
  LEGACY_SEASON,
  normalizeSeasonNumber,
  parseSeasonParam,
  selectSeasonScoped,
  isTargetNoDataSentinel,
  isOfficerSkip
} from '@/app/lib/boss-assignments/target-token-season'
import { resolveExpectedTokens } from '@/app/lib/boss-assignments/performance-score'

type Row = {
  boss_name: string
  encounter_id: number
  target_tokens: number
  skip?: boolean | null
  source?: string | null
  seeded_from_seasons?: string | null
  season_number?: string | null
}

const keyOf = (row: Row) => `${row.boss_name}__${row.encounter_id}`

describe('normalizeSeasonNumber', () => {
  it('collapses null/undefined to the legacy sentinel', () => {
    expect(normalizeSeasonNumber(null)).toBe(LEGACY_SEASON)
    expect(normalizeSeasonNumber(undefined)).toBe('')
  })
  it('stringifies numeric seasons', () => {
    expect(normalizeSeasonNumber(101)).toBe('101')
    expect(normalizeSeasonNumber('101')).toBe('101')
  })
})

describe('parseSeasonParam', () => {
  it('normalizes positive integer season values to strings', () => {
    expect(parseSeasonParam(101)).toBe('101')
    expect(parseSeasonParam('00101')).toBe('101')
  })

  it('treats empty and legacy values as unscoped', () => {
    expect(parseSeasonParam(null)).toBeNull()
    expect(parseSeasonParam(undefined)).toBeNull()
    expect(parseSeasonParam('')).toBeNull()
  })

  it('rejects malformed or non-positive explicit values', () => {
    expect(parseSeasonParam('0')).toBeNull()
    expect(parseSeasonParam('-1')).toBeNull()
    expect(parseSeasonParam('12abc')).toBeNull()
    expect(parseSeasonParam('1234567')).toBeNull()
  })
})

describe('selectSeasonScoped precedence', () => {
  it('season-specific row wins over the legacy row for the same slot', () => {
    const rows: Row[] = [
      {
        boss_name: 'Riptide',
        encounter_id: 0,
        target_tokens: 5,
        season_number: ''
      },
      {
        boss_name: 'Riptide',
        encounter_id: 0,
        target_tokens: 9,
        season_number: '101'
      }
    ]
    const scoped = selectSeasonScoped(rows, '101', keyOf)
    expect(scoped.get('Riptide__0')?.target_tokens).toBe(9)
  })

  it('season-specific wins regardless of row order', () => {
    const rows: Row[] = [
      {
        boss_name: 'Riptide',
        encounter_id: 0,
        target_tokens: 9,
        season_number: '101'
      },
      {
        boss_name: 'Riptide',
        encounter_id: 0,
        target_tokens: 5,
        season_number: ''
      }
    ]
    const scoped = selectSeasonScoped(rows, '101', keyOf)
    expect(scoped.get('Riptide__0')?.target_tokens).toBe(9)
  })

  it('legacy row applies when no season-specific row exists', () => {
    const rows: Row[] = [
      {
        boss_name: 'Riptide',
        encounter_id: 0,
        target_tokens: 5,
        season_number: ''
      }
    ]
    const scoped = selectSeasonScoped(rows, '101', keyOf)
    expect(scoped.get('Riptide__0')?.target_tokens).toBe(5)
  })

  it('rows for a different season are excluded (only requested season + legacy)', () => {
    const rows: Row[] = [
      {
        boss_name: 'Riptide',
        encounter_id: 0,
        target_tokens: 7,
        season_number: '99'
      }
    ]
    const scoped = selectSeasonScoped(rows, '101', keyOf)
    expect(scoped.has('Riptide__0')).toBe(false)
  })

  it('treats a null season_number as legacy', () => {
    const rows: Row[] = [
      {
        boss_name: 'Riptide',
        encounter_id: 0,
        target_tokens: 4,
        season_number: null
      }
    ]
    const scoped = selectSeasonScoped(rows, '101', keyOf)
    expect(scoped.get('Riptide__0')?.target_tokens).toBe(4)
  })
})

describe('no-data sentinel vs officer skip', () => {
  it('flags the seeder no-data sentinel', () => {
    expect(isTargetNoDataSentinel('historical_seed', 'none available')).toBe(
      true
    )
    expect(
      isTargetNoDataSentinel('historical_seed', 'S84-S98 (cohort M1 mean)')
    ).toBe(false)
  })

  it('does not flag officer_manual rows as sentinel', () => {
    expect(isTargetNoDataSentinel('officer_manual', 'none available')).toBe(
      false
    )
  })

  it('officer skip = skip && not sentinel', () => {
    expect(
      isOfficerSkip({
        skip: true,
        source: 'officer_manual',
        seeded_from_seasons: null
      })
    ).toBe(true)
    // The sentinel skip is NOT an officer skip.
    expect(
      isOfficerSkip({
        skip: true,
        source: 'historical_seed',
        seeded_from_seasons: 'none available'
      })
    ).toBe(false)
    expect(
      isOfficerSkip({
        skip: false,
        source: 'officer_manual',
        seeded_from_seasons: null
      })
    ).toBe(false)
  })
})

describe('planner skip flows through resolveExpectedTokens', () => {
  it('officer/planner skip short-circuits to tier=skipped even with a target set', () => {
    const resolved = resolveExpectedTokens({
      officerTargetTokens: 12,
      perBossTokens: 8,
      perBossSampleCount: 40,
      skip: true
    })
    expect(resolved.tier).toBe('skipped')
    expect(resolved.expectedTokens).toBeNull()
  })

  it('without skip, an officer target still wins', () => {
    const resolved = resolveExpectedTokens({
      officerTargetTokens: 12,
      perBossTokens: 8,
      perBossSampleCount: 40,
      skip: false
    })
    expect(resolved.tier).toBe('officer_target')
    expect(resolved.expectedTokens).toBe(12)
  })
})
