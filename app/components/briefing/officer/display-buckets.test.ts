import { describe, it, expect } from 'vitest'
import { computeDisplayBuckets } from './PeopleToReviewList'
import { rosterAdjustedPct } from '@/app/lib/officer-briefing/aggregate'
import type { MemberSignalRow } from '@/app/lib/officer-briefing/types'

const row = (
  displayName: string,
  bucket: MemberSignalRow['bucket']
): MemberSignalRow => ({
  displayName,
  worstVsGuildPct: null,
  bestVsGuildPct: null,
  battleCount: 3,
  worstBossName: null,
  worstEncounterId: null,
  worstBattleCount: null,
  tokenCapRisk: false,
  estimatedCapWaste: null,
  bucket
})

describe('computeDisplayBuckets — disjoint tabs (mockup: NS + TU + DG = All)', () => {
  it('a needs-review member is NOT double-listed in team upgrades', () => {
    const needsReview = [
      row('Alpha', 'needs_review'),
      row('Bravo', 'needs_review')
    ]
    const teamUpgrades = [
      row('Alpha', 'team_upgrade'),
      row('Charlie', 'team_upgrade')
    ]
    const recognition = [row('TestPlayerA', 'recognition')]

    const b = computeDisplayBuckets(needsReview, teamUpgrades, recognition)

    expect(b.needsSupport.map((r) => r.displayName)).toEqual(['Alpha', 'Bravo'])
    // Alpha is already needs-review, so excluded from team upgrades.
    expect(b.teamUpgrades.map((r) => r.displayName)).toEqual(['Charlie'])
    expect(b.doingGreat.map((r) => r.displayName)).toEqual(['TestPlayerA'])
    expect(
      b.needsSupport.length + b.teamUpgrades.length + b.doingGreat.length
    ).toBe(b.all.length)
    expect(b.all.length).toBe(4)
  })

  it('empty inputs → empty buckets', () => {
    const b = computeDisplayBuckets([], [], [])
    expect(b.all).toEqual([])
    expect(b.needsSupport).toEqual([])
    expect(b.teamUpgrades).toEqual([])
  })
})

describe('rosterAdjustedPct — signed %, no division by zero', () => {
  it('below target is negative, above is positive', () => {
    expect(rosterAdjustedPct(500, 1000)).toBe(-50)
    expect(rosterAdjustedPct(1300, 1000)).toBeCloseTo(30)
  })
  it('null when the expectation is 0 or missing (no division)', () => {
    expect(rosterAdjustedPct(500, 0)).toBeNull()
    expect(rosterAdjustedPct(500, null)).toBeNull()
    expect(rosterAdjustedPct(null, 1000)).toBeNull()
    expect(rosterAdjustedPct(undefined, undefined)).toBeNull()
  })
})
