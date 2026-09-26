/** Uses live bombs: persisted breach rows leak because encounter indexes repeat per stage. */

export interface LiveBombRangeRow {
  encounter_id: number | null
  remaining_hp: number | null
}

/** [] when any input is unavailable. */
export function computeLiveBombRangeEncounters(
  aliveRows: LiveBombRangeRow[],
  bombDamagePerBomb: number | null,
  bombsAvailable: number | null,
  overkillThreshold: number
): number[] {
  if (bombDamagePerBomb == null || bombDamagePerBomb <= 0) return []
  if (bombsAvailable == null || bombsAvailable <= 0) return []
  if (!(overkillThreshold > 0)) return []
  const usable = Math.floor(bombsAvailable * overkillThreshold)
  if (usable <= 0) return []
  return aliveRows
    .filter(
      (r) =>
        typeof r.encounter_id === 'number' &&
        typeof r.remaining_hp === 'number' &&
        r.remaining_hp > 0 &&
        Math.ceil(r.remaining_hp / bombDamagePerBomb) <= usable
    )
    .map((r) => r.encounter_id as number)
}
