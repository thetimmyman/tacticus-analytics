import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getGuildTokenPerformance,
  type DamageRow
} from '@/app/lib/data/guild-token-performance'

const io = vi.hoisted(() => ({
  db: vi.fn(() => {
    throw new Error('Unexpected database access')
  }),
  fetch: vi.fn(() => {
    throw new Error('Unexpected network access')
  }),
  bossHp: vi.fn(() => {
    throw new Error('Unexpected HP read')
  })
}))
vi.mock('@/app/lib/db', () => ({ db: io.db }))
vi.mock('@/app/lib/data/boss-hp', async (original) => ({
  ...(await original<typeof import('@/app/lib/data/boss-hp')>()),
  getAllBossHp: io.bossHp
}))
beforeEach(() => {
  vi.clearAllMocks()
  vi.stubGlobal('fetch', io.fetch)
})
afterEach(() => {
  try {
    expect(io.db).not.toHaveBeenCalled()
    expect(io.bossHp).not.toHaveBeenCalled()
    expect(io.fetch).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

const attack = (
  id: string,
  encounterId: number,
  name: string,
  damage: number,
  hp: number
): DamageRow => ({
  userId: id,
  displayName: 'Synthetic Twin',
  Name: name,
  set: 0,
  Season: '101',
  rarity: 'Legendary',
  encounterId,
  loopIndex: 0,
  damageDealt: damage,
  maxHp: hp,
  remainingHp: hp - damage
})
const history = [
  attack('SYN-PRIME-A', 0, 'Riptide', 1000000, 5000000),
  attack('SYN-PRIME-B', 0, 'Riptide', 2000000, 5000000),
  attack('SYN-PRIME-A', 1, 'SyntheticPrime', 500000, 2000000),
  attack('SYN-PRIME-B', 1, 'SyntheticPrime', 1000000, 2000000),
  attack('SYN-PRIME-A', 2, 'SyntheticPrimeTwo', 1000000, 4000000)
]
function calculate(
  includePrimes: boolean,
  targets: Record<string, number> = {
    Riptide_L1_0: 4,
    SyntheticPrime_L1_1: 2,
    SyntheticPrimeTwo_L1_2: 8
  }
) {
  return getGuildTokenPerformance('SYN-PRIME', {
    seasonOverride: '101',
    includeHistoricalPlayers: true,
    includePrimes,
    includePerLoop: true,
    prefetched: {
      damageData: history,
      mostRecentSeasonPerBoss: { Riptide: '101', SyntheticPrime: '101' },
      bossHpData: { byBossName: { Riptide_L1: 5000000 } },
      officerTargetsByBossKey: targets
    }
  })
}
describe('canonical complete-prefetched prime performance', () => {
  it('preserves main-only default and distinct IDs despite duplicate display labels', async () => {
    const data = await calculate(false)
    expect(Object.keys(data).sort()).toEqual(['SYN-PRIME-A', 'SYN-PRIME-B'])
    expect(Object.keys(data['SYN-PRIME-A']!)).toEqual(['Riptide_L1'])
    expect(data['SYN-PRIME-A']!.Riptide_L1).toMatchObject({
      score: 0.8,
      encounterId: 0
    })
  })
  it('uses prime own HP and encounter target, retaining current-ID keyed loop details', async () => {
    const data = await calculate(true)
    expect(data['SYN-PRIME-A']!.SyntheticPrime_L1).toMatchObject({
      playerId: 'SYN-PRIME-A',
      encounterId: 1,
      actualDamage: 500000,
      expectedDamage: 1000000,
      expectedTokens: 2,
      score: 0.5,
      tier: 'officer_target',
      perLoop: { '0': { score: 0.5, tokensSpent: 1 } }
    })
    expect(data['SYN-PRIME-B']!.SyntheticPrime_L1).toMatchObject({
      playerId: 'SYN-PRIME-B',
      score: 1
    })
    expect(data['SYN-PRIME-A']!.SyntheticPrimeTwo_L1).toMatchObject({
      encounterId: 2,
      actualDamage: 1000000,
      expectedDamage: 500000,
      expectedTokens: 8,
      score: 2
    })
  })
  it('uses canonical saved-prime baseline when no positive officer target is supplied', async () => {
    const data = await calculate(true, { Riptide_L1_0: 4 })
    expect(data['SYN-PRIME-A']!.SyntheticPrime_L1).toMatchObject({
      expectedTokens: 3,
      score: 0.75,
      tier: 'per_boss'
    })
  })
})
