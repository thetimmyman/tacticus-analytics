import { describe, expect, it } from 'vitest'
import {
  findSelectedBoss,
  getBossId,
  getEncounterDisplayName,
  getLevelDisplay,
  groupBossesByLevel,
  sortBossLevels,
  toBossSummary,
  type BossSummary
} from '@/app/(dashboard)/leaderboards/components/boss-leaderboards/model'

const boss = (overrides: Partial<BossSummary> = {}): BossSummary => ({
  Name: 'Avatar-Khaine',
  tier: 7,
  set: 0,
  rarity: 'Mythic',
  encounterId: 0,
  ...overrides
})

describe('boss leaderboard model', () => {
  it('normalizes valid query records and rejects incomplete records', () => {
    expect(
      toBossSummary({
        Name: '  Avatar-Khaine  ',
        tier: '7',
        set: '1',
        rarity: ' Mythic ',
        encounterId: '2'
      })
    ).toEqual(boss({ set: 1, encounterId: 2 }))

    expect(toBossSummary({ Name: '', tier: 7, set: 0 })).toBeNull()
    expect(
      toBossSummary({
        Name: 'Boss',
        tier: 7,
        set: 'invalid',
        rarity: 'Mythic',
        encounterId: 0
      })
    ).toBeNull()
  })

  it('round-trips selected boss ids when names contain hyphens', () => {
    const selected = boss()
    expect(getBossId(selected)).toBe('Mythic-0-0-Avatar-Khaine')
    expect(findSelectedBoss([selected], getBossId(selected))).toEqual(selected)
    expect(
      findSelectedBoss([selected], 'Mythic-invalid-0-Avatar-Khaine')
    ).toBeNull()
  })

  it('groups levels and sorts rarity before descending set number', () => {
    const bosses = [
      boss({ Name: 'L1', rarity: 'Legendary' }),
      boss({ Name: 'M1' }),
      boss({ Name: 'L5', rarity: 'Legendary', set: 4 }),
      boss({ Name: 'M2', set: 1 })
    ]
    const groups = groupBossesByLevel(bosses)

    expect(getLevelDisplay(4, 'Legendary')).toBe('L5')
    expect(sortBossLevels(groups)).toEqual(['M2', 'M1', 'L5', 'L1'])
    expect(groups.L1).toEqual([bosses[0]])
  })

  it('labels prime and generic side encounters', () => {
    expect(getEncounterDisplayName('Boss', 1)).toBe('Boss (Left Prime)')
    expect(getEncounterDisplayName('Boss', 2)).toBe('Boss (Right Prime)')
    expect(getEncounterDisplayName('Boss', 4)).toBe('Boss (Side 4)')
  })
})
