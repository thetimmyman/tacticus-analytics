// Client-side fetch wrappers owning the Herald wire format; NOT server-only.

import type {
  BossState,
  HeraldBossSummary,
  PingMode,
  SaveStatus,
  SideBehaviour,
  SideState
} from '@/app/lib/boss-ops/encounter-ops-types'
// The import cycle is safe: neither module touches the other's bindings at evaluation time.
import {
  MirrorWriteError,
  saveTargetTokenSkipMirror
} from '@/app/lib/boss-ops/persist-encounter-ops'

type MessageSettings = {
  extraLinks?: unknown[]
  customMessageUrl?: string | null
}

type RoleEntry = {
  id: string
  label: string
}

type PersistableBossState = BossState & {
  mainMessage?: MessageSettings
  side1Message?: MessageSettings | null
  side2Message?: MessageSettings | null
  mainRoles?: RoleEntry[]
  side1Roles?: RoleEntry[]
  side2Roles?: RoleEntry[]
}

export const THRESHOLD_SNAPS = [20, 40, 60, 80, 100]

export interface ExistingBossConfig {
  enabled?: boolean | null
  webhook_config_ids?: string[] | null
  // Narrow writers must echo this: omitting it from a whole-row upsert wipes every ping role.
  discord_role_ids?: string[] | null
  discord_role_labels?: Record<string, string> | null
  extra_links?: unknown[] | null
  extra_videos?: unknown[] | null
  custom_message_url?: string | null
  notes?: string | null
  side1_notes?: string | null
  side2_notes?: string | null
  side1_behaviour?: SideBehaviour | null
  side2_behaviour?: SideBehaviour | null
  side1_threshold_hp_pct?: number | null
  side2_threshold_hp_pct?: number | null
  ping_mode?: PingMode | null
}

interface SeedTeam {
  meta_team: string
  boss_ids: string[]
  boss_count?: number
}

export interface SeedResponse {
  success?: boolean
  created?: number
  skipped_existing?: number
  teams?: SeedTeam[]
  unmapped_bosses?: unknown[]
  season?: string | number | null
  seasons_tried?: string[]
  message?: string
  error?: string
  details?: string
}

export function clampThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return THRESHOLD_SNAPS.reduce((closest, snap) =>
    Math.abs(snap - value) < Math.abs(closest - value) ? snap : closest
  )
}

/** Resolvers treat `''` as set, shadowing the fallback note. */
function coerceNote(note: string | null | undefined): string | null {
  if (typeof note !== 'string') return null
  return note.trim().length > 0 ? note : null
}

function noteIsUnchanged(
  stateNote: string | null | undefined,
  baselineNote: string | null | undefined
): boolean {
  if (baselineNote === undefined) return false
  return coerceNote(stateNote) === coerceNote(baselineNote)
}

function rolesAreUnchanged(
  stateRoles: Array<{ id: string; label: string }>,
  baselineRoles: Array<{ id: string; label: string }> | null | undefined
): boolean {
  if (baselineRoles === undefined || baselineRoles === null) return false
  if (stateRoles.length !== baselineRoles.length) return false
  return stateRoles.every((role, i) => {
    const base = baselineRoles[i]!
    return (
      role.id.trim() === base.id.trim() &&
      role.label.trim() === base.label.trim()
    )
  })
}

export function raritySetForBoss(boss: HeraldBossSummary): string {
  const rarityPrefix = boss.rarity === 'Mythic' ? 'M' : 'L'
  return `${rarityPrefix}${boss.set + 1}`
}

export async function loadExistingBossConfig(
  guildCode: string,
  bossId: string
): Promise<ExistingBossConfig | null> {
  const params = new URLSearchParams({
    guild_code: guildCode,
    boss_id: bossId,
    rarity_set: ''
  })
  const res = await fetch(`/api/herald/boss-config?${params.toString()}`, {
    cache: 'no-store'
  })
  if (!res.ok) {
    throw new Error('Failed to load existing Herald boss config')
  }
  const payload = (await res.json()) as { config?: ExistingBossConfig | null }
  return payload.config ?? null
}

