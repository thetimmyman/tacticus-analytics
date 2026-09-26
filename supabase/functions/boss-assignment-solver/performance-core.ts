// Pure aggregation (no Deno imports) for vitest. bossAvg is sweep-free; playerAvg adds sweeps >= max(own
// non-sweep avg, boss baseline). Sweep contamination here mis-allocates solver tokens.

import {
  isSweepRow,
  applyQualifyingSweepException
} from '../_shared/damage-classification.ts'

export type PerformanceRow = {
  bossKey: string
  displayName: string
  damageDealt: number
  remainingHp: number | null
  maxHp: number | null
}

export type PerformanceAggregates = {
  playerAvg: Map<string, Map<string, number>>
  bossAvg: Map<string, number>
  battlesByPlayer: Map<string, number>
}

export function aggregatePerformanceRows(
  rows: PerformanceRow[]
): PerformanceAggregates {
  const battlesByPlayer = new Map<string, number>()
  const baselineDamage = new Map<string, number>()
  const baselineCount = new Map<string, number>()

  type PlayerBossStats = {
    nonSweepDamage: number
    nonSweepCount: number
    sweepDamages: number[]
  }
  const perPlayer = new Map<string, Map<string, PlayerBossStats>>()

  for (const row of rows) {
    battlesByPlayer.set(
      row.displayName,
      (battlesByPlayer.get(row.displayName) ?? 0) + 1
    )

    const perBoss =
      perPlayer.get(row.displayName) ?? new Map<string, PlayerBossStats>()
    perPlayer.set(row.displayName, perBoss)
    const stats = perBoss.get(row.bossKey) ?? {
      nonSweepDamage: 0,
      nonSweepCount: 0,
      sweepDamages: []
    }
    perBoss.set(row.bossKey, stats)

    if (isSweepRow(row)) {
      stats.sweepDamages.push(row.damageDealt)
    } else {
      stats.nonSweepDamage += row.damageDealt
      stats.nonSweepCount += 1
      baselineDamage.set(
        row.bossKey,
        (baselineDamage.get(row.bossKey) ?? 0) + row.damageDealt
      )
      baselineCount.set(row.bossKey, (baselineCount.get(row.bossKey) ?? 0) + 1)
    }
  }

  const bossAvg = new Map<string, number>()
  baselineDamage.forEach((total, key) => {
    const count = baselineCount.get(key) ?? 0
    if (count > 0) bossAvg.set(key, total / count)
  })

  const playerAvg = new Map<string, Map<string, number>>()
  perPlayer.forEach((perBoss, playerName) => {
    const avgMap = new Map<string, number>()
    perBoss.forEach((stats, bossKey) => {
      const playerNonSweepAvg =
        stats.nonSweepCount > 0 ? stats.nonSweepDamage / stats.nonSweepCount : 0
      const { adjustedDamage, adjustedCount } = applyQualifyingSweepException(
        stats.nonSweepDamage,
        stats.nonSweepCount,
        stats.sweepDamages,
        bossAvg.get(bossKey) ?? 0,
        playerNonSweepAvg
      )
      // Only non-qualifying sweeps: emit no average (the solver uses the baseline).
      if (adjustedCount > 0) {
        avgMap.set(bossKey, adjustedDamage / adjustedCount)
      }
    })
    playerAvg.set(playerName, avgMap)
  })

  return { playerAvg, bossAvg, battlesByPlayer }
}
