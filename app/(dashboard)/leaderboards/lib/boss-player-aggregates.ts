/**
 * Sweep-free baseline keeping one-shots; own average re-adds sweeps above
 * GREATEST(own non-sweep avg, baseline); max stays raw. The caller excludes crashes.
 */

import {
  isSweepRow,
  applyQualifyingSweepException
} from '@/app/lib/calculations/utils/sweep-helpers'

export interface BossStatsRow {
  displayName: string | null
  userId: string | null
  Guild: string | null
  damageDealt: number | null
  remainingHp: number | null
  maxHp: number | null
}

export interface BossPlayerAggregate {
  displayName: string
  Guild: string
  userId: string | null
  avgDamage: number
  /** Non-sweeps + qualifying sweeps. */
  battleCount: number
  /** Raw, sweeps included. */
  maxDamage: number
}

/** Tacticus userId, else guild+name. */
export function stableBossPlayerId(row: {
  userId?: string | null
  Guild?: string | null
  displayName?: string | null
}): string {
  return row.userId || `${row.Guild}|${row.displayName}`
}

interface PlayerAccumulator {
  displayName: string
  Guild: string
  userId: string | null
  nonSweepTotal: number
  nonSweepCount: number
  sweepDamages: number[]
  maxDamage: number
}

export function computeBossPlayerAggregates(
  rows: BossStatsRow[]
): Map<string, BossPlayerAggregate> {
  // Two passes: the sweep gate depends on sweep-free averages.
  let referenceTotal = 0
  let referenceCount = 0
  const players = new Map<string, PlayerAccumulator>()

  for (const row of rows) {
    const damage = row.damageDealt ?? 0
    if (damage <= 0) continue

    const key = stableBossPlayerId(row)
    let player = players.get(key)
    if (!player) {
      player = {
        displayName: row.displayName ?? '',
        Guild: row.Guild ?? '',
        userId: row.userId ?? null,
        nonSweepTotal: 0,
        nonSweepCount: 0,
        sweepDamages: [],
        maxDamage: 0
      }
      players.set(key, player)
    }

    player.maxDamage = Math.max(player.maxDamage, damage)

    if (isSweepRow(row)) {
      player.sweepDamages.push(damage)
    } else {
      player.nonSweepTotal += damage
      player.nonSweepCount += 1
      referenceTotal += damage
      referenceCount += 1
    }
  }

  const referenceAvg = referenceCount > 0 ? referenceTotal / referenceCount : 0

  const result = new Map<string, BossPlayerAggregate>()
  players.forEach((player, key) => {
    const playerNonSweepAvg =
      player.nonSweepCount > 0 ? player.nonSweepTotal / player.nonSweepCount : 0
    const { adjustedDamage, adjustedCount } = applyQualifyingSweepException(
      player.nonSweepTotal,
      player.nonSweepCount,
      player.sweepDamages,
      referenceAvg,
      playerNonSweepAvg
    )
    result.set(key, {
      displayName: player.displayName,
      Guild: player.Guild,
      userId: player.userId,
      avgDamage: adjustedCount > 0 ? adjustedDamage / adjustedCount : 0,
      battleCount: adjustedCount,
      maxDamage: player.maxDamage
    })
  })

  return result
}
