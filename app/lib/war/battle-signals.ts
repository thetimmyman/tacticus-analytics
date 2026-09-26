// Loki's `attempt_result` says 'win' for failed partial-damage attacks and omits `remainingHPAfter`
// for dead units, so both are re-derived from lineup JSON.

export type BattleSignalRow = {
  attempt_result?: string | null
  attacker_units_json?: unknown
  defender_units_json?: unknown
  attacker_units_lost?: number | null
  raw_loki_data?: unknown
  buffs?: unknown
  defender_player_id?: string | null
}

export const readBuffList = (raw: unknown): unknown[] | null => {
  if (!raw || typeof raw !== 'object') return null
  const record = raw as Record<string, unknown>

  if (Array.isArray(record.buffs)) return record.buffs

  if (record.battleSummary && typeof record.battleSummary === 'object') {
    const summary = record.battleSummary as Record<string, unknown>
    if (Array.isArray(summary.buffs)) return summary.buffs
  }

  if (record.log && typeof record.log === 'object') {
    const log = record.log as Record<string, unknown>
    if (Array.isArray(log.buffs)) return log.buffs
  }

  return null
}

export const countMedicaeBuff = (raw: unknown): number => {
  const buffs = readBuffList(raw)
  if (!buffs) return 0
  return buffs.filter((b) => {
    const buff = b as Record<string, unknown>
    return (
      typeof buff?.abilityId === 'string' &&
      buff.abilityId.startsWith('EnvDefenderHealthBuff')
    )
  }).length
}

/** Same source preference as War Points scoring: `buffs` column, else raw log. */
export const countMedicaeForRow = (row: BattleSignalRow): number =>
  countMedicaeBuff(row.buffs != null ? { buffs: row.buffs } : row.raw_loki_data)

// Units missing remainingHPAfter while others have it are dead.
export function getAttackerLineup(row: BattleSignalRow): unknown[] | null {
  const units = row.attacker_units_json
  if (Array.isArray(units)) return units
  const log = (row.raw_loki_data as Record<string, unknown> | null)?.log as
    Record<string, unknown> | undefined
  const attacker = log?.attacker as Record<string, unknown> | undefined
  return Array.isArray(attacker?.units) ? attacker.units : null
}

/** Defender survival is ground truth; falls back to attacker team-wipe without defender data. */
export function isFailedAttack(row: BattleSignalRow): boolean {
  if (row.attempt_result === 'loss') return true
  const defenders = Array.isArray(row.defender_units_json)
    ? row.defender_units_json
    : null
  if (defenders && defenders.length > 0) {
    const anyDefenderAlive = defenders.some((u) => {
      const hp = (u as Record<string, unknown>).remainingHPAfter
      return typeof hp === 'number' && hp > 0
    })
    return anyDefenderAlive
  }
  const lineup = getAttackerLineup(row)
  if (!lineup || lineup.length === 0) return false
  return lineup.every(
    (u) => (u as Record<string, unknown>).remainingHPAfter == null
  )
}

/** A win is a captured zone (`war_zone_captured()`). Rows with no attempt_result count in
 * denominators but never as wins, or the no-signal fallback would inflate win rates. */
export function isAttemptWin(row: BattleSignalRow): boolean {
  if (row.attempt_result == null) return false
  return !isFailedAttack(row)
}

export function inferAttackerUnitsLost(row: BattleSignalRow): number {
  const stored = row.attacker_units_lost
  if (stored != null && stored > 0) return stored

  const lineup = getAttackerLineup(row)
  if (!lineup || lineup.length === 0) return stored ?? 0
  const hasAnyAfterData = lineup.some(
    (u) => (u as Record<string, unknown>).remainingHPAfter != null
  )
  if (!hasAnyAfterData) return stored ?? 0
  return lineup.filter(
    (u) => (u as Record<string, unknown>).remainingHPAfter == null
  ).length
}

/** Defenders alive at attack start; null unless every defender has before-HP (unknowns are not dead). */
export function countDefendersAliveAtStart(
  row: BattleSignalRow
): number | null {
  const defenders = Array.isArray(row.defender_units_json)
    ? row.defender_units_json
    : null
  if (!defenders || defenders.length === 0) return null
  let alive = 0
  for (const u of defenders) {
    const hp = (u as Record<string, unknown>).remainingHPBefore
    if (typeof hp !== 'number') return null
    if (hp > 0) alive += 1
  }
  return alive
}

/** NPC default-defender unit id prefix (GlobalConfig `zoneTiers[].npcUnitId`). */
const NPC_UNIT_ID_PREFIX = 'templNpc1Initiate'

/** Needs both: no defending player and all-NPC units, since player-defended zones can field NPCs. */
export function isNpcDefenderBattle(row: BattleSignalRow): boolean {
  if (row.defender_player_id != null) return false
  const defenders = Array.isArray(row.defender_units_json)
    ? row.defender_units_json
    : null
  if (!defenders || defenders.length === 0) return false
  return defenders.every((u) => {
    const unitId = (u as Record<string, unknown>).unitId
    return typeof unitId === 'string' && unitId.startsWith(NPC_UNIT_ID_PREFIX)
  })
}
