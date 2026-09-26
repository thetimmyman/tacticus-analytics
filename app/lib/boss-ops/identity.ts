/**
 * `set` is 1-based on boss_target_tokens/SlotEntry/MergedRow but 0-based on the hub's
 * `setNumber`; a wrong base silently writes another stage's skip. `sub_bosses` uses
 * `subN_` for skip/threshold but `sideN_` for notes; never derive one from the other.
 */

export type EncounterId = 0 | 1 | 2
/** The main boss cannot be skipped. */
export type SubIndex = 1 | 2

/** Use instead of `as 0 | 1 | 2` casts, which would let a bad value reach the PUT. */
export function asEncounterId(value: number): EncounterId {
  if (value === 0 || value === 1 || value === 2) return value
  throw new Error(`Invalid encounter id: ${value} (expected 0, 1 or 2)`)
}

/** Add one to the hub's 0-based `setNumber` first. */
export function difficultyCodeFromOneBasedSet(
  rarity: 'Legendary' | 'Mythic',
  setOneBased: number
): string {
  return `${rarity === 'Mythic' ? 'M' : 'L'}${setOneBased}`
}

export function seasonNotesKey(encounterId: EncounterId): string {
  return encounterId === 0 ? 'main_notes' : `side${encounterId}_notes`
}

export function heraldNotesField(encounterId: EncounterId): string {
  return encounterId === 0 ? 'notes' : `side${encounterId}_notes`
}

export function heraldBossId(
  bossType: string,
  encounterId: EncounterId
): string {
  return `${bossType}_E${encounterId}`
}

/** `bossType` is the raw `boss_name`, never the display label (which matches no row). */
export function targetsRowKey({
  bossType,
  rarity,
  set,
  encounterId
}: {
  bossType: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  encounterId: number
}): string {
  return `${bossType}__${rarity}__${set}__${encounterId}`
}
