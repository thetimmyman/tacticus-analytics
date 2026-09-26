import { describe, expect, it } from 'vitest'
import {
  ACTIVE_WAR_NULL_END_GRACE_MS,
  ACTIVE_WAR_VISIBILITY_GRACE_MS,
  buildActiveWarVisibilityFilter,
  getActiveWarNullEndCutoffIso,
  getActiveWarVisibilityCutoffIso
} from '@/app/lib/war/active-wars'

describe('active-wars helpers', () => {
  const fixedNow = Date.parse('2026-04-30T12:00:00Z')

  it('end cutoff is 12h before now', () => {
    const cutoff = getActiveWarVisibilityCutoffIso(fixedNow)
    expect(Date.parse(cutoff)).toBe(fixedNow - ACTIVE_WAR_VISIBILITY_GRACE_MS)
  })

  it('null-end cutoff is one full war duration + grace before now', () => {
    const cutoff = getActiveWarNullEndCutoffIso(fixedNow)
    expect(Date.parse(cutoff)).toBe(fixedNow - ACTIVE_WAR_NULL_END_GRACE_MS)
    expect(ACTIVE_WAR_NULL_END_GRACE_MS).toBe(72 * 60 * 60 * 1000)
  })

  it('visibility filter matches recent end OR null end with recent start', () => {
    const filter = buildActiveWarVisibilityFilter(fixedNow)
    const endCutoff = getActiveWarVisibilityCutoffIso(fixedNow)
    const startCutoff = getActiveWarNullEndCutoffIso(fixedNow)
    expect(filter).toBe(
      `war_end_date.gt.${endCutoff},and(war_end_date.is.null,war_start_date.gt.${startCutoff})`
    )
  })
})
