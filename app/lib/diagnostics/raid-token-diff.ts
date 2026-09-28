/**
 * Measures whether `unique_battle_record_complete` collapses distinct battles into one
 * row. rawType is a classification, never the raw upstream string.
 */
import { toNumberValue, toStringValue } from '@/app/lib/sync/transformers'

type RawTypeClass = 'present' | 'falsy' | 'absent'

/** Absent, null and unparseable are distinct upstream shapes. */
type RawEncounterIndexClass =
  | { kind: 'absent' }
  | { kind: 'null' }
  | { kind: 'unparseable' }
  | { kind: 'valid'; value: number }

export interface RawDiscriminators {
  rawType: RawTypeClass
  rawEncounterIndex: RawEncounterIndexClass
  rawUserIdEmpty: boolean
}

/** Mirrors processRaidEntry's field access. */
export function classifyRawDiscriminators(
  entry: Record<string, unknown>
): RawDiscriminators {
  const rawType: RawTypeClass =
    !('type' in entry) || entry.type === undefined
      ? 'absent'
      : entry.type
        ? 'present'
        : 'falsy'

  let rawEncounterIndex: RawEncounterIndexClass
  if (!('encounterIndex' in entry) || entry.encounterIndex === undefined) {
    rawEncounterIndex = { kind: 'absent' }
  } else if (entry.encounterIndex === null) {
    rawEncounterIndex = { kind: 'null' }
  } else {
    const parsed = toNumberValue(entry.encounterIndex)
    rawEncounterIndex =
      parsed === null
        ? { kind: 'unparseable' }
        : { kind: 'valid', value: Math.trunc(parsed) }
  }

  const rawUserIdEmpty = toStringValue(entry.userId, '').trim() === ''

  return { rawType, rawEncounterIndex, rawUserIdEmpty }
}

export interface RaidRowKey {
  Guild: string
  Season: string
  userId: string
  encounterId: number
  startedOn: string
  completedOn: string
  damageDealt: number
  damageType: string
}

interface UpstreamDuplicateGroup {
  key: RaidRowKey
  upstreamCount: number
  /** `upstreamCount > landedCount` is the signal. */
  landedCount: number
}

export interface TokenDiffResult {
  upstreamRowCount: number
  landedRowCount: number
  /** Only the 8 key columns: no display names, raw payload or credential. */
  unmatchedUpstreamRows: RaidRowKey[]
  upstreamDuplicateKeyGroups: UpstreamDuplicateGroup[]
}

/** JSON encoding, so no value can forge a delimiter and make two tuples collide. */
export function raidRowKeyString(row: RaidRowKey): string {
  return JSON.stringify([
    row.Guild,
    row.Season,
    row.userId,
    row.encounterId,
    row.startedOn,
    row.completedOn,
    row.damageDealt,
    row.damageType
  ])
}

/** `\0` never starts an ISO string, so sentinels cannot collide with a real instant. */
const NULL_TIMESTAMP_KEY = '\0null'
const INVALID_TIMESTAMP_PREFIX = '\0invalid:'

/** Canonicalizes timestamp renderings; unparseable values keep their raw text. */
function normalizeTimestampKey(value: unknown): string {
  if (value === null || value === undefined) return NULL_TIMESTAMP_KEY
  const raw = String(value)
  const ms = Date.parse(raw)
  if (Number.isNaN(ms)) return INVALID_TIMESTAMP_PREFIX + raw
  return new Date(ms).toISOString()
}

export function toRaidRowKey(row: {
  Guild?: unknown
  Season?: unknown
  userId?: unknown
  encounterId?: unknown
  startedOn?: unknown
  completedOn?: unknown
  damageDealt?: unknown
  damageType?: unknown
}): RaidRowKey {
  return {
    Guild: String(row.Guild ?? ''),
    Season: String(row.Season ?? ''),
    userId: String(row.userId ?? ''),
    encounterId: Number(row.encounterId ?? 0),
    startedOn: normalizeTimestampKey(row.startedOn),
    completedOn: normalizeTimestampKey(row.completedOn),
    damageDealt: Number(row.damageDealt ?? 0),
    damageType: String(row.damageType ?? '')
  }
}

/** The N+1'th upstream copy of a tuple that landed N times is unmatched. */
export function diffRaidRows(
  upstream: RaidRowKey[],
  landed: RaidRowKey[]
): TokenDiffResult {
  const landedRemaining = new Map<string, number>()
  const landedTotals = new Map<string, number>()
  for (const row of landed) {
    const k = raidRowKeyString(row)
    landedRemaining.set(k, (landedRemaining.get(k) ?? 0) + 1)
    landedTotals.set(k, (landedTotals.get(k) ?? 0) + 1)
  }

  const unmatchedUpstreamRows: RaidRowKey[] = []
  const upstreamTotals = new Map<string, { key: RaidRowKey; count: number }>()

  for (const row of upstream) {
    const k = raidRowKeyString(row)

    const seen = upstreamTotals.get(k)
    if (seen) {
      seen.count += 1
    } else {
      upstreamTotals.set(k, { key: row, count: 1 })
    }

    const remaining = landedRemaining.get(k) ?? 0
    if (remaining > 0) {
      landedRemaining.set(k, remaining - 1)
    } else {
      unmatchedUpstreamRows.push(row)
    }
  }

  const upstreamDuplicateKeyGroups: UpstreamDuplicateGroup[] = []
  for (const [k, { key, count }] of upstreamTotals) {
    if (count > 1) {
      upstreamDuplicateKeyGroups.push({
        key,
        upstreamCount: count,
        landedCount: landedTotals.get(k) ?? 0
      })
    }
  }

  return {
    upstreamRowCount: upstream.length,
    landedRowCount: landed.length,
    unmatchedUpstreamRows,
    upstreamDuplicateKeyGroups
  }
}

/** Message is always a fixed literal, so it is safe to log. */
export class DiffInvariantViolation extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'DiffInvariantViolation'
  }
}

/** A violation means the diff is broken; never return it as a 200. */
export function assertDiffInvariants(diff: TokenDiffResult): void {
  if (diff.unmatchedUpstreamRows.length > diff.upstreamRowCount) {
    throw new DiffInvariantViolation(
      'unmatchedUpstreamRows.length exceeds upstreamRowCount'
    )
  }
  if (
    diff.unmatchedUpstreamRows.length === diff.upstreamRowCount &&
    diff.landedRowCount > 0
  ) {
    throw new DiffInvariantViolation(
      'every upstream row reported unmatched while landed rows exist'
    )
  }
}

/** Slicing is safe: `\0` sentinels sort below digits and never match a real date. */
export function finalDayUtc(rows: RaidRowKey[]): string | null {
  let latest: string | null = null
  for (const row of rows) {
    const t = row.completedOn
    if (!t) continue
    if (latest === null || t > latest) latest = t
  }
  return latest ? latest.slice(0, 10) : null
}

export function isOnUtcDay(row: RaidRowKey, day: string): boolean {
  return row.completedOn.slice(0, 10) === day
}