// Per-boss-global fields live in `herald_boss_config`, per-season ones in `sub_bosses`.
// Legacy per-side herald columns are still written on current-season edits.
export async function persistBossSettings(
  boss: HeraldBossSummary,
  state: PersistableBossState,
  guildCode: string,
  seasonNumber: string,
  currentSeasonNumber: string,
  onSaveStatus: (s: SaveStatus) => void,
  onResetDirty: () => void,
  /** An untouched side is not written, so an unrelated save cannot revert a skip set elsewhere. */
  sideBaseline?: SideSettingsBaseline
) {
  onSaveStatus('saving')
  const isCurrentSeason = seasonNumber === currentSeasonNumber
  const normalizeRoleEntries = (
    entries: RoleEntry[] | undefined,
    fallback: string
  ): RoleEntry[] => {
    if (entries && entries.length > 0) {
      const seen = new Set<string>()
      const out: RoleEntry[] = []
      for (const entry of entries) {
        const id = entry.id.trim()
        if (!id || seen.has(id)) continue
        seen.add(id)
        out.push({ id, label: entry.label.trim() })
      }
      return out
    }
    const trimmed = fallback.trim()
    return trimmed.length > 0 ? [{ id: trimmed, label: '' }] : []
  }

  const writes: Array<{
    boss_id: string
    roles: RoleEntry[]
    rolesUnchanged: boolean
  }> = []
  if (boss.main) {
    const roles = normalizeRoleEntries(state.mainRoles, state.mainRole)
    writes.push({
      boss_id: boss.main.boss_id,
      roles,
      rolesUnchanged: rolesAreUnchanged(roles, sideBaseline?.mainRoles)
    })
  }
  if (boss.sides[0]) {
    const roles = normalizeRoleEntries(
      state.side1Roles,
      state.side1?.role ?? ''
    )
    writes.push({
      boss_id: boss.sides[0].boss_id,
      roles,
      rolesUnchanged: rolesAreUnchanged(roles, sideBaseline?.side1Roles)
    })
  }
  if (boss.sides[1]) {
    const roles = normalizeRoleEntries(
      state.side2Roles,
      state.side2?.role ?? ''
    )
    writes.push({
      boss_id: boss.sides[1].boss_id,
      roles,
      rolesUnchanged: rolesAreUnchanged(roles, sideBaseline?.side2Roles)
    })
  }

  const side1Untouched =
    sideBaseline !== undefined &&
    !!state.side1 &&
    sideIsUnchanged(
      state.side1,
      sideBaseline.side1Behaviour,
      sideBaseline.side1ThresholdHpPct
    )
  const side2Untouched =
    sideBaseline !== undefined &&
    !!state.side2 &&
    sideIsUnchanged(
      state.side2,
      sideBaseline.side2Behaviour,
      sideBaseline.side2ThresholdHpPct
    )

  const mainNoteUnchanged = noteIsUnchanged(
    state.mainNotes,
    sideBaseline?.mainNotes
  )
  const side1NoteUnchanged = noteIsUnchanged(
    state.side1?.notes,
    sideBaseline?.side1Notes
  )
  const side2NoteUnchanged = noteIsUnchanged(
    state.side2?.notes,
    sideBaseline?.side2Notes
  )
  const pingModeUnchanged =
    sideBaseline?.pingMode != null && state.pingMode === sideBaseline.pingMode

  const persistOneBoss = async (w: {
    boss_id: string
    roles: RoleEntry[]
    rolesUnchanged: boolean
  }) => {
    const existing = await loadExistingBossConfig(guildCode, w.boss_id)
    const message =
      boss.main?.boss_id === w.boss_id
        ? state.mainMessage
        : boss.sides[0]?.boss_id === w.boss_id
          ? state.side1Message
          : boss.sides[1]?.boss_id === w.boss_id
            ? state.side2Message
            : null
    const res = await fetch('/api/herald/boss-config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guild_code: guildCode,
        boss_id: w.boss_id,
        rarity_set: null,
        enabled: existing?.enabled ?? true,
        // The route only persists labels for structured entries.
        discord_role_ids: w.rolesUnchanged
          ? (existing?.discord_role_ids ?? []).map((id) => ({
              id,
              label: existing?.discord_role_labels?.[id] ?? ''
            }))
          : w.roles,
        webhook_config_ids: existing?.webhook_config_ids ?? [],
        extra_links: message?.extraLinks ?? existing?.extra_links ?? [],
        extra_videos: existing?.extra_videos ?? [],
        custom_message_url:
          message?.customMessageUrl ?? existing?.custom_message_url ?? null,
        // Write only on current season AND changed; otherwise preserve `existing`.
        notes:
          isCurrentSeason && !mainNoteUnchanged
            ? coerceNote(state.mainNotes)
            : (existing?.notes ?? null),
        side1_notes:
          isCurrentSeason && !side1NoteUnchanged
            ? coerceNote(state.side1?.notes)
            : (existing?.side1_notes ?? null),
        side2_notes:
          isCurrentSeason && !side2NoteUnchanged
            ? coerceNote(state.side2?.notes)
            : (existing?.side2_notes ?? null),
        // Baseline-gated: the assignment cascade reads these columns alone.
        side1_behaviour: isCurrentSeason
          ? state.pingMode === 'skip_all'
            ? 'skip'
            : side1Untouched
              ? (existing?.side1_behaviour ?? 'kill')
              : (state.side1?.behaviour ?? 'kill')
          : (existing?.side1_behaviour ?? 'kill'),
        side2_behaviour: isCurrentSeason
          ? state.pingMode === 'skip_all'
            ? 'skip'
            : side2Untouched
              ? (existing?.side2_behaviour ?? 'kill')
              : (state.side2?.behaviour ?? 'kill')
          : (existing?.side2_behaviour ?? 'kill'),
        side1_threshold_hp_pct:
          isCurrentSeason && !side1Untouched
            ? state.side1?.behaviour === 'threshold'
              ? clampThreshold(state.side1.threshold)
              : null
            : (existing?.side1_threshold_hp_pct ?? null),
        side2_threshold_hp_pct:
          isCurrentSeason && !side2Untouched
            ? state.side2?.behaviour === 'threshold'
              ? clampThreshold(state.side2.threshold)
              : null
            : (existing?.side2_threshold_hp_pct ?? null),
        ping_mode:
          isCurrentSeason && !pingModeUnchanged
            ? state.pingMode
            : (existing?.ping_mode ?? state.pingMode)
      })
    })
    if (!res.ok)
      throw new Error(`herald_boss_config write failed for ${w.boss_id}`)
  }

  // allSettled: a rejected mirror must not race the in-flight herald writes.
  const results = await Promise.allSettled([
    ...writes.map(persistOneBoss),
    persistSideSettings(boss, state, guildCode, seasonNumber, sideBaseline)
  ])
  const failures = results
    .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    .map((r) => r.reason)
  if (failures.length === 0) {
    onSaveStatus('saved')
    onResetDirty()
  } else if (failures.every((reason) => reason instanceof MirrorWriteError)) {
    // Plain 'saved' would clear dirty and the mirror would never be retried.
    onSaveStatus('saved-stale')
  } else {
    onSaveStatus('error')
  }
}

