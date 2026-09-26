// Kept out of the client component so vitest can import them.

import { bossNamesMatch } from '@/app/lib/utils/normalize'
import type { PerformanceData, QueueStageEntry } from '../types'

type PerformanceBucket = PerformanceData[string]

// Solver `bossId` ("<stage>_main" etc.) → boss name, case-insensitive.
export function resolveSlotBossNameForStage(
  stage: QueueStageEntry,
  bossId: string
): string | null {
  const lower = bossId.toLowerCase()
  if (lower.endsWith('prime1')) return stage.prime1Boss
  if (lower.endsWith('prime2')) return stage.prime2Boss
  if (lower.endsWith('main')) return stage.mainBoss
  return null
}

function readAverageDamage(
  entry: PerformanceBucket[string] | undefined
): number | null {
  return typeof entry?.average_damage === 'number' && entry.average_damage > 0
    ? entry.average_damage
    : null
}

export function lookupAvgDamageInBucket(
  bucket: PerformanceBucket | undefined,
  bossName: string | null | undefined,
  stageCode: string
): number | null {
  if (!bucket || !bossName) return null

  const stageKey = `${bossName}_${stageCode}`
  const stageAvg = readAverageDamage(bucket[stageKey])
  if (stageAvg !== null) return stageAvg

  const bareAvg = readAverageDamage(bucket[bossName])
  if (bareAvg !== null) return bareAvg

  const fuzzyStageKey = Object.keys(bucket).find((key) =>
    bossNamesMatch(key, stageKey)
  )
  const fuzzyStageAvg = readAverageDamage(
    fuzzyStageKey ? bucket[fuzzyStageKey] : undefined
  )
  if (fuzzyStageAvg !== null) return fuzzyStageAvg

  const fuzzyBareKey = Object.keys(bucket).find((key) =>
    bossNamesMatch(key, bossName)
  )
  return readAverageDamage(fuzzyBareKey ? bucket[fuzzyBareKey] : undefined)
}

export function lookupAvgDamageForPlayer(
  performanceData: PerformanceData,
  player: { display_name: string; player_id: string },
  bossName: string | null | undefined,
  stageCode: string
): number | null {
  if (!bossName) return null
  const bucket =
    performanceData[player.display_name] ?? performanceData[player.player_id]
  if (!bucket) return null
  return lookupAvgDamageInBucket(bucket, bossName, stageCode)
}

// bossNamesMatch prefix-matches ("Magnus" matches "Magnus_L4"), so fuzzy lookups run last:
// exact stageKey, exact bare name, fuzzy stageKey, fuzzy bare name.
export function lookupAvgDamageForStage(
  stage: QueueStageEntry,
  performanceData: PerformanceData,
  displayName: string,
  playerId: string,
  bossId: string
): number | null {
  const slotBoss = resolveSlotBossNameForStage(stage, bossId)
  if (!slotBoss) return null
  return lookupAvgDamageForPlayer(
    performanceData,
    { display_name: displayName, player_id: playerId },
    slotBoss,
    stage.stageCode
  )
}
