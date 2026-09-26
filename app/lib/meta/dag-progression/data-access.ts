import { createComponentLogger } from '@/app/lib/logging'
import { normalizeTeamComposition } from './team-analysis'
import type {
  DagProgressionInput,
  DagSupabaseClient,
  MetaAtlasTeamRow
} from './types'

export const logger = createComponentLogger('lib.meta.dag-progression')

export async function resolveBossName(
  supabase: DagSupabaseClient,
  bossType: string | null,
  encounterIndex: number
): Promise<string | null> {
  if (!bossType) return null
  const { data, error } = await supabase
    .from('boss_mapping')
    .select('boss_name')
    .eq('boss_type', bossType)
    .eq('encounter_index', encounterIndex)
    .maybeSingle()

  if (error) {
    logger.warn({ error }, 'Boss name lookup failed')
    return bossType
  }

  return data?.boss_name ?? bossType
}

export async function fetchCurrentTeam(
  supabase: DagSupabaseClient,
  input: Required<DagProgressionInput>
): Promise<MetaAtlasTeamRow | null> {
  let query = supabase
    .from('meta_atlas_data')
    .select(
      'team_hash, team_composition, meta_team, damage_p90, attack_count, boss_type, boss_unit_id, encounter_index, rarity_set, season'
    )
    .gte('attack_count', input.minAttacks)

  if (input.bossUnitId) {
    query = query.eq('boss_unit_id', input.bossUnitId)
  } else if (input.bossType) {
    query = query.eq('boss_type', input.bossType)
  }

  if (input.encounterIndex != null) {
    query = query.eq('encounter_index', input.encounterIndex)
  }
  if (input.raritySet) {
    query = query.eq('rarity_set', input.raritySet)
  }
  if (input.season) {
    query = query.eq('season', input.season)
  }

  if (input.currentTeamHash) {
    query = query.eq('team_hash', input.currentTeamHash)
  } else if (input.currentTeam) {
    query = query.eq(
      'team_composition',
      normalizeTeamComposition(input.currentTeam)
    )
  }

  const { data, error } = await query
    .order('damage_p90', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error) {
    logger.error({ error }, 'Team progression lookup failed')
    return null
  }

  if (data) {
    return data as MetaAtlasTeamRow
  }

  if (!input.currentTeam || input.minAttacks <= 0) {
    return null
  }

  const fallbackQuery = supabase
    .from('meta_atlas_data')
    .select(
      'team_hash, team_composition, meta_team, damage_p90, attack_count, boss_type, boss_unit_id, encounter_index, rarity_set, season'
    )
    .eq('team_composition', normalizeTeamComposition(input.currentTeam))

  if (input.bossUnitId) {
    fallbackQuery.eq('boss_unit_id', input.bossUnitId)
  } else if (input.bossType) {
    fallbackQuery.eq('boss_type', input.bossType)
  }

  if (input.encounterIndex != null) {
    fallbackQuery.eq('encounter_index', input.encounterIndex)
  }
  if (input.raritySet) {
    fallbackQuery.eq('rarity_set', input.raritySet)
  }
  if (input.season) {
    fallbackQuery.eq('season', input.season)
  }

  const { data: fallbackData, error: fallbackError } = await fallbackQuery
    .order('damage_p90', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (fallbackError) {
    logger.error(
      { error: fallbackError },
      'Team progression fallback lookup failed'
    )
    return null
  }

  return fallbackData as MetaAtlasTeamRow | null
}

export function toRequiredInput(
  input: DagProgressionInput
): Required<DagProgressionInput> {
  return {
    bossType: input.bossType ?? null,
    bossUnitId: input.bossUnitId ?? null,
    encounterIndex: input.encounterIndex ?? null,
    raritySet: input.raritySet ?? null,
    season: input.season ?? null,
    currentTeam: input.currentTeam ?? null,
    currentTeamHash: input.currentTeamHash ?? null,
    roster: input.roster ?? null,
    minAttacks: input.minAttacks ?? 20
  }
}
