import {
  applyQualifyingSweepException,
  isSweepRow
} from '@/app/lib/calculations/utils/sweep-helpers'
import { difficultyCodeFromOneBasedSet } from '@/app/lib/boss-ops/identity'

export interface BossAssignmentDamageRow {
  displayName: string | null
  Name: string | null
  set: number | null
  damageDealt: number | null
  remainingHp: number | null
  maxHp: number | null
  Season: string | null
  rarity: string | null
}

export type BossAssignmentAverageDamageMap = Record<
  string,
  Record<string, { total: number; count: number; average: number }>
>

interface DamageAccumulator {
  nonSweepTotal: number
  nonSweepCount: number
  sweepDamages: number[]
}

/**
 * Reference averages exclude sweeps but keep full-HP one-shots; a player's numerator adds
 * back only sweeps above both the reference and their own non-sweep average.
 */
export function buildBossAssignmentAverageDamageMap(
  rows: readonly BossAssignmentDamageRow[],
  selectedSeason: string
): BossAssignmentAverageDamageMap {
  const referenceByBoss = new Map<string, { total: number; count: number }>()
  const playerByBoss = new Map<string, Map<string, DamageAccumulator>>()

  for (const row of rows) {
    if (
      !row.Name ||
      !row.displayName ||
      !row.Season ||
      row.Season !== selectedSeason
    ) {
      continue
    }

    const damage = row.damageDealt ?? 0
    if (damage <= 0) continue

    const difficultyCode = difficultyCodeFromOneBasedSet(
      row.rarity === 'Mythic' ? 'Mythic' : 'Legendary',
      (row.set ?? 0) + 1
    )
    const bossKey = `${row.Name}_${difficultyCode}`
    let bosses = playerByBoss.get(row.displayName)
    if (!bosses) {
      bosses = new Map()
      playerByBoss.set(row.displayName, bosses)
    }
    const player = bosses.get(bossKey) ?? {
      nonSweepTotal: 0,
      nonSweepCount: 0,
      sweepDamages: []
    }

    if (isSweepRow(row)) {
      player.sweepDamages.push(damage)
    } else {
      player.nonSweepTotal += damage
      player.nonSweepCount += 1
      const reference = referenceByBoss.get(bossKey) ?? { total: 0, count: 0 }
      reference.total += damage
      reference.count += 1
      referenceByBoss.set(bossKey, reference)
    }
    bosses.set(bossKey, player)
  }

  const resultEntries: Array<
    [string, Record<string, { total: number; count: number; average: number }>]
  > = []
  playerByBoss.forEach((bosses, playerName) => {
    const bossEntries: Array<
      [string, { total: number; count: number; average: number }]
    > = []
    bosses.forEach((player, bossKey) => {
      const reference = referenceByBoss.get(bossKey)
      const referenceAvg =
        reference && reference.count > 0 ? reference.total / reference.count : 0
      const playerNonSweepAvg =
        player.nonSweepCount > 0
          ? player.nonSweepTotal / player.nonSweepCount
          : 0
      const { adjustedDamage, adjustedCount } = applyQualifyingSweepException(
        player.nonSweepTotal,
        player.nonSweepCount,
        player.sweepDamages,
        referenceAvg,
        playerNonSweepAvg
      )

      // An only-ever-swept player with no qualifying row has no average; leave it absent.
      if (adjustedCount === 0) return

      bossEntries.push([
        bossKey,
        {
          total: adjustedDamage,
          count: adjustedCount,
          average: adjustedDamage / adjustedCount
        }
      ])
    })
    if (bossEntries.length > 0) {
      // Object.fromEntries makes "__proto__" an own property and keeps a serializable plain object.
      resultEntries.push([playerName, Object.fromEntries(bossEntries)])
    }
  })

  return Object.fromEntries(resultEntries)
}
