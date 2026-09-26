/** Each prime is scored from only its own population, under the unchanged bossKey. */
import { describe, it, expect } from 'vitest'
import {
  getGuildTokenPerformance,
  type DamageRow
} from '@/app/lib/data/guild-token-performance'

const baseRow: DamageRow = {
  displayName: 'Placeholder',
  userId: null,
  Name: 'Placeholder',
  set: 0,
  damageDealt: 0,
  remainingHp: 1,
  maxHp: null,
  Season: '10',
  rarity: 'Legendary',
  loopIndex: 0,
  encounterId: 0
}

describe('getGuildTokenPerformance includePrimes', () => {
  const mainAliceRow1: DamageRow = {
    ...baseRow,
    displayName: 'Alice',
    Name: 'MainBoss',
    set: 1,
    damageDealt: 100000,
    remainingHp: 900000,
    maxHp: 1000000,
    encounterId: 0
  }
  const mainAliceRow2: DamageRow = {
    ...baseRow,
    displayName: 'Alice',
    Name: 'MainBoss',
    set: 1,
    damageDealt: 120000,
    remainingHp: 780000,
    maxHp: 1000000,
    encounterId: 0
  }
  const mainBobRow: DamageRow = {
    ...baseRow,
    displayName: 'Bob',
    Name: 'MainBoss',
    set: 1,
    damageDealt: 80000,
    remainingHp: 700000,
    maxHp: 1000000,
    encounterId: 0
  }
  const primeAliceRow: DamageRow = {
    ...baseRow,
    displayName: 'Alice',
    Name: 'PrimeBoss',
    set: 1,
    damageDealt: 50000,
    remainingHp: 150000,
    maxHp: 200000,
    encounterId: 1
  }
  const primeBobRow: DamageRow = {
    ...baseRow,
    displayName: 'Bob',
    Name: 'PrimeBoss',
    set: 1,
    damageDealt: 30000,
    remainingHp: 170000,
    maxHp: 200000,
    encounterId: 1
  }

  const mixedDamageData: DamageRow[] = [
    mainAliceRow1,
    mainAliceRow2,
    mainBobRow,
    primeAliceRow,
    primeBobRow
  ]

  const sharedPrefetched = {
    mostRecentSeasonPerBoss: { MainBoss: '10', PrimeBoss: '10' },
    bossHpData: { byBossName: { MainBoss_L2: 1000000 } },
    activeCurrentPlayers: new Set(['alice', 'bob']),
    officerTargetsByBossKey: {}
  }

  it('excludes prime rows when includePrimes is false (default), even if prime rows are present in the input', async () => {
    const result = await getGuildTokenPerformance('GUILD1', {
      prefetched: {
        ...sharedPrefetched,
        damageData: mixedDamageData
      }
    })

    expect(Object.keys(result.Alice ?? {})).toEqual(['MainBoss_L2'])
    expect(Object.keys(result.Bob ?? {})).toEqual(['MainBoss_L2'])

    expect(result.Alice?.MainBoss_L2?.score).toBeCloseTo(1.1, 6) // 220000/(2*100000)
    expect(result.Bob?.MainBoss_L2?.score).toBeCloseTo(0.8, 6) // 80000/100000
    expect(result.Alice?.MainBoss_L2?.encounterId).toBe(0)
    expect(result.Alice?.MainBoss_L2?.tier).toBe('per_boss')
  })

  it('scores a prime as its own entry when includePrimes is true, independent of its main boss cohort, under the unchanged bossKey format', async () => {
    const result = await getGuildTokenPerformance('GUILD1', {
      includePrimes: true,
      prefetched: {
        ...sharedPrefetched,
        damageData: mixedDamageData
      }
    })

    expect(Object.keys(result.Alice ?? {}).sort()).toEqual([
      'MainBoss_L2',
      'PrimeBoss_L2'
    ])
    expect(Object.keys(result.Bob ?? {}).sort()).toEqual([
      'MainBoss_L2',
      'PrimeBoss_L2'
    ])

    expect(result.Alice?.MainBoss_L2?.score).toBeCloseTo(1.1, 6)
    expect(result.Bob?.MainBoss_L2?.score).toBeCloseTo(0.8, 6)
    expect(result.Alice?.MainBoss_L2?.encounterId).toBe(0)

    // HP comes from the prime's own maxHp; pooling with the main would give ~76,000.
    expect(result.Alice?.PrimeBoss_L2?.score).toBeCloseTo(1.25, 6) // 50000/40000
    expect(result.Bob?.PrimeBoss_L2?.score).toBeCloseTo(0.75, 6) // 30000/40000
    expect(result.Alice?.PrimeBoss_L2?.encounterId).toBe(1)
    expect(result.Bob?.PrimeBoss_L2?.encounterId).toBe(1)
    expect(result.Alice?.PrimeBoss_L2?.expectedTokens).toBe(5)
    expect(result.Alice?.PrimeBoss_L2?.tier).toBe('per_boss')
  })

  it('resolves prime HP from PRIME_HP_BY_BOSS (anchored on the paired main boss name) when rows carry no maxHp', async () => {
    const mainAvatarRow: DamageRow = {
      ...baseRow,
      displayName: 'Carol',
      Name: 'Avatar',
      set: 0,
      damageDealt: 40000,
      remainingHp: 60000,
      maxHp: 100000,
      encounterId: 0
    }
    const primeRowNoMaxHp: DamageRow = {
      ...baseRow,
      displayName: 'Carol',
      Name: 'MysteryPrime',
      set: 0,
      damageDealt: 20000,
      remainingHp: 10000,
      maxHp: null, // forces the constants-table fallback
      encounterId: 1
    }

    const result = await getGuildTokenPerformance('GUILD1', {
      includePrimes: true,
      prefetched: {
        damageData: [mainAvatarRow, primeRowNoMaxHp],
        mostRecentSeasonPerBoss: { Avatar: '10', MysteryPrime: '10' },
        bossHpData: {
          byBossName: { Avatar_L1: 1000000 },
          primes: { Avatar_L1: 300000 }
        },
        activeCurrentPlayers: new Set(['carol']),
        officerTargetsByBossKey: {}
      }
    })

    expect(result.Carol?.Avatar_L1?.score).toBeCloseTo(1, 6)
    expect(result.Carol?.MysteryPrime_L1).toBeDefined()
    expect(result.Carol?.MysteryPrime_L1?.encounterId).toBe(1)
    expect(result.Carol?.MysteryPrime_L1?.expectedTokens).toBe(15) // ceil(300000/20000)
    expect(result.Carol?.MysteryPrime_L1?.score).toBeCloseTo(1, 6) // 20000/(300000/15)
    expect(result.Carol?.MysteryPrime_L1?.tier).toBe('per_boss')
  })
})