export interface SideSettingsBaseline {
  side1Behaviour?: SideBehaviour | null
  side2Behaviour?: SideBehaviour | null
  side1ThresholdHpPct?: number | null
  side2ThresholdHpPct?: number | null
  // `undefined` = no baseline (always write); `null` = hydrated as unset.
  mainNotes?: string | null
  side1Notes?: string | null
  side2Notes?: string | null
  pingMode?: PingMode | null
  mainRoles?: Array<{ id: string; label: string }> | null
  side1Roles?: Array<{ id: string; label: string }> | null
  side2Roles?: Array<{ id: string; label: string }> | null
  // So the skip mirror never overwrites an officer target with the `1` placeholder.
  side1TargetTokens?: number | null
  side2TargetTokens?: number | null
}

function sideIsUnchanged(
  side: SideState,
  behaviour: SideBehaviour | null | undefined,
  thresholdHpPct: number | null | undefined
): boolean {
  if (behaviour === undefined || behaviour === null) return false
  if (side.behaviour !== behaviour) return false
  if (side.behaviour !== 'threshold') return true
  return clampThreshold(side.threshold) === clampThreshold(thresholdHpPct ?? 0)
}

export async function persistSideSettings(
  boss: HeraldBossSummary,
  state: BossState,
  guildCode: string,
  seasonNumber: string,
  baseline?: SideSettingsBaseline
) {
  const raritySet = raritySetForBoss(boss)
  const writes: Array<{ subIndex: 1 | 2; side: SideState }> = []
  // Compare effective behaviour (skip_all forces 'skip'), or leaving skip_all loses the un-skip.
  const forcedSkip = state.pingMode === 'skip_all'
  if (boss.sides[0] && state.side1) {
    const effective: SideState = forcedSkip
      ? { ...state.side1, behaviour: 'skip' }
      : state.side1
    const unchanged =
      baseline !== undefined &&
      sideIsUnchanged(
        effective,
        baseline.side1Behaviour,
        baseline.side1ThresholdHpPct
      )
    if (!unchanged) {
      writes.push({ subIndex: 1, side: effective })
    }
  }
  if (boss.sides[1] && state.side2) {
    const effective: SideState = forcedSkip
      ? { ...state.side2, behaviour: 'skip' }
      : state.side2
    const unchanged =
      baseline !== undefined &&
      sideIsUnchanged(
        effective,
        baseline.side2Behaviour,
        baseline.side2ThresholdHpPct
      )
    if (!unchanged) {
      writes.push({ subIndex: 2, side: effective })
    }
  }

  for (const write of writes) {
    const skipResponse = await fetch('/api/season-config/skip-prime', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guild_code: guildCode,
        season_number: seasonNumber,
        level: raritySet,
        sub_index: write.subIndex,
        skip: write.side.behaviour === 'skip'
      })
    })
    if (!skipResponse.ok) {
      throw new Error('Failed to save side skip setting')
    }

    const thresholdResponse = await fetch('/api/season-config/kill-threshold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guild_code: guildCode,
        season_number: seasonNumber,
        level: raritySet,
        sub_index: write.subIndex,
        kill_threshold_pct:
          write.side.behaviour === 'threshold'
            ? clampThreshold(write.side.threshold)
            : 0
      })
    })
    if (!thresholdResponse.ok) {
      throw new Error('Failed to save side threshold setting')
    }
  }

  const notesModePatch: Record<string, unknown> = {}
  if (!noteIsUnchanged(state.mainNotes, baseline?.mainNotes)) {
    notesModePatch.main_notes = coerceNote(state.mainNotes)
  }
  if (
    boss.sides[0] &&
    state.side1 &&
    !noteIsUnchanged(state.side1.notes, baseline?.side1Notes)
  ) {
    notesModePatch.side1_notes = coerceNote(state.side1.notes)
  }
  if (
    boss.sides[1] &&
    state.side2 &&
    !noteIsUnchanged(state.side2.notes, baseline?.side2Notes)
  ) {
    notesModePatch.side2_notes = coerceNote(state.side2.notes)
  }
  if (baseline?.pingMode == null || state.pingMode !== baseline.pingMode) {
    notesModePatch.ping_mode = state.pingMode
  }
  // The route 400s an empty patch.
  if (Object.keys(notesModePatch).length > 0) {
    const notesModeResponse = await fetch('/api/season-config/notes-mode', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guild_code: guildCode,
        season_number: seasonNumber,
        level: raritySet,
        ...notesModePatch
      })
    })
    if (!notesModeResponse.ok) {
      throw new Error('Failed to save per-season notes/ping_mode')
    }
  }

  // Only after the authoritative writes, and only for sides that crossed the skip boundary.
  const mirrorWrites = writes.filter((write) => {
    const baselineBehaviour =
      write.subIndex === 1 ? baseline?.side1Behaviour : baseline?.side2Behaviour
    if (baselineBehaviour === undefined || baselineBehaviour === null) {
      return false
    }
    return (write.side.behaviour === 'skip') !== (baselineBehaviour === 'skip')
  })
  if (mirrorWrites.length > 0) {
    const results = await Promise.allSettled(
      mirrorWrites.map((write) =>
        saveTargetTokenSkipMirror(
          {
            guildCode,
            bossType: boss.boss_type,
            rarity: boss.rarity,
            set: boss.set + 1,
            encounterId: write.subIndex,
            seasonNumber
          },
          write.side.behaviour === 'skip',
          (write.subIndex === 1
            ? baseline?.side1TargetTokens
            : baseline?.side2TargetTokens) ?? 0
        )
      )
    )
    if (results.some((r) => r.status === 'rejected')) {
      throw new MirrorWriteError(['tokens'])
    }
  }
}
