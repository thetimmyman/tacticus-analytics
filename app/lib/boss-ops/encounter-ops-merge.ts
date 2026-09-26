/**
 * Season notes beat the Herald snapshot (null stays cleared); behaviour/threshold
 * are season-only; roles are Herald-only; encounter 0 is always 'kill'.
 */
import type { EncounterId } from '@/app/lib/boss-ops/identity'
import type { SideBehaviour } from '@/app/lib/boss-ops/encounter-ops-types'
import { resolveNoteOverride } from '@/app/lib/boss-ops/season-note-field'

/** Declared locally to avoid route-private imports. */
export interface EncounterHeraldConfigView {
  discordRoleIds: string[]
  discordRoleLabels: Record<string, string>
  notes: string | null
  side1Notes: string | null
  side2Notes: string | null
}

export interface EncounterSeasonOpsView {
  // null = cleared (no fallback); undefined = never set (fall back to heraldConfig).
  mainNotes: string | null | undefined
  side1Notes: string | null | undefined
  side2Notes: string | null | undefined
  side1Behaviour: SideBehaviour
  side2Behaviour: SideBehaviour
  side1ThresholdHpPct: number | null
  side2ThresholdHpPct: number | null
}

export interface ResolvedEncounterOps {
  roleIds: string[]
  roleLabels: Record<string, string>
  notes: string | null
  behaviour: SideBehaviour
  thresholdHpPct: number | null
}

export function resolveEncounterOps({
  encounterId,
  seasonOps,
  heraldConfig
}: {
  encounterId: number
  seasonOps: EncounterSeasonOpsView | null | undefined
  heraldConfig: EncounterHeraldConfigView | null | undefined
}): ResolvedEncounterOps {
  const ops = seasonOps ?? null
  const config = heraldConfig ?? null
  const sideIndex =
    encounterId === 1 ? 'side1' : encounterId === 2 ? 'side2' : null

  const behaviour: SideBehaviour =
    sideIndex === 'side1'
      ? (ops?.side1Behaviour ?? 'kill')
      : sideIndex === 'side2'
        ? (ops?.side2Behaviour ?? 'kill')
        : 'kill'

  const thresholdHpPct =
    sideIndex === 'side1'
      ? (ops?.side1ThresholdHpPct ?? null)
      : sideIndex === 'side2'
        ? (ops?.side2ThresholdHpPct ?? null)
        : null

  const notes =
    encounterId === 0
      ? resolveNoteOverride(ops?.mainNotes, config?.notes ?? null)
      : sideIndex === 'side1'
        ? resolveNoteOverride(ops?.side1Notes, config?.side1Notes ?? null)
        : sideIndex === 'side2'
          ? resolveNoteOverride(ops?.side2Notes, config?.side2Notes ?? null)
          : null

  return {
    roleIds: config?.discordRoleIds ?? [],
    roleLabels: config?.discordRoleLabels ?? {},
    notes,
    behaviour,
    thresholdHpPct
  }
}

export interface EncounterOpsEntry extends ResolvedEncounterOps {
  key: string
  bossType: string
  rarity: 'Legendary' | 'Mythic'
  /** 1-based, matching `boss_target_tokens.set`. */
  set: number
  encounterId: EncounterId
  difficultyCode: string
  heraldBossId: string
}

/** When `loadFailed`, consumers must disable controls: saving the `{}` default would un-skip primes. */
export interface EncounterOpsSlice {
  seasonNumber: number
  byKey: Record<string, EncounterOpsEntry>
  loadFailed: boolean
}
