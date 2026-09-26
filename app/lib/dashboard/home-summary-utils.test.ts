import { describe, it, expect } from 'vitest'
import {
  advanceBossToNextStage,
  isOrphanPrime
} from '@/app/lib/dashboard/home-summary-utils'
import type { LandingPageBossOverview } from '@/app/lib/dashboard/home-summary-types'

function boss(
  over: Partial<LandingPageBossOverview> = {}
): LandingPageBossOverview {
  return {
    name: 'Ghazghkull',
    displayName: 'M2 Ghazghkull',
    rarity: 'Mythic',
    levelCode: 'M2',
    loop: 6,
    maxHp: 100,
    remainingHp: 100,
    hpPercentage: 100,
    formattedMaxHp: '100',
    formattedRemainingHp: '100',
    encounterId: 1,
    ...over
  }
}

describe('isOrphanPrime', () => {
  it('flags a prime one difficulty tier below the main (L1 under M2)', () => {
    expect(isOrphanPrime(boss({ levelCode: 'L1' }), 'M2')).toBe(true)
  })

  it('flags any stage mismatch, including a higher tier', () => {
    expect(isOrphanPrime(boss({ levelCode: 'M3' }), 'M2')).toBe(true)
    expect(isOrphanPrime(boss({ levelCode: 'L4' }), 'L3')).toBe(true)
  })

  it('does not flag a same-stage prime (the legitimate case)', () => {
    expect(isOrphanPrime(boss({ levelCode: 'M2' }), 'M2')).toBe(false)
  })

  it('treats an absent prime slot as not-orphan (nothing to drop)', () => {
    expect(isOrphanPrime(null, 'M2')).toBe(false)
    expect(isOrphanPrime(undefined, 'M2')).toBe(false)
  })
})

describe('advanceBossToNextStage degradation', () => {
  it('refuses advancement when the observed stage is absent from config', () => {
    const observed = boss({
      levelCode: 'M4',
      displayName: 'M4 Ghazghkull',
      remainingHp: 0,
      hpPercentage: 0
    })

    expect(
      advanceBossToNextStage({
        currentBoss: observed,
        rarity: 'Mythic',
        set: 3,
        loopIndex: 0,
        encounterId: 0,
        mainBossName: observed.name,
        rotationSnapshot: null,
        bossHpData: {
          legendary: {},
          mythic: {},
          primes: {},
          byBossName: {}
        },
        progressionConfig: {
          firstPassSequence: ['L1', 'M1', 'M2'],
          loopSequence: ['M1', 'M2'],
          loopStartStage: 'M1',
          gameVersion: 'test'
        }
      })
    ).toBeNull()
    expect(observed.levelCode).toBe('M4')
  })
})
