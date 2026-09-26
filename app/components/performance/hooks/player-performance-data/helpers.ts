import type { PerformanceSummary } from '@tacticus/app-core/performance.types'
import type { PlayerAggregateRow } from '@/app/lib/boss-assignments/performance-leaderboard-aggregate'
import type {
  TokenPerformanceData,
  TokenPerformanceEntry,
  TokenPerformanceLoopEntry
} from '@/app/(dashboard)/guild-management/upcoming-assignments/types'
import type { TargetLoopRange } from './types'

export function toNonNegativeInt(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0
  return Math.max(0, Math.floor(value))
}

export function toNonNegativeIntOrNull(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  return Math.max(0, Math.floor(value))
}

export function toCappedAvailabilityOrNull(value: unknown): number | null {
  const available = toNonNegativeIntOrNull(value)
  return available === null ? null : Math.min(3, available)
}

export function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason) throw signal.reason
  const error = new Error('Aborted')
  error.name = 'AbortError'
  throw error
}

export function getTargetLoopList(
  tokenPerformance: TokenPerformanceData | null | undefined
): number[] {
  const loops = new Set<number>()

  if (!tokenPerformance) {
    return []
  }

  Object.values(tokenPerformance).forEach((bosses) => {
    Object.values(bosses).forEach((entry) => {
      Object.values(entry.perLoop ?? {}).forEach((loopEntry) => {
        if (Number.isFinite(loopEntry.loopIndex)) {
          loops.add(loopEntry.loopIndex)
        }
      })
    })
  })

  return Array.from(loops).sort((a, b) => a - b)
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(value, max))
}

function firstTargetLoopAtOrAfter(loopList: number[], value: number): number {
  const match = loopList.find((loop) => loop >= value)
  return match ?? loopList[loopList.length - 1] ?? value
}

function lastTargetLoopAtOrBefore(loopList: number[], value: number): number {
  for (let index = loopList.length - 1; index >= 0; index -= 1) {
    const loop = loopList[index]
    if (loop !== undefined && loop <= value) return loop
  }
  return loopList[0] ?? value
}

function nearestTargetLoop(
  loopList: number[],
  value: number,
  tieBias: 'lower' | 'upper'
): number {
  let nearest = loopList[0] ?? value
  let nearestDistance = Number.POSITIVE_INFINITY

  loopList.forEach((loop) => {
    const distance = Math.abs(loop - value)
    const winsTie =
      distance === nearestDistance &&
      (tieBias === 'upper' ? loop > nearest : loop < nearest)
    if (distance < nearestDistance || winsTie) {
      nearest = loop
      nearestDistance = distance
    }
  })

  return nearest
}

export function clampTargetLoopRange(
  nextStart: number,
  nextEnd: number,
  loopList: number[]
): TargetLoopRange | null {
  const firstLoop = loopList[0]
  const lastLoop = loopList[loopList.length - 1]
  if (firstLoop === undefined || lastLoop === undefined) {
    return null
  }

  const boundedStart = clampNumber(nextStart, firstLoop, lastLoop)
  const boundedEnd = clampNumber(nextEnd, firstLoop, lastLoop)
  const lowerInput = Math.min(boundedStart, boundedEnd)
  const upperInput = Math.max(boundedStart, boundedEnd)
  const start = firstTargetLoopAtOrAfter(loopList, lowerInput)
  const end = lastTargetLoopAtOrBefore(loopList, upperInput)

  if (start <= end) {
    return { start, end }
  }

  const collapsed = nearestTargetLoop(
    loopList,
    (boundedStart + boundedEnd) / 2,
    boundedStart <= boundedEnd ? 'upper' : 'lower'
  )
  return { start: collapsed, end: collapsed }
}

export function isFullTargetLoopRange(
  range: TargetLoopRange | null,
  loopList: number[]
): boolean {
  const firstLoop = loopList[0]
  const lastLoop = loopList[loopList.length - 1]
  if (!range || firstLoop === undefined || lastLoop === undefined) {
    return true
  }
  return range.start <= firstLoop && range.end >= lastLoop
}

export function hasCompleteTargetLoopCoverage(
  tokenPerformance: TokenPerformanceData | null | undefined
): boolean {
  if (!tokenPerformance) {
    return false
  }

  for (const bosses of Object.values(tokenPerformance)) {
    for (const entry of Object.values(bosses)) {
      if (entry.tokensSpent <= 0) {
        continue
      }

      const loopTokens = Object.values(entry.perLoop ?? {}).reduce(
        (sum, loopEntry) => sum + loopEntry.tokensSpent,
        0
      )

      if (Math.abs(loopTokens - entry.tokensSpent) > 1e-9) {
        return false
      }
    }
  }

  return true
}

function addTargetSummaryKey(
  keys: string[],
  namespace: string,
  value?: string
) {
  const trimmed = value?.trim()
  if (!trimmed) return
  keys.push(`${namespace}:${trimmed}`)
}

