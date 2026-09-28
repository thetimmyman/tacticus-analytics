import { describe, it, expect } from 'vitest'
import {
  buildBossAssignmentsTabs,
  activeBossAssignmentsTab
} from '@/app/(dashboard)/boss-assignments/_components/BossAssignmentsSubnav'

describe('BossAssignmentsSubnav tab contract', () => {
  it('always exposes Assignments / Performance / Targets in order', () => {
    const tabs = buildBossAssignmentsTabs(false)
    expect(tabs.map((t) => t.value)).toEqual([
      'assignments',
      'performance',
      'targets'
    ])
    expect(tabs.map((t) => t.href)).toEqual([
      '/boss-assignments/current',
      '/boss-assignments/performance',
      '/boss-assignments/targets'
    ])
  })

  it('adds Season Planner only when the viewer has season access', () => {
    const withoutAccess = buildBossAssignmentsTabs(false)
    expect(withoutAccess.some((t) => t.value === 'season')).toBe(false)

    const withAccess = buildBossAssignmentsTabs(true)
    expect(withAccess.map((t) => t.value)).toEqual([
      'assignments',
      'performance',
      'targets',
      'season'
    ])
    expect(withAccess.find((t) => t.value === 'season')?.href).toBe(
      '/boss-assignments/season'
    )
  })

  it('maps the current landing and the surface root to the Assignments tab', () => {
    expect(activeBossAssignmentsTab('/boss-assignments/current')).toBe(
      'assignments'
    )
    expect(activeBossAssignmentsTab('/boss-assignments')).toBe('assignments')
  })

  it('maps sibling routes to their own tab', () => {
    expect(activeBossAssignmentsTab('/boss-assignments/performance')).toBe(
      'performance'
    )
    expect(activeBossAssignmentsTab('/boss-assignments/targets')).toBe(
      'targets'
    )
    expect(activeBossAssignmentsTab('/boss-assignments/season')).toBe('season')
  })

  it('falls back to Assignments for null or unrelated pathnames', () => {
    expect(activeBossAssignmentsTab(null)).toBe('assignments')
    expect(activeBossAssignmentsTab('/somewhere-else')).toBe('assignments')
  })

  it('falls back to Assignments on /season when the season tab is absent (no access)', () => {
    const noAccessValues = buildBossAssignmentsTabs(false).map((t) => t.value)
    expect(
      activeBossAssignmentsTab('/boss-assignments/season', noAccessValues)
    ).toBe('assignments')

    const withAccessValues = buildBossAssignmentsTabs(true).map((t) => t.value)
    expect(
      activeBossAssignmentsTab('/boss-assignments/season', withAccessValues)
    ).toBe('season')
  })
})
