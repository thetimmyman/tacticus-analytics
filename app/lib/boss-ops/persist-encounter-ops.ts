/**
 * Per-encounter writers (`persistBossSettings` would revert the sibling prime). Write
 * order is load-bearing: `sub_bosses` (truth) first, then the mirrors, so a crash
 * never leaves truth behind the mirrors.
 */

import {
  clampThreshold,
  loadExistingBossConfig
} from '@/app/lib/boss-ops/persistence'
import {
  difficultyCodeFromOneBasedSet,
  heraldBossId,
  heraldNotesField,
  seasonNotesKey,
  type EncounterId,
  type SubIndex
} from '@/app/lib/boss-ops/identity'
import type { SideBehaviour } from '@/app/lib/boss-ops/encounter-ops-types'
import type { OpsRoleEntry } from '@/app/components/boss-ops/types'

const HERALD_BOSS_CONFIG = '/api/herald/boss-config'

export interface EncounterRef {
  guildCode: string
  bossType: string
  rarity: 'Legendary' | 'Mythic'
  /** 1-based; the hub's 0-based setNumber needs +1. */
  set: number
  encounterId: EncounterId
  seasonNumber: string
  /** Snapshot columns feed a season-blind cascade: write them only for the live season. */
  isCurrentSeason: boolean
}

/** Whole-row upsert: a defaulted `webhook_config_ids: []` silently stops Herald posting. */
async function heraldEcho(
  guildCode: string,
  bossId: string,
  overrides: Record<string, unknown>
): Promise<void> {
  const existing = await loadExistingBossConfig(guildCode, bossId)
  const res = await fetch(HERALD_BOSS_CONFIG, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guild_code: guildCode,
      boss_id: bossId,
      rarity_set: null,
      enabled: existing?.enabled ?? true,
      discord_role_ids: (existing?.discord_role_ids ?? []).map((id) => ({
        id,
        label: existing?.discord_role_labels?.[id] ?? ''
      })),
      webhook_config_ids: existing?.webhook_config_ids ?? [],
      extra_links: existing?.extra_links ?? [],
      extra_videos: existing?.extra_videos ?? [],
      custom_message_url: existing?.custom_message_url ?? null,
      notes: existing?.notes ?? null,
      side1_notes: existing?.side1_notes ?? null,
      side2_notes: existing?.side2_notes ?? null,
      side1_behaviour: existing?.side1_behaviour ?? 'kill',
      side2_behaviour: existing?.side2_behaviour ?? 'kill',
      side1_threshold_hp_pct: existing?.side1_threshold_hp_pct ?? null,
      side2_threshold_hp_pct: existing?.side2_threshold_hp_pct ?? null,
      ping_mode: existing?.ping_mode ?? 'per_side',
      ...overrides
    })
  })
  if (!res.ok) throw new Error(`herald_boss_config write failed for ${bossId}`)
}

async function postSeasonConfig(
  path: string,
  body: Record<string, unknown>
): Promise<void> {
  const res = await fetch(`/api/season-config/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })
  if (!res.ok) throw new Error(`season-config/${path} write failed`)
}

export async function saveEncounterRoles(
  ref: EncounterRef,
  roles: OpsRoleEntry[]
): Promise<void> {
  await heraldEcho(ref.guildCode, heraldBossId(ref.bossType, ref.encounterId), {
    discord_role_ids: roles.map((r) => ({ id: r.id, label: r.label }))
  })
}

/**
 * Writes both stores: the resolver reads `sub_bosses.*_notes` first. Empty input
 * writes NULL, since `''` counts as unset and would resurrect the stale herald note.
 */
export async function saveEncounterNotes(
  ref: EncounterRef,
  notes: string
): Promise<void> {
  const value = notes.trim().length > 0 ? notes : null

  await postSeasonConfig('notes-mode', {
    guild_code: ref.guildCode,
    season_number: ref.seasonNumber,
    level: difficultyCodeFromOneBasedSet(ref.rarity, ref.set),
    [seasonNotesKey(ref.encounterId)]: value
  })

  // Legacy cross-season fallback; current season only.
  if (ref.isCurrentSeason) {
    await heraldEcho(
      ref.guildCode,
      heraldBossId(ref.bossType, ref.encounterId),
      { [heraldNotesField(ref.encounterId)]: value }
    )
  }
}

export interface BehaviourWrite {
  behaviour: SideBehaviour
  thresholdHpPct?: number | null
  /** The target-token mirror fires only when this flips. */
  wasSkipped: boolean
  /** `target_tokens > 0` is a DB CHECK; skipping an unset row writes a `1` placeholder. */
  currentTargetTokens: number
}

/** Skip and threshold go in one request so concurrent officers cannot interleave them. */
export async function saveEncounterBehaviour(
  ref: EncounterRef,
  write: BehaviourWrite
): Promise<void> {
  const subIndex = ref.encounterId as SubIndex
  if (subIndex !== 1 && subIndex !== 2) {
    throw new Error(
      'Only primes have a behaviour — the main boss is always expected'
    )
  }

  const level = difficultyCodeFromOneBasedSet(ref.rarity, ref.set)
  const skip = write.behaviour === 'skip'
  const pct =
    write.behaviour === 'threshold'
      ? clampThreshold(write.thresholdHpPct ?? 0)
      : 0

  await postSeasonConfig('skip-prime', {
    guild_code: ref.guildCode,
    season_number: ref.seasonNumber,
    level,
    sub_index: subIndex,
    skip,
    kill_threshold_pct: pct
  })

  // Mirror failures are not fatal. A non-flip write would erase auto-derive provenance.
  const skipChanged = skip !== write.wasSkipped
  const results = await Promise.allSettled([
    skipChanged
      ? saveTargetTokenSkipMirror(ref, skip, write.currentTargetTokens)
      : Promise.resolve(),
    ref.isCurrentSeason
      ? heraldEcho(ref.guildCode, heraldBossId(ref.bossType, ref.encounterId), {
          [`side${subIndex}_behaviour`]: write.behaviour,
          [`side${subIndex}_threshold_hp_pct`]:
            write.behaviour === 'threshold' ? pct : null
        })
      : Promise.resolve()
  ])

  const failed = results
    .map((r, i) =>
      r.status === 'rejected' ? (i === 0 ? 'tokens' : 'herald') : null
    )
    .filter((x): x is 'tokens' | 'herald' => x !== null)
  if (failed.length > 0) throw new MirrorWriteError(failed)
}

export class MirrorWriteError extends Error {
  constructor(public readonly failedMirrors: Array<'tokens' | 'herald'>) {
    super(
      `Saved, but ${failedMirrors.join(' and ')} did not update — other views may show the old value`
    )
    this.name = 'MirrorWriteError'
  }
}

export type TargetTokenMirrorRef = Pick<
  EncounterRef,
  'guildCode' | 'bossType' | 'rarity' | 'set' | 'encounterId' | 'seasonNumber'
>

/** Call only on a skip flip so unset rows keep auto-deriving. */
export async function saveTargetTokenSkipMirror(
  ref: TargetTokenMirrorRef,
  skip: boolean,
  currentTargetTokens: number
): Promise<void> {
  if (!skip && !(currentTargetTokens > 0)) return
  const { saveTargetToken } =
    await import('@/app/lib/boss-ops/persist-target-token')
  await saveTargetToken({
    bossType: ref.bossType,
    rarity: ref.rarity,
    set: ref.set,
    encounterId: ref.encounterId,
    targetTokens: currentTargetTokens > 0 ? currentTargetTokens : 1,
    skip,
    seasonNumber: ref.seasonNumber,
    guildCode: ref.guildCode
  })
}
