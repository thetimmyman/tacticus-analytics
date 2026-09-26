import { db } from '@/app/lib/db'
import {
  deriveLifecycleAndWarded,
  type BossLifecycleState,
  type BossStatusEntry,
  type BossStatusRow
} from './boss-status-shared'

export {
  deriveLifecycleAndWarded,
  type BossLifecycleState,
  type BossStatusEntry,
  type BossStatusRow
}

export async function getCurrentBossStatus(
  guild: string,
  season: string
): Promise<BossStatusRow[]> {
  if (!guild || !season) {
    throw new Error('Guild and season are required')
  }

  const supabase = await db()
  const { data, error } = (await supabase.rpc('get_current_boss_status', {
    p_guild_code: guild,
    p_season: season
  })) as { data: BossStatusRow[] | null; error: Error | null }

  if (error) {
    throw error
  }

  return Array.isArray(data) ? (data as BossStatusRow[]) : []
}

export async function getCurrentBossStatusWithLifecycle(
  guild: string,
  season: string
): Promise<BossStatusEntry[]> {
  const rows = await getCurrentBossStatus(guild, season)
  return deriveLifecycleAndWarded(rows)
}
