/**
 * Levels a guild still replays: the loop restarts at the lowest level played at
 * loopIndex >= 1 (the config is server-only); lower levels are first-pass-only.
 */

import {
  RARITY_HIERARCHY,
  getRarityPrefix,
  normalizeRarity
} from '@tacticus/app-core/rarity-utils'

/** RARITY_HIERARCHY is strongest-first; this is ascending. */
const RANK_BY_PREFIX: ReadonlyMap<string, number> = new Map(
  RARITY_HIERARCHY.map((rarity, index) => [
    getRarityPrefix(rarity),
    RARITY_HIERARCHY.length - 1 - index
  ])
)

const RARITY_BAND = 100

/** Null for non-level codes, so they are never hidden. */
export function ladderOrdinal(levelCode: string): number | null {
  if (typeof levelCode !== 'string') return null
  const match = /^([A-Za-z])(\d+)$/.exec(levelCode.trim())
  if (!match) return null
  const prefix = match[1]!.toUpperCase()
  const setNumber = Number.parseInt(match[2]!, 10)
  const rank = RANK_BY_PREFIX.get(prefix)
  if (rank === undefined || !Number.isFinite(setNumber) || setNumber < 1) {
    return null
  }
  return rank * RARITY_BAND + (setNumber - 1)
}

export function levelCodeFrom(
  rarity: string | null | undefined,
  set: number | null | undefined
): string | null {
  const normalized = normalizeRarity(rarity)
  if (!normalized) return null
  if (typeof set !== 'number' || !Number.isFinite(set) || set < 0) return null
  return `${getRarityPrefix(normalized)}${Math.trunc(set) + 1}`
}

export interface LoopObservation {
  level: string
  maxLoopIndex: number
  guild?: string | null
}

function guildRestartOrdinal(
  observations: readonly LoopObservation[]
): number | null {
  let lowest: number | null = null
  for (const observation of observations) {
    if (!Number.isFinite(observation.maxLoopIndex)) continue
    if (observation.maxLoopIndex < 1) continue
    const ordinal = ladderOrdinal(observation.level)
    if (ordinal === null) continue
    if (lowest === null || ordinal < lowest) lowest = ordinal
  }
  return lowest
}

/** A level is hidden only once every guild is past it. */
export function resolveLoopRestartOrdinal(
  observations: readonly LoopObservation[]
): number | null {
  if (observations.length === 0) return null

  const byGuild = new Map<string, LoopObservation[]>()
  for (const observation of observations) {
    const key = observation.guild ?? ''
    const bucket = byGuild.get(key)
    if (bucket) bucket.push(observation)
    else byGuild.set(key, [observation])
  }

  let lowestRestart: number | null = null
  for (const bucket of byGuild.values()) {
    const restart = guildRestartOrdinal(bucket)
    if (restart === null) return null
    if (lowestRestart === null || restart < lowestRestart)
      lowestRestart = restart
  }
  return lowestRestart
}

export function isBelowLoopWindow(
  levelCode: string,
  restartOrdinal: number | null
): boolean {
  if (restartOrdinal === null) return false
  const ordinal = ladderOrdinal(levelCode)
  return ordinal !== null && ordinal < restartOrdinal
}

export function filterToLoopWindow<T>(
  items: readonly T[],
  getLevel: (item: T) => string,
  observations: readonly LoopObservation[]
): T[] {
  const floor = resolveLoopRestartOrdinal(observations)
  if (floor === null) return [...items]
  return items.filter((item) => !isBelowLoopWindow(getLevel(item), floor))
}

export function toLoopObservations(
  rows: ReadonlyArray<{
    rarity?: string | null
    set?: number | null
    loopIndex?: number | null
    Guild?: string | null
  }>
): LoopObservation[] {
  const byKey = new Map<string, LoopObservation>()
  for (const row of rows) {
    const level = levelCodeFrom(row.rarity, row.set)
    if (!level) continue
    const guild = row.Guild ?? ''
    const loopIndex =
      typeof row.loopIndex === 'number' && Number.isFinite(row.loopIndex)
        ? row.loopIndex
        : 0
    const key = `${guild}\u0000${level}`
    const existing = byKey.get(key)
    if (existing) {
      if (loopIndex > existing.maxLoopIndex) existing.maxLoopIndex = loopIndex
    } else {
      byKey.set(key, { level, maxLoopIndex: loopIndex, guild })
    }
  }
  return Array.from(byKey.values())
}
