import {
  isOfficerSkip,
  isTargetNoDataSentinel
} from '@/app/lib/boss-assignments/target-token-season'
import { difficultyCodeFromOneBasedSet } from '@/app/lib/boss-ops/identity'
import { formatEncounterLabel } from '@/app/lib/format/encounter-label'

export interface TargetRow {
  boss_name: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  encounter_id: number
  target_tokens: number
  source: 'historical_seed' | 'officer_manual'
  seeded_from_seasons: string | null
  notes: string | null
  updated_by: string | null
  updated_at: string
  skip: boolean
}

export interface SlotEntry {
  boss_type: string
  boss_name: string
  rarity: string
  set: number
  encounter_id: number
}

export interface MergedRow {
  /** Raw key matching DB `boss_name` and EOT_GR_data.Name; used for every lookup and mutation. */
  boss_type: string
  /** Display label only ("Hive Tyrant (Kronos)"), never a key. */
  display_name: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  encounter_id: number
  target: TargetRow | null
}

export type TargetSortKey =
  'boss' | 'tier' | 'encounter' | 'target' | 'source' | 'updated'

export interface TargetRowFilters {
  name: string
  rarity: 'all' | 'Legendary' | 'Mythic'
  source: 'all' | 'unset' | 'officer_manual' | 'historical_seed'
  showPrimes: boolean
  sortKey: TargetSortKey
  sortAsc: boolean
}

export interface SeedState {
  isNoneAvailable: boolean
  isTierFallback: boolean
  tierFallbackLabel: string | null
  isSkipped: boolean
}

// `MergedRow.set` is 1-based (the DB column), so it goes to the canonical helper as-is.
export function levelLabel(rarity: 'Legendary' | 'Mythic', set: number) {
  return difficultyCodeFromOneBasedSet(rarity, set)
}

// Canonical Main/Prime N labels; the DB CHECK limits encounter_id to {0,1,2}.
export function encounterLabel(eid: number) {
  return formatEncounterLabel(eid, 'plain')
}

export function targetRowKey(
  row: Pick<MergedRow, 'boss_type' | 'rarity' | 'set' | 'encounter_id'>
) {
  return `${row.boss_type}__${row.rarity}__${row.set}__${row.encounter_id}`
}

/** None-available wins over officer-skip: a skip=true seed sentinel renders "None available". */
export function deriveSeedState(target: TargetRow | null): SeedState {
  if (!target) {
    return {
      isNoneAvailable: false,
      isTierFallback: false,
      tierFallbackLabel: null,
      isSkipped: false
    }
  }
  const seedText = target.seeded_from_seasons ?? ''
  const isNoneAvailable = isTargetNoDataSentinel(
    target.source,
    target.seeded_from_seasons
  )
  const isTierFallback =
    target.source === 'historical_seed' &&
    (seedText.toLowerCase().includes('fallback from') ||
      seedText.toLowerCase().includes('cohort '))
  const tierFallbackLabel = isTierFallback
    ? (seedText.match(/fallback from ([ML]\d+)/i)?.[1] ??
      seedText.match(/cohort ([ML]\d+) mean/i)?.[1] ??
      'tier cohort')
    : null
  return {
    isNoneAvailable,
    isTierFallback,
    tierFallbackLabel,
    isSkipped: isOfficerSkip(target)
  }
}

export function mergeTargetRows(
  slots: SlotEntry[],
  targets: TargetRow[]
): MergedRow[] {
  const targetByKey = new Map(
    targets.map((target) => [
      `${target.boss_name}__${target.rarity}__${target.set}__${target.encounter_id}`,
      target
    ])
  )

  return slots
    .filter((slot) => slot.rarity === 'Legendary' || slot.rarity === 'Mythic')
    .map((slot) => {
      const rarity = slot.rarity as MergedRow['rarity']
      const row: MergedRow = {
        boss_type: slot.boss_type,
        display_name: slot.boss_name,
        rarity,
        set: slot.set,
        encounter_id: slot.encounter_id,
        target: null
      }
      row.target = targetByKey.get(targetRowKey(row)) ?? null
      return row
    })
}

export function filterAndSortTargetRows(
  rows: MergedRow[],
  filters: TargetRowFilters
) {
  const name = filters.name.trim().toLowerCase()
  const filtered = rows.filter((row) => {
    if (!filters.showPrimes && row.encounter_id !== 0) return false
    if (
      name &&
      !row.display_name.toLowerCase().includes(name) &&
      !row.boss_type.toLowerCase().includes(name)
    )
      return false
    if (filters.rarity !== 'all' && row.rarity !== filters.rarity) return false
    if (filters.source === 'unset' && row.target) return false
    if (
      filters.source !== 'all' &&
      filters.source !== 'unset' &&
      row.target?.source !== filters.source
    )
      return false
    return true
  })

  return filtered.sort((a, b) => {
    let comparison = 0
    switch (filters.sortKey) {
      case 'boss':
        comparison = a.display_name.localeCompare(b.display_name)
        break
      case 'tier': {
        const aRarity = a.rarity === 'Legendary' ? 0 : 1
        const bRarity = b.rarity === 'Legendary' ? 0 : 1
        comparison =
          aRarity - bRarity || a.set - b.set || a.encounter_id - b.encounter_id
        break
      }
      case 'encounter':
        comparison = a.encounter_id - b.encounter_id
        break
      case 'target':
        comparison =
          (a.target?.target_tokens ?? -1) - (b.target?.target_tokens ?? -1)
        break
      case 'source':
        comparison = (a.target?.source ?? 'zzz_unset').localeCompare(
          b.target?.source ?? 'zzz_unset'
        )
        break
      case 'updated':
        comparison = (a.target?.updated_at ?? '').localeCompare(
          b.target?.updated_at ?? ''
        )
        break
    }
    return filters.sortAsc ? comparison : -comparison
  })
}
