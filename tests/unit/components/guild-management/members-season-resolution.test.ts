import { describe, it, expect } from 'vitest'
import { resolveSelectedSeason } from '@/app/(dashboard)/guild-management/members/components/utils'

// ?season= is not yet written on fresh load, so the season resolves as `urlParam || initialSeason`.
describe('resolveSelectedSeason (members season fallback)', () => {
  it('falls back to initialSeason when the URL has no season param (the bug)', () => {
    expect(resolveSelectedSeason(null, '103')).toBe('103')
  })

  it('falls back to initialSeason when the URL season param is empty', () => {
    // Empty string must also fall back, hence `||` rather than `??`.
    expect(resolveSelectedSeason('', '103')).toBe('103')
  })

  it('prefers an explicit URL season over initialSeason (jiggle still wins)', () => {
    expect(resolveSelectedSeason('99', '103')).toBe('99')
  })

  it('returns the URL season even when no initialSeason is provided', () => {
    expect(resolveSelectedSeason('103')).toBe('103')
  })

  it('returns empty string only when both inputs are empty (graceful degrade)', () => {
    expect(resolveSelectedSeason(null, '')).toBe('')
    expect(resolveSelectedSeason(null)).toBe('')
    expect(resolveSelectedSeason('', '')).toBe('')
  })
})
