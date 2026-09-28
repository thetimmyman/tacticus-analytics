import { describe, it, expect, vi } from 'vitest'

// Only (Ghazghkull, L4, 1) has HP; null exercises the empty-slot path.
vi.mock(
  '@/app/lib/boss-assignments/season-planner/boss-hp',
  async (importOriginal) => {
    const actual =
      await importOriginal<
        typeof import('@/app/lib/boss-assignments/season-planner/boss-hp')
      >()
    return {
      ...actual,
      getPrimeBossMaxHp: vi.fn(
        (
          _hp: unknown,
          mainBossName: string,
          stageCode: string,
          encounterId: 1 | 2
        ): number | null =>
          mainBossName === 'Ghazghkull' &&
          stageCode === 'L4' &&
          encounterId === 1
            ? 800_000
            : null
      )
    }
  }
)

import { resolveCurrentStagePrimeOverview } from '@/app/lib/dashboard/home-summary-utils'
import type { SeasonRotationSnapshot } from '@/app/lib/loki/rotation-cache'

type RotationBoss = SeasonRotationSnapshot['currentBosses'][number]

const boss = (
  encounter_id: number,
  boss_type: string,
  boss_name: string
): RotationBoss =>
  ({
    boss_type,
    boss_name,
    set: 3, // Legendary set 3 → stage code "L4"
    encounter_id,
    rarity: 'Legendary',
    canonical: boss_type.toLowerCase(),
    variant: null
  }) as unknown as RotationBoss

const snapshotWithBothPrimes = {
  currentBosses: [
    boss(0, 'Ghazghkull', 'Ghazghkull'),
    boss(1, 'Gibbascrapz', 'Gibbascrapz'),
    boss(2, 'SomePrime', 'SomePrime')
  ]
} as unknown as SeasonRotationSnapshot

const emptyHp = {
  legendary: {},
  mythic: {},
  primes: {},
  byBossName: {}
} as never

describe('resolveCurrentStagePrimeOverview (Tier 2)', () => {
  it('fills an unfought current-stage prime at full HP, name from rotation, HP keyed on the main', () => {
    const overview = resolveCurrentStagePrimeOverview({
      stageCode: 'L4',
      loop: 2,
      encounterId: 1,
      mainBossName: 'Ghazghkull',
      rotationSnapshot: snapshotWithBothPrimes,
      bossHpData: emptyHp
    })

    expect(overview).not.toBeNull()
    expect(overview?.name).toBe('Gibbascrapz') // prime's own name, not the main's
    expect(overview?.levelCode).toBe('L4') // current stage, not a stale stage
    expect(overview?.loop).toBe(2)
    expect(overview?.rarity).toBe('Legendary')
    expect(overview?.encounterId).toBe(1)
    expect(overview?.maxHp).toBe(800_000)
    expect(overview?.remainingHp).toBe(800_000) // unfought ⇒ full HP
    expect(overview?.hpPercentage).toBe(100)
  })

  it('returns null when the boss-HP table has no entry for the prime (no fabricated 0%/dead prime)', () => {
    const overview = resolveCurrentStagePrimeOverview({
      stageCode: 'L4',
      loop: 2,
      encounterId: 2,
      mainBossName: 'Ghazghkull',
      rotationSnapshot: snapshotWithBothPrimes,
      bossHpData: emptyHp
    })
    expect(overview).toBeNull()
  })

  it('returns null for a stage that has no such prime in rotation (one-prime / zero-prime stage)', () => {
    const onePrime = {
      currentBosses: [
        boss(0, 'Ghazghkull', 'Ghazghkull'),
        boss(1, 'Gibbascrapz', 'Gibbascrapz')
      ]
    } as unknown as SeasonRotationSnapshot

    expect(
      resolveCurrentStagePrimeOverview({
        stageCode: 'L4',
        loop: 2,
        encounterId: 2,
        mainBossName: 'Ghazghkull',
        rotationSnapshot: onePrime,
        bossHpData: emptyHp
      })
    ).toBeNull()
  })

  it('returns null when there is no rotation snapshot', () => {
    expect(
      resolveCurrentStagePrimeOverview({
        stageCode: 'L4',
        loop: 2,
        encounterId: 1,
        mainBossName: 'Ghazghkull',
        rotationSnapshot: null,
        bossHpData: emptyHp
      })
    ).toBeNull()
  })

  it('does not match a prime from a different stage (stale cross-stage row stays out)', () => {
    // The M2 stage must not borrow L4 primes.
    expect(
      resolveCurrentStagePrimeOverview({
        stageCode: 'M2',
        loop: 1,
        encounterId: 2,
        mainBossName: 'Ghazghkull',
        rotationSnapshot: snapshotWithBothPrimes,
        bossHpData: emptyHp
      })
    ).toBeNull()
  })
})
