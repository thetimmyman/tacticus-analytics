// No `db()` / `next/headers` imports: client components import this file.

export type BossLifecycleState = 'active' | 'defeated' | 'upcoming' | 'warded'

export interface BossStatusRow {
  boss_name: string | null
  rarity: string | null
  set: number | null
  encounter_id: number | null
  max_hp: number | null
  remaining_hp: number | null
  loop_index: number | null
  completed_on: string | null
  lifecycle_state?: BossLifecycleState | null
  warded?: boolean | null
  alive_primes?: number | null
}

export interface BossStatusEntry extends BossStatusRow {
  lifecycle_state: BossLifecycleState
  warded: boolean
  alive_primes: number
}

const HP_EPSILON = 0
// `completed_on` is the battle-end time on every row, not a kill marker.
const isEncounterDefeatedByHp = (row: BossStatusRow): boolean => {
  if (row.remaining_hp === null || row.remaining_hp === undefined) return false
  return row.remaining_hp <= HP_EPSILON
}

const hasHpPool = (row: BossStatusRow): boolean =>
  row.max_hp !== null && row.max_hp !== undefined && row.max_hp > 0

const stageKeyOf = (row: BossStatusRow): string =>
  `${row.rarity ?? ''}|${row.set ?? ''}|${row.loop_index ?? 0}`

const tsOf = (row: BossStatusRow): number | null => {
  if (!row.completed_on) return null
  const parsed = Date.parse(row.completed_on)
  return Number.isNaN(parsed) ? null : parsed
}

// The API sometimes omits the kill hit; must match the SQL omitted-kill-inference rule.
// "Newer prime than main" is not used: primes die first, so it would flag every warded main.
const isEncounterDefeated = (
  row: BossStatusRow,
  rows: BossStatusRow[]
): boolean => {
  if (isEncounterDefeatedByHp(row)) return true
  if (!hasHpPool(row)) return false
  const rowTs = tsOf(row)
  if (rowTs === null) return false
  const rowStage = stageKeyOf(row)
  return rows.some((other) => {
    const otherTs = tsOf(other)
    return otherTs !== null && otherTs > rowTs && stageKeyOf(other) !== rowStage
  })
}

const isEncounterActive = (
  row: BossStatusRow,
  rows: BossStatusRow[]
): boolean => {
  if (isEncounterDefeated(row, rows)) return false
  return hasHpPool(row)
}

export function deriveLifecycleAndWarded(
  rows: BossStatusRow[]
): BossStatusEntry[] {
  if (!Array.isArray(rows) || rows.length === 0) return []

  const alreadyDecorated = rows.every(
    (r) =>
      typeof r.lifecycle_state === 'string' &&
      typeof r.warded === 'boolean' &&
      typeof r.alive_primes === 'number'
  )
  if (alreadyDecorated) {
    return rows as BossStatusEntry[]
  }

  const primes = rows.filter((r) => {
    const eid = r.encounter_id ?? 0
    return eid === 1 || eid === 2
  })
  const alivePrimes = primes.filter((r) => isEncounterActive(r, rows)).length

  return rows.map<BossStatusEntry>((row) => {
    const encounter = row.encounter_id ?? 0
    const isMain = encounter === 0
    const defeated = isEncounterDefeated(row, rows)
    const active = isEncounterActive(row, rows)

    let lifecycle: BossLifecycleState
    if (defeated) {
      lifecycle = 'defeated'
    } else if (isMain && alivePrimes > 0 && active) {
      lifecycle = 'warded'
    } else if (active) {
      lifecycle = 'active'
    } else {
      lifecycle = 'upcoming'
    }

    return {
      ...row,
      lifecycle_state: lifecycle,
      warded: isMain && alivePrimes > 0 && !defeated,
      alive_primes: alivePrimes
    }
  })
}
