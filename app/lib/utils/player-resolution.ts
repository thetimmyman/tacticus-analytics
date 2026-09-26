import { SupabaseClient } from '@supabase/supabase-js'
import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger('lib.utils.player-resolution')

export interface PlayerIdentity {
  player_id: string
  current_display_name: string
  all_display_names: string[]
  guild_code?: string
  is_current?: boolean
}

export interface PlayerResolutionOptions {
  includeHistoricalNames?: boolean
  guildCode?: string
  fallbackToDisplayName?: boolean
}

export async function resolvePlayerIdentity(
  supabase: SupabaseClient,
  displayName: string,
  options: PlayerResolutionOptions = {}
): Promise<PlayerIdentity | null> {
  const {
    includeHistoricalNames = true,
    guildCode,
    fallbackToDisplayName = true
  } = options

  try {
    let query = supabase
      .from('player_mapping')
      .select('player_id, display_name, guild_code, is_current')
      .eq('display_name', displayName)
      .eq('is_current', true)

    if (guildCode) {
      query = query.eq('guild_code', guildCode)
    }

    const { data: currentMapping, error: currentError } =
      await query.maybeSingle()

    if (currentError) {
      logger.warn(
        { currentError: currentError },
        'Error looking up current player mapping:'
      )
      return fallbackToDisplayName ? createFallbackIdentity(displayName) : null
    }

    if (!currentMapping?.player_id) {
      const { data: historicalMapping, error: historicalError } = await supabase
        .from('player_mapping')
        .select('player_id, display_name, guild_code, is_current')
        .eq('display_name', displayName)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (historicalError || !historicalMapping?.player_id) {
        logger.warn(
          { displayName: displayName },
          'Player not found in mapping table:'
        )
        return fallbackToDisplayName
          ? createFallbackIdentity(displayName)
          : null
      }

      const { data: currentName, error: currentNameError } = await supabase
        .from('player_mapping')
        .select('display_name, guild_code')
        .eq('player_id', historicalMapping.player_id)
        .eq('is_current', true)
        .maybeSingle()

      const resolvedCurrentName =
        currentNameError || !currentName
          ? displayName
          : currentName.display_name

      return buildPlayerIdentity(
        supabase,
        historicalMapping.player_id,
        resolvedCurrentName,
        includeHistoricalNames,
        currentName?.guild_code ?? historicalMapping.guild_code
      )
    }

    return buildPlayerIdentity(
      supabase,
      currentMapping.player_id,
      currentMapping.display_name,
      includeHistoricalNames,
      currentMapping.guild_code
    )
  } catch (error) {
    logger.error({ err: error }, 'Error resolving player identity:')
    return fallbackToDisplayName ? createFallbackIdentity(displayName) : null
  }
}

export async function getPlayerHistoricalNames(
  supabase: SupabaseClient,
  playerId: string
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('player_mapping')
      .select('display_name')
      .eq('player_id', playerId)
      .order('updated_at', { ascending: false })

    if (error) {
      logger.warn({ error: error }, 'Error fetching historical names:')
      return []
    }

    return [...new Set(data?.map((d) => d.display_name).filter(Boolean) || [])]
  } catch (error) {
    logger.error({ err: error }, 'Error getting historical names:')
    return []
  }
}

/** Ignores is_current, so it works for players who left the guild. */
export async function getLastKnownDisplayName(
  supabase: SupabaseClient,
  playerId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('player_mapping')
      .select('display_name')
      .eq('player_id', playerId)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error) {
      logger.warn({ error: error }, 'Error fetching last known display name:')
      return null
    }

    return data?.display_name || null
  } catch (error) {
    logger.error({ err: error }, 'Error getting last known display name:')
    return null
  }
}

export async function getCurrentDisplayName(
  supabase: SupabaseClient,
  playerId: string
): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from('player_mapping')
      .select('display_name')
      .eq('player_id', playerId)
      .eq('is_current', true)
      .maybeSingle()

    if (error) {
      logger.warn({ error: error }, 'Error fetching current display name:')
      return (await getLastKnownDisplayName(supabase, playerId)) || 'Unknown'
    }

    if (data?.display_name) {
      return data.display_name
    }

    const lastKnown = await getLastKnownDisplayName(supabase, playerId)
    return lastKnown || 'Unknown'
  } catch (error) {
    logger.error({ err: error }, 'Error getting current display name:')
    return 'Unknown'
  }
}

async function buildPlayerIdentity(
  supabase: SupabaseClient,
  playerId: string,
  currentDisplayName: string,
  includeHistoricalNames: boolean,
  guildCode?: string | null
): Promise<PlayerIdentity> {
  const identity: PlayerIdentity = {
    player_id: playerId,
    current_display_name: currentDisplayName,
    all_display_names: [currentDisplayName],
    guild_code: guildCode ?? undefined
  }

  if (includeHistoricalNames) {
    const historicalNames = await getPlayerHistoricalNames(supabase, playerId)
    identity.all_display_names =
      historicalNames.length > 0 ? historicalNames : [currentDisplayName]
  }

  return identity
}

function createFallbackIdentity(displayName: string): PlayerIdentity {
  return {
    player_id: `fallback_${displayName}`,
    current_display_name: displayName,
    all_display_names: [displayName]
  }
}

export function createStablePlayerKey(
  playerId: string | null | undefined,
  displayName: string,
  guild?: string
): string {
  if (playerId && playerId !== `fallback_${displayName}`) {
    return playerId
  }

  const normalizedGuild = guild?.trim().toUpperCase() || 'UNKNOWN'
  const normalizedName = displayName?.trim().toLowerCase() || 'unknown'
  return `${normalizedGuild}::${normalizedName}`
}
