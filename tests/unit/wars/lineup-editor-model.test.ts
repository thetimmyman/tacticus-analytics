import { describe, expect, it } from 'vitest'
import {
  buildLineupSlots,
  filterMachinesOfWar,
  getAbilityLevels,
  getStarTierFromProgressionIndex
} from '@/app/(dashboard)/wars/_components/lineup-editor-model'
import type {
  HeroMapping,
  RosterUnit,
  WarLineup
} from '@/app/(dashboard)/wars/_hooks/useWarLineups'

describe('lineup editor model', () => {
  it('adds the next available slot while respecting the configured maximum', () => {
    const lineups = [{ slot_number: 1 }, { slot_number: 4 }] as WarLineup[]

    expect(buildLineupSlots(lineups, 10).slots).toEqual([1, 2, 3, 4, 5])
    expect(buildLineupSlots(lineups, 3).slots).toEqual([1, 2, 3])
  })

  it('maps progression thresholds to star tiers', () => {
    expect([0, 3, 6, 9, 12, 16].map(getStarTierFromProgressionIndex)).toEqual([
      1, 2, 3, 4, 5, 6
    ])
  })

  it('orders ability levels by ability id', () => {
    const unit = {
      abilities: [
        { id: 'passive', level: 32 },
        { id: 'active', level: 35 }
      ]
    } as RosterUnit

    expect(getAbilityLevels(unit)).toBe('35/32')
  })

  it('searches machines by display name and unit id', () => {
    const machines = [
      { unit_id: 'mowBiovore', display_name: 'Biovore' },
      { unit_id: 'mowForgefiend', display_name: 'Forgefiend' }
    ] as HeroMapping[]

    expect(filterMachinesOfWar(machines, 'forge')).toEqual([machines[1]])
    expect(filterMachinesOfWar(machines, 'biovore')).toEqual([machines[0]])
  })
})
