import type { RawRaidEntry } from '@/app/lib/sync/transformers'
import {
  processTimestamp,
  lookupPlayerMapping
} from '@/app/lib/sync/transformers'
import {
  logger,
  getErrorMessage,
  type StrictSupabaseClient
} from '@/app/lib/sync/db-operations/shared'

type BombUpdate = {
  player_id: string
  guild: string
  display_name: string
  last_used: string
  updated_at: string
  cluster_code: string | null
  cluster_id: string | null
}

export async function updateBombTracking(
  supabase: StrictSupabaseClient,
  entries: RawRaidEntry[],
  guildCode: string,
  playerMappings: Map<string, string>,
  clusterCode?: string | null,
  clusterId?: string | null
): Promise<void> {
  const bombEntries = entries.filter((e) => e.damageType === 'Bomb' && e.userId)
  if (bombEntries.length === 0) return

  const byPlayer = new Map<string, RawRaidEntry>()
  for (const entry of bombEntries) {
    const existing = byPlayer.get(entry.userId as string)
    const existingCompleted = existing
      ? processTimestamp(existing.completedOn)
      : null
    const entryCompleted = entry.completedOn
      ? processTimestamp(entry.completedOn)
      : null
    if (
      !existing ||
      (entryCompleted &&
        (!existingCompleted || entryCompleted > existingCompleted))
    ) {
      byPlayer.set(entry.userId as string, entry)
    }
  }

  const upserts: BombUpdate[] = Array.from(byPlayer.values()).map((entry) => ({
    player_id: entry.userId as string,
    guild: guildCode,
    display_name: lookupPlayerMapping(
      playerMappings,
      entry.userId as string,
      'Unknown'
    ),
    last_used: processTimestamp(entry.completedOn),
    updated_at: new Date().toISOString(),
    cluster_code: clusterCode || null,
    cluster_id: clusterId || null
  }))

  try {
    const { error } = await supabase
      .from('bomb_tracking')
      .upsert(upserts, { onConflict: 'player_id,guild' })

    if (!error) {
      logger.info(
        { guildCode },
        `Updated bomb tracking for ${upserts.length} players`
      )
    } else {
      logger.warn(
        { guildCode },
        `Failed to update bomb tracking: ${error.message}`
      )
    }
  } catch (error: unknown) {
    logger.error(
      { guildCode },
      `Exception updating bomb tracking: ${getErrorMessage(error)}`
    )
  }
}
