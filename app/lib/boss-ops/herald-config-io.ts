/** Leaf module: threshold snapping and the herald_boss_config read, shared by
 * persistence and persist-encounter-ops without an import cycle. */

import type {
  PingMode,
  SideBehaviour
} from '@/app/lib/boss-ops/encounter-ops-types'

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

export function clampThreshold(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0
  return THRESHOLD_SNAPS.reduce((closest, snap) =>
    Math.abs(snap - value) < Math.abs(closest - value) ? snap : closest
  )
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
