import { describe, expect, it } from 'vitest'
import {
  getBossHpForLevel,
  getPrimeHpForLevel
} from '@/app/(dashboard)/guild-management/upcoming-assignments/utils/boss-calculations'
import type { BossHpData } from '@/app/(dashboard)/guild-management/upcoming-assignments/types'

describe('boss-calculations HP helpers', () => {
  it('uses per-boss HP when available', () => {
    const bossHpData: BossHpData = {
      legendary: { L1: 4_888_667 },
      mythic: { M1: 29_333_333 },
      primes: {},
      byBossName: { Rogaldorn_L1: 5_000_000 }
    }

    expect(getBossHpForLevel('L1', bossHpData, 'RogalDorn')).toBe(5_000_000)
    expect(getBossHpForLevel('L1', bossHpData, 'UnknownBoss')).toBe(4_888_667)
  })

  it('resolves boss type variants to canonical per-boss keys', () => {
    const bossHpData: BossHpData = {
      legendary: { L2: 7_333_333 },
      mythic: { M1: 29_333_333 },
      primes: {},
      byBossName: { Belisarius_L2: 7_500_000 }
    }

    expect(getBossHpForLevel('L2', bossHpData, 'BelisariusRW')).toBe(7_500_000)
  })

  it('does not use Mythic prime HP for Legendary lookups', () => {
    const bossHpData: BossHpData = {
      legendary: { L1: 4_888_667 },
      mythic: { M1: 29_333_333 },
      primes: { Rogaldorn_L1: 400_000, Rogaldorn_prime2_L1: 350_000 }
    }

    const primeHpData = { Thaddeus_M1: 2_400_000 }

    expect(
      getPrimeHpForLevel(
        'RogalDorn',
        'Thaddeus',
        'L1',
        1,
        primeHpData,
        bossHpData
      )
    ).toBe(400_000)
  })

  it('uses Mythic prime HP for Mythic lookups', () => {
    const bossHpData: BossHpData = {
      legendary: { L1: 4_888_667 },
      mythic: { M1: 29_333_333 },
      primes: { Rogaldorn_M1: 2_400_000, Rogaldorn_prime2_M1: 2_100_000 }
    }

    const primeHpData = { Thaddeus_M1: 2_400_000 }

    expect(
      getPrimeHpForLevel(
        'RogalDorn',
        'Thaddeus',
        'M1',
        1,
        primeHpData,
        bossHpData
      )
    ).toBe(2_400_000)
  })
})
