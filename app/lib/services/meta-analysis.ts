import { db } from '@/app/lib/db'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
import {
  buildCompositionFromMetaAtlasRow,
  compareMetaAtlasRowsByStrength,
  fetchMetaAtlasSeasonRows,
  filterMetaAtlasRowsForCell,
  type MetaAtlasComposition
} from '@/app/lib/meta/meta-atlas-compositions'

const logger = createComponentLogger('lib.services.meta-analysis')

type SupabaseClient = TypedSupabaseClient

const DEFAULT_CELL_LIMIT = 50

/** From the global (unscoped) meta atlas; callers must authenticate/authorize. */
export async function analyzeTeamCompositions(
  rarity: string,
  set: number,
  season: string,
  minBattles?: number | null,
  encounterId?: number | null,
  limit?: number | null,
  supabaseClient?: SupabaseClient
): Promise<MetaAtlasComposition[]> {
  const supabase = supabaseClient ?? (await db())

  let rows
  try {
    // The DB clamps the per-cell attack floor to >= 10.
    rows = await fetchMetaAtlasSeasonRows(supabase, season, minBattles ?? 10)
  } catch (error) {
    logger.error(
      { err: error },
      '[meta-analysis] RPC get_meta_atlas_authenticated failed'
    )
    throw error
  }

  const cellRows = filterMetaAtlasRowsForCell(rows, {
    rarity,
    set,
    encounterIndex: encounterId ?? null
  })

  return cellRows
    .sort(compareMetaAtlasRowsByStrength)
    .slice(0, limit ?? DEFAULT_CELL_LIMIT)
    .map((row) =>
      buildCompositionFromMetaAtlasRow(
        row,
        { rarity, set, season },
        {
          minDamageMode: 'min-or-avg',
          standardDeviationMode: 'row-or-zero',
          coefficientFallback: null,
          bossNameFallback: 'Unknown'
        }
      )
    )
}

export async function getRecommendedTeams(
  season: string,
  guildFilter?: string | null,
  clusterCode?: string | null,
  supabaseClient?: SupabaseClient
) {
  const supabase = supabaseClient ?? (await db())
  const { data, error } = await supabase.rpc(
    'get_recommended_teams_for_season',
    {
      p_season: season,
      p_guild_filter: guildFilter ?? undefined,
      p_cluster_code: clusterCode ?? undefined
    }
  )

  if (error) {
    logger.error(
      { err: error },
      '[meta-analysis] RPC get_recommended_teams_for_season failed'
    )
    throw error
  }

  return data ?? []
}

export async function getAvailableGuilds(supabaseClient?: SupabaseClient) {
  const supabase = supabaseClient ?? (await db())
  // The user-scoped client has no SELECT on public_guild_snapshots; the explore
  // view exposes these columns and omits `hide_all` guilds, as that opt-out intends.
  const { data, error } = await supabase
    .from('public_guild_snapshots_explore')
    .select('guild_code, guild_name, guild_tag')
    .not('guild_code', 'is', null)
    .order('guild_name', { ascending: true })

  if (error) {
    logger.error(
      { err: error },
      '[meta-analysis] Failed to load available guilds'
    )
    throw error
  }

  return data ?? []
}
