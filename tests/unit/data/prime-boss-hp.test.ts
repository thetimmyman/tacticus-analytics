import { describe, expect, it } from 'vitest'
import { lookupPrimeBossHp } from '@/app/lib/data/prime-boss-hp'

describe('lookupPrimeBossHp', () => {
  it('resolves compact and case-normalized prime keys', () => {
    const primes = {
      belisariuscawl_L4: 100,
      belisariuscawl_prime2_L4: 200
    }

    expect(lookupPrimeBossHp('Belisarius Cawl', 'L4', primes, 1)).toBe(100)
    expect(lookupPrimeBossHp('Belisarius Cawl', 'L4', primes, 2)).toBe(200)
  })

  it('strips known presentation suffixes before resolving HP', () => {
    expect(
      lookupPrimeBossHp('BelisariusRW', 'M2', { Belisarius_M2: 300 }, 1)
    ).toBe(300)
  })

  it('never resolves a prime-two key for encounter one', () => {
    expect(
      lookupPrimeBossHp('Mortarion', 'M1', { mortarion_prime2_M1: 500 }, 1)
    ).toBe(0)
  })

  it('supports the historical prefix fallback', () => {
    expect(
      lookupPrimeBossHp('Screamer Killer', 'L5', { screamer_L5: 450 }, 1)
    ).toBe(450)
  })
})
