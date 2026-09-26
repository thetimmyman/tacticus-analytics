import { describe, expect, it } from 'vitest'
import { warGlobalLinks } from '@/app/components/navigation/config'

/** Every war section stays navigable, and the retired chips and /war-tracking cannot return. */
describe('Consolidated Guild War nav reachability', () => {
  it('exposes exactly the 8 canonical war sections in canonical order', () => {
    expect(warGlobalLinks.map((link) => link.href)).toEqual([
      '/wars',
      '/war-room',
      '/wars/metrics',
      '/wars/lineups/offense',
      '/wars/maps',
      '/wars/cores/offense',
      '/wars/analyze/team',
      '/wars/config'
    ])
    expect(warGlobalLinks.map((link) => link.label)).toEqual([
      'War Reports',
      'War Room',
      'Guild Metrics',
      'Lineups',
      'Maps',
      'Cores',
      'Team Analysis',
      'Config'
    ])
  })

  it('does not include a replay entry in the war nav', () => {
    expect(warGlobalLinks.map((link) => link.href)).not.toContain(
      '/wars/replays'
    )
    expect(warGlobalLinks.map((link) => link.label)).not.toContain('Replays')
  })

  it('drops the retired Dashboard/Attackers/Defenders chips and the /war-tracking route', () => {
    const labels = warGlobalLinks.map((link) => link.label)
    expect(labels).not.toContain('Dashboard')
    expect(labels).not.toContain('Attackers')
    expect(labels).not.toContain('Defenders')

    for (const link of warGlobalLinks) {
      expect(link.href.startsWith('/war-tracking')).toBe(false)
    }
  })
})
