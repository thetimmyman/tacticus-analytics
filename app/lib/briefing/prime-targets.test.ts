import { describe, it, expect } from 'vitest'
import {
  resolvePrimeTargets,
  type PrimeSeasonOps
} from '@/app/lib/briefing/prime-targets'
import type { LandingPageBossOverview } from '@/app/lib/dashboard/home-summary-types'

function prime(
  over: Partial<LandingPageBossOverview> = {}
): LandingPageBossOverview {
  return {
    name: 'Szarekh',
    displayName: 'Prime One',
    rarity: 'Mythic',
    levelCode: 'M2',
    loop: 0,
    maxHp: 100,
    remainingHp: 64,
    hpPercentage: 64,
    formattedMaxHp: '100',
    formattedRemainingHp: '64',
    encounterId: 1,
    ...over
  }
}

function ops(over: Partial<PrimeSeasonOps> = {}): PrimeSeasonOps {
  return {
    side1Behaviour: 'kill',
    side2Behaviour: 'kill',
    side1ThresholdHpPct: null,
    side2ThresholdHpPct: null,
    ...over
  }
}

describe('resolvePrimeTargets', () => {
  it('includes both live kill primes, ordered Prime 1 then Prime 2', () => {
    const result = resolvePrimeTargets(
      {
        prime1: prime({ encounterId: 1, displayName: 'P1', hpPercentage: 80 }),
        prime2: prime({ encounterId: 2, displayName: 'P2', hpPercentage: 40 })
      },
      ops()
    )
    expect(result.map((t) => t.encounterId)).toEqual([1, 2])
    expect(result[0]).toMatchObject({
      encounterId: 1,
      behaviour: 'kill',
      thresholdHpPct: null,
      hpPercentage: 80,
      remainingHp: 64
    })
  })

  it('excludes a dead prime (hp 0)', () => {
    const result = resolvePrimeTargets(
      {
        prime1: prime({ encounterId: 1, hpPercentage: 0 }),
        prime2: prime({ encounterId: 2, hpPercentage: 50 })
      },
      ops()
    )
    expect(result.map((t) => t.encounterId)).toEqual([2])
  })

  it('excludes a skip-marked side', () => {
    const result = resolvePrimeTargets(
      {
        prime1: prime({ encounterId: 1, hpPercentage: 70 }),
        prime2: prime({ encounterId: 2, hpPercentage: 70 })
      },
      ops({ side1Behaviour: 'skip' })
    )
    expect(result.map((t) => t.encounterId)).toEqual([2])
  })

  it('includes a threshold prime while above its threshold', () => {
    const result = resolvePrimeTargets(
      {
        prime1: prime({ encounterId: 1, hpPercentage: 64 }),
        prime2: null
      },
      ops({ side1Behaviour: 'threshold', side1ThresholdHpPct: 20 })
    )
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      encounterId: 1,
      behaviour: 'threshold',
      thresholdHpPct: 20
    })
  })

  it('excludes a threshold prime once at/below its threshold', () => {
    const atThreshold = resolvePrimeTargets(
      { prime1: prime({ encounterId: 1, hpPercentage: 20 }), prime2: null },
      ops({ side1Behaviour: 'threshold', side1ThresholdHpPct: 20 })
    )
    const belowThreshold = resolvePrimeTargets(
      { prime1: prime({ encounterId: 1, hpPercentage: 15 }), prime2: null },
      ops({ side1Behaviour: 'threshold', side1ThresholdHpPct: 20 })
    )
    expect(atThreshold).toHaveLength(0)
    expect(belowThreshold).toHaveLength(0)
  })

  it('defaults to kill when ops is null (no playbook config)', () => {
    const result = resolvePrimeTargets(
      {
        prime1: prime({ encounterId: 1, hpPercentage: 90 }),
        prime2: prime({ encounterId: 2, hpPercentage: 10 })
      },
      null
    )
    expect(result.map((t) => t.behaviour)).toEqual(['kill', 'kill'])
    expect(result).toHaveLength(2)
  })

  it('returns [] when both primes are absent', () => {
    expect(resolvePrimeTargets({ prime1: null, prime2: null }, ops())).toEqual(
      []
    )
    expect(resolvePrimeTargets(null, ops())).toEqual([])
    expect(resolvePrimeTargets(undefined, ops())).toEqual([])
  })

  it('keeps only the surviving prime when the other is null', () => {
    const result = resolvePrimeTargets(
      { prime1: null, prime2: prime({ encounterId: 2, hpPercentage: 55 }) },
      ops()
    )
    expect(result.map((t) => t.encounterId)).toEqual([2])
  })

  it('drops a prime whose stage differs from the current main (mainLevelCode)', () => {
    const result = resolvePrimeTargets(
      {
        prime1: prime({
          encounterId: 1,
          levelCode: 'L1',
          displayName: "Sho'Syl",
          hpPercentage: 100
        }),
        prime2: prime({ encounterId: 2, levelCode: 'M2', hpPercentage: 70 })
      },
      ops(),
      'M2'
    )
    expect(result.map((t) => t.encounterId)).toEqual([2])
    expect(result.every((t) => t.levelCode === 'M2')).toBe(true)
  })

  it('keeps all primes when mainLevelCode is omitted (no guard)', () => {
    const result = resolvePrimeTargets(
      {
        prime1: prime({ encounterId: 1, levelCode: 'L1', hpPercentage: 100 }),
        prime2: prime({ encounterId: 2, levelCode: 'M2', hpPercentage: 70 })
      },
      ops()
    )
    expect(result.map((t) => t.encounterId)).toEqual([1, 2])
  })
})
