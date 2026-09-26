import 'server-only'

import { db } from '@/app/lib/db'
import { DISCORD_SNOWFLAKE_REGEX } from '@/app/lib/herald/contracts'
import {
  parseSeasonOps,
  seasonOpsKey,
  type SeasonOps
} from '@/app/lib/boss-ops/season-ops'
// Not the barrel: it pulls in the playbooks JSON this file keeps out of its consumers.
import type { SeasonalHubReplayLinkMode } from '@/app/(dashboard)/boss-playbooks/seasonal-hub-utils/types'

/** `loadFailed` must disable write controls: a failed read could silently un-skip a prime. */

export { seasonOpsKey as seasonalOpsKey }

export type EncounterHeraldConfig = {
  discordRoleIds: string[]
  discordRoleLabels: Record<string, string>
  notes: string | null
  side1Notes: string | null
  side2Notes: string | null
  pingMode: 'combined' | 'per_side' | 'skip_all' | null
  replayLinkMode: SeasonalHubReplayLinkMode
  replayAutoCount: number
}
export type EncounterSeasonOps = SeasonOps

export interface HeraldConfigLoad {
  byBossId: Record<string, EncounterHeraldConfig>
  loadFailed: boolean
}

export interface SeasonOpsLoad {
  bySlot: Record<string, EncounterSeasonOps>
  loadFailed: boolean
}

const normalizeReplayLinkMode = (value: unknown): SeasonalHubReplayLinkMode => {
  return value === 'off' ||
    value === 'pinned' ||
    value === 'featured' ||
    value === 'all'
    ? value
    : 'inherit'
}

const normalizeRoleLabels = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const out: Record<string, string> = {}
  for (const [id, label] of Object.entries(value)) {
    if (!DISCORD_SNOWFLAKE_REGEX.test(id)) continue
    if (typeof label !== 'string') continue
    const trimmed = label.trim()
    if (trimmed.length > 0) out[id] = trimmed
  }
  return out
}

/** Uses the RLS client; when `enabled` is false nothing loads and `loadFailed` stays false. */
export async function loadHeraldConfigsByBossId(
  guildCode: string | null | undefined,
  enabled: boolean
): Promise<HeraldConfigLoad> {
  if (!guildCode || !enabled) return { byBossId: {}, loadFailed: false }

  try {
    const supabase = await db()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- herald_boss_config is ahead of some generated app DB types
    const { data, error } = await (supabase.from('herald_boss_config') as any)
      .select(
        'boss_id, discord_role_ids, discord_role_labels, notes, side1_notes, side2_notes, ping_mode, replay_link_mode, replay_auto_count'
      )
      .eq('guild_code', guildCode)
      // The officer UI writes only the NULL catch-all row; widen this only with persistence.ts's write.
      .is('rarity_set', null)

    if (error) {
      console.warn('[boss-ops] Failed to load Herald configs', {
        error: error.message
      })
      return { byBossId: {}, loadFailed: true }
    }

    const out: Record<string, EncounterHeraldConfig> = {}
    ;((data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const bossId = typeof row.boss_id === 'string' ? row.boss_id : ''
      if (!bossId) return
      const pingMode =
        row.ping_mode === 'combined' ||
        row.ping_mode === 'per_side' ||
        row.ping_mode === 'skip_all'
          ? row.ping_mode
          : null
      out[bossId] = {
        discordRoleIds: Array.isArray(row.discord_role_ids)
          ? row.discord_role_ids.filter(
              (role): role is string => typeof role === 'string'
            )
          : [],
        discordRoleLabels: normalizeRoleLabels(row.discord_role_labels),
        notes: typeof row.notes === 'string' ? row.notes : null,
        side1Notes:
          typeof row.side1_notes === 'string' ? row.side1_notes : null,
        side2Notes:
          typeof row.side2_notes === 'string' ? row.side2_notes : null,
        pingMode,
        replayLinkMode: normalizeReplayLinkMode(row.replay_link_mode),
        replayAutoCount:
          typeof row.replay_auto_count === 'number' &&
          Number.isFinite(row.replay_auto_count)
            ? Math.max(0, Math.min(20, Math.floor(row.replay_auto_count)))
            : 0
      }
    })
    return { byBossId: out, loadFailed: false }
  } catch (error) {
    console.warn('[boss-ops] Failed to load Herald configs', {
      error: error instanceof Error ? error.message : String(error)
    })
    return { byBossId: {}, loadFailed: true }
  }
}

/** Keyed by stage: `L4` ops apply to whichever boss occupies L4 that season. */
export async function loadSeasonOpsBySlot(
  guildCode: string | null | undefined,
  seasonNumbers: number[],
  enabled: boolean
): Promise<SeasonOpsLoad> {
  if (!guildCode || !enabled || seasonNumbers.length === 0) {
    return { bySlot: {}, loadFailed: false }
  }

  try {
    const supabase = await db()
    const { data, error } =
      await // eslint-disable-next-line @typescript-eslint/no-explicit-any -- upcoming_season_bosses is ahead of generated types in this app package
      (supabase.from('upcoming_season_bosses') as any)
        .select('season_number, level, sub_bosses')
        .eq('guild_code', guildCode)
        .in(
          'season_number',
          Array.from(new Set(seasonNumbers.map((season) => String(season))))
        )

    if (error) {
      console.warn('[boss-ops] Failed to load season ops', {
        error: error.message
      })
      return { bySlot: {}, loadFailed: true }
    }

    const out: Record<string, EncounterSeasonOps> = {}
    ;((data ?? []) as Array<Record<string, unknown>>).forEach((row) => {
      const seasonNumber = Number(row.season_number)
      const difficultyCode = typeof row.level === 'string' ? row.level : ''
      if (
        !Number.isFinite(seasonNumber) ||
        !/^[LM][1-5]$/.test(difficultyCode)
      ) {
        return
      }

      out[seasonOpsKey({ seasonNumber, difficultyCode })] = parseSeasonOps(
        row.sub_bosses
      )
    })
    return { bySlot: out, loadFailed: false }
  } catch (error) {
    console.warn('[boss-ops] Failed to load season ops', {
      error: error instanceof Error ? error.message : String(error)
    })
    return { bySlot: {}, loadFailed: true }
  }
}
