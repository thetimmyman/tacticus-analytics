import { describe, expect, it } from 'vitest'

import { RAID_TEAMS } from '@/app/lib/constants/guild-raid-teams'
import { META_TEAM_NAMES } from '@/app/lib/meta/meta-team-names'

// RAID_TEAMS names join against meta_teams.team_name; drift silently breaks the roster baseline.

describe('RAID_TEAMS', () => {
  it('has unique ids and names', () => {
    const ids = RAID_TEAMS.map((t) => t.id)
    const names = RAID_TEAMS.map((t) => t.name)
    expect(new Set(ids).size).toBe(ids.length)
    expect(new Set(names).size).toBe(names.length)
  })

  it('only uses names from the canonical meta-team list', () => {
    for (const team of RAID_TEAMS) {
      expect(META_TEAM_NAMES).toContain(team.name)
    }
  })

  it('tracks Double Howl and Forcasmo', () => {
    const names = RAID_TEAMS.map((t) => t.name)
    expect(names).toContain('Double Howl')
    expect(names).toContain('Forcasmo')

    const doubleHowl = RAID_TEAMS.find((t) => t.name === 'Double Howl')!
    const forcasmo = RAID_TEAMS.find((t) => t.name === 'Forcasmo')!

    // Core must include meta_teams.trigger_heroes (Aun'shi+Ragnar / Forcas+Asmodai).
    const coreIds = (team: typeof doubleHowl) =>
      team.heroes.filter((h) => h.tier === 'core').map((h) => h.unitId)
    expect(coreIds(doubleHowl)).toEqual(
      expect.arrayContaining(['tauAunShi', 'spaceBlackmane'])
    )
    expect(coreIds(forcasmo)).toEqual(
      expect.arrayContaining(['darkaCompanion', 'darkaAsmodai'])
    )
  })

  it('has no duplicate heroes within a team', () => {
    for (const team of RAID_TEAMS) {
      const unitIds = team.heroes.map((h) => h.unitId)
      expect(new Set(unitIds).size).toBe(unitIds.length)
    }
  })
})
