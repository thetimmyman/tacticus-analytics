/** Pure, so client-safe. */

import type { LandingPageBossOverview } from '@/app/lib/dashboard/home-summary-types'
import type { PrimeTarget } from './types'

export interface PrimeBossPair {
  prime1: LandingPageBossOverview | null
  prime2: LandingPageBossOverview | null
}

export interface PrimeSeasonOps {
  side1Behaviour: 'skip' | 'kill' | 'threshold'
  side2Behaviour: 'skip' | 'kill' | 'threshold'
  side1ThresholdHpPct: number | null
  side2ThresholdHpPct: number | null
}

function toTarget(
  prime: LandingPageBossOverview | null,
  encounterId: 1 | 2,
  behaviour: 'skip' | 'kill' | 'threshold',
  thresholdHpPct: number | null
): PrimeTarget | null {
  if (!prime) return null
  if (behaviour === 'skip') return null

  const hp = prime.hpPercentage
  if (!(hp > 0)) return null
  if (
    behaviour === 'threshold' &&
    typeof thresholdHpPct === 'number' &&
    hp <= thresholdHpPct
  ) {
    return null
  }

  return {
    encounterId,
    name: prime.name,
    displayName: prime.displayName,
    levelCode: prime.levelCode,
    hpPercentage: hp,
    remainingHp: Number.isFinite(prime.remainingHp) ? prime.remainingHp : null,
    behaviour: behaviour === 'threshold' ? 'threshold' : 'kill',
    thresholdHpPct: behaviour === 'threshold' ? thresholdHpPct : null
  }
}

/** Primes whose stage differs from `mainLevelCode` are orphans and are dropped. */
export function resolvePrimeTargets(
  primeBosses: PrimeBossPair | null | undefined,
  ops: PrimeSeasonOps | null,
  mainLevelCode?: string
): PrimeTarget[] {
  if (!primeBosses) return []

  const side1 = toTarget(
    primeBosses.prime1,
    1,
    ops?.side1Behaviour ?? 'kill',
    ops?.side1ThresholdHpPct ?? null
  )
  const side2 = toTarget(
    primeBosses.prime2,
    2,
    ops?.side2Behaviour ?? 'kill',
    ops?.side2ThresholdHpPct ?? null
  )

  return [side1, side2].filter(
    (t): t is PrimeTarget =>
      t !== null && (!mainLevelCode || t.levelCode === mainLevelCode)
  )
}
