/** threshold = stop at an HP-remaining %. */
export type SideBehaviour = 'skip' | 'kill' | 'threshold'

export type PingMode = 'combined' | 'per_side' | 'skip_all'

/** `saved-stale`: a mirror write failed; do not advance the baseline, so a re-save retries it. */
export type SaveStatus = 'idle' | 'saving' | 'saved' | 'saved-stale' | 'error'

export interface HeraldBossSideRef {
  boss_id: string
  boss_name: string
  encounter_id: number
}

export interface HeraldBossSummary {
  group_key: string
  boss_type: string
  boss_name: string
  rarity: 'Legendary' | 'Mythic'
  set: number
  main: HeraldBossSideRef | null
  sides: HeraldBossSideRef[]
}

export interface SideState {
  role: string
  behaviour: SideBehaviour
  threshold: number // HP-remaining %, snap of [20, 40, 60, 80]
  notes: string
}

export interface BossState {
  group_key: string
  expanded: boolean
  mainRole: string
  mainNotes: string
  pingMode: PingMode
  side1: SideState | null
  side2: SideState | null
  saveStatus: SaveStatus
  dirty: boolean
  // Bumped on user edits only; edits during a save trigger another save.
  editVersion: number
}