function targetSummaryLookupKeys(summary: PerformanceSummary): string[] {
  const keys: string[] = []
  addTargetSummaryKey(keys, 'id', summary.playerId)
  addTargetSummaryKey(keys, 'name', summary.displayName.toLowerCase())
  return keys
}

function targetAggregateLookupKeys(row: PlayerAggregateRow): string[] {
  const keys: string[] = []
  addTargetSummaryKey(keys, 'id', row.playerId)
  addTargetSummaryKey(keys, 'name', row.playerName.toLowerCase())
  addTargetSummaryKey(keys, 'name', row.playerKey?.toLowerCase())
  return keys
}

export function targetAggregateCalculationId(row: PlayerAggregateRow): string {
  const key =
    row.playerKey?.trim() ||
    row.playerId?.trim() ||
    row.playerName.trim().toLowerCase()
  return `target-weighted:${key}`
}

export function buildTargetWeightedCalculationSummaries(
  basePlayerSummaries: PerformanceSummary[],
  targetRows: PlayerAggregateRow[]
): PerformanceSummary[] {
  const summariesByKey = new Map<string, PerformanceSummary>()
  basePlayerSummaries.forEach((summary) => {
    targetSummaryLookupKeys(summary).forEach((key) => {
      summariesByKey.set(key, summary)
    })
  })

  return targetRows.map((row) => {
    const existing = targetAggregateLookupKeys(row)
      .map((key) => summariesByKey.get(key))
      .find((summary): summary is PerformanceSummary => !!summary)
    const targetPlayerId = targetAggregateCalculationId(row)

    if (existing) {
      return {
        ...existing,
        playerId: targetPlayerId,
        isActive: true
      }
    }

    const bossHits = Object.entries(row.tierCounts).reduce(
      (sum, [tier, count]) =>
        tier.toLowerCase().includes('prime') ? sum : sum + count,
      0
    )
    const primeHits = Math.max(0, row.bossCount - bossHits)

    return {
      displayName: row.playerName,
      playerId: targetPlayerId,
      avg_vs_cluster: 0,
      avg_vs_guild: 0,
      avg_vs_cluster_boss_only: 0,
      avg_vs_guild_boss_only: 0,
      total_battles: row.tokensSpent,
      bosses_played: row.bossCount,
      primes_played: primeHits,
      boss_hits: bossHits,
      prime_hits: primeHits,
      isActive: true
    }
  })
}

export function filterTokenPerformanceByLoopRange(
  tokenPerformance: TokenPerformanceData,
  range: TargetLoopRange
): TokenPerformanceData {
  const filtered: TokenPerformanceData = {}

  Object.entries(tokenPerformance).forEach(([playerKey, bosses]) => {
    const nextBosses: Record<string, TokenPerformanceEntry> = {}

    Object.entries(bosses).forEach(([bossKey, entry]) => {
      const loopEntries = Object.values(entry.perLoop ?? {}).filter(
        (loopEntry) =>
          loopEntry.loopIndex >= range.start && loopEntry.loopIndex <= range.end
      )

      if (loopEntries.length === 0) {
        return
      }

      const tokensSpent = loopEntries.reduce(
        (sum, loopEntry) => sum + loopEntry.tokensSpent,
        0
      )

      if (tokensSpent <= 0) {
        return
      }

      const actualDamage = loopEntries.reduce(
        (sum, loopEntry) => sum + loopEntry.actualDamage,
        0
      )
      const scoreParts = loopEntries.reduce(
        (acc, loopEntry) => {
          if (
            loopEntry.score !== null &&
            Number.isFinite(loopEntry.score) &&
            loopEntry.tokensSpent > 0
          ) {
            acc.numerator += loopEntry.score * loopEntry.tokensSpent
            acc.denominator += loopEntry.tokensSpent
          }
          return acc
        },
        { numerator: 0, denominator: 0 }
      )
      const score =
        scoreParts.denominator > 0
          ? scoreParts.numerator / scoreParts.denominator
          : null
      const expectedDamage =
        entry.expectedDamage !== null && entry.tokensSpent > 0
          ? (entry.expectedDamage / entry.tokensSpent) * tokensSpent
          : null
      const perLoop = loopEntries.reduce<
        Record<number, TokenPerformanceLoopEntry>
      >((acc, loopEntry) => {
        acc[loopEntry.loopIndex] = loopEntry
        return acc
      }, {})

      nextBosses[bossKey] = {
        ...entry,
        score,
        tokensSpent,
        actualDamage,
        expectedDamage,
        perLoop
      }
    })

    if (Object.keys(nextBosses).length > 0) {
      filtered[playerKey] = nextBosses
    }
  })

  return filtered
}

export function setUniqueName<T>(
  map: Map<string, T>,
  duplicates: Set<string>,
  nameKey: string,
  value: T
) {
  if (!nameKey || duplicates.has(nameKey)) return
  if (map.has(nameKey)) {
    map.delete(nameKey)
    duplicates.add(nameKey)
    return
  }
  map.set(nameKey, value)
}
