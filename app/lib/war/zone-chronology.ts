/**
 * Zone state machine shared by all guild-war surfaces: a failed attack weakens
 * a fresh zone; the first win on a weakened zone is a cleanup and resets it.
 */

import { isFailedAttack, type BattleSignalRow } from './battle-signals'

export type ChronologyRow = BattleSignalRow & {
  war_id: string
  zone_id?: string | null
  player_id?: string | null
  player_name?: string | null
  attempt_end_time?: string | null
}

export const attemptPlayerId = (row: ChronologyRow): string =>
  row.player_id ?? row.player_name ?? 'Unknown'

/** Callers building a lookup key MUST use this so the two sides never drift. */
export const cleanupAttemptKey = (row: ChronologyRow): string =>
  `${row.war_id}:${row.zone_id}:${attemptPlayerId(row)}:${row.attempt_end_time}`

/** Replays rows by attempt_end_time, skipping rows without zone or result; callers pre-filter membership. */
export function detectCleanupAttempts(rows: ChronologyRow[]): Set<string> {
  const cleanupAttempts = new Set<string>()
  const zoneState = new Map<string, 'fresh' | 'weakened'>()
  const sortedByTime = [...rows]
    .filter((r) => r.zone_id && r.attempt_result != null)
    .sort((a, b) =>
      (a.attempt_end_time ?? '').localeCompare(b.attempt_end_time ?? '')
    )
  for (const row of sortedByTime) {
    const zk = `${row.war_id}:${row.zone_id}`
    const state = zoneState.get(zk) ?? 'fresh'
    if (isFailedAttack(row)) {
      zoneState.set(zk, 'weakened')
    } else {
      if (state === 'weakened') {
        cleanupAttempts.add(cleanupAttemptKey(row))
        zoneState.set(zk, 'fresh')
      }
    }
  }
  return cleanupAttempts
}

export type ZoneEventRow = {
  war_id: string
  zone_id?: string | null
  event_type: string
}

export type ZoneEventsCrossCheck = {
  /** Positive control; callers MUST log it (clean over 0 events proves nothing). */
  eventPopulation: number
  skipped: boolean
  /** Wars with a zoneDestroyed event but no detected capture; do not score them. */
  incompleteWarIds: string[]
  checkedEvents: number
  matchedEvents: number
}

/**
 * zoneDestroyed is not emitted per capture, so only the directional invariant
 * holds: each event needs at least one detected capture on its (war, zone).
 * Pass rows UNFILTERED by membership: the destroying side may be either guild.
 */
export function crossCheckZoneEvents(
  rows: ChronologyRow[],
  events: ZoneEventRow[]
): ZoneEventsCrossCheck {
  // zone_id is nullable (re-sync nulls it); with no checkable events report skipped, never clean.
  const destroyed = events.filter(
    (e) => e.event_type === 'zoneDestroyed' && e.zone_id
  )
  if (destroyed.length === 0) {
    return {
      eventPopulation: events.length,
      skipped: true,
      incompleteWarIds: [],
      checkedEvents: 0,
      matchedEvents: 0
    }
  }

  const capturedZones = new Set<string>()
  for (const row of rows) {
    if (!row.zone_id || row.attempt_result == null) continue
    if (!isFailedAttack(row)) capturedZones.add(`${row.war_id}:${row.zone_id}`)
  }

  const incomplete = new Set<string>()
  let matched = 0
  for (const event of destroyed) {
    if (capturedZones.has(`${event.war_id}:${event.zone_id}`)) {
      matched += 1
    } else {
      incomplete.add(event.war_id)
    }
  }

  return {
    eventPopulation: events.length,
    skipped: false,
    incompleteWarIds: [...incomplete].sort(),
    checkedEvents: destroyed.length,
    matchedEvents: matched
  }
}
