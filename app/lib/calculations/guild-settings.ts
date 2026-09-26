import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@tacticus/app-core/types'
import { createComponentLogger } from '@/app/lib/logging'
import { appCache } from '@tacticus/app-core/app-cache'
import { TOKEN_THRESHOLD_SELECT } from '@/app/lib/guild-config-selects'
const logger = createComponentLogger('lib.calculations.guild-settings')

type GuildConfigRow = Database['public']['Tables']['guild_config']['Row']
// calculation_settings does not exist in production guild_config.

export interface GuildCalculationSettings {
  token_offender_threshold: number
  token_abuser_threshold: number
  efficiency_thresholds?: {
    excellent: number
    good: number
    average: number
    below_average: number
  }
}

export const DEFAULT_SETTINGS: GuildCalculationSettings = {
  token_offender_threshold: 26,
  token_abuser_threshold: 25,
  efficiency_thresholds: {
    excellent: 1000000, // damage per token
    good: 500000,
    average: 250000,
    below_average: 100000
  }
}

// Only successful DB reads are cached, so a transient error cannot pin defaults.
const CACHE_TTL_SECONDS = 5 * 60
const cacheKey = (guildCode: string): string => `guild_settings:${guildCode}`

export async function getGuildSettings(
  guildCode: string,
  supabase?: SupabaseClient<Database>
): Promise<GuildCalculationSettings> {
  const key = cacheKey(guildCode)
  const cached = await appCache.get<GuildCalculationSettings>(key)
  if (cached !== null && cached !== undefined) {
    return cached
  }

  try {
    if (!supabase) {
      logger.warn(
        'No Supabase client provided to getGuildSettings, returning defaults'
      )
      return DEFAULT_SETTINGS
    }

    const { data, error } = await supabase
      .from('guild_config')
      .select(TOKEN_THRESHOLD_SELECT)
      .eq('guild_code', guildCode)
      .single()

    if (error || !data) {
      return DEFAULT_SETTINGS
    }

    const guildData = data as unknown as GuildConfigRow

    const settings: GuildCalculationSettings = {
      token_offender_threshold:
        guildData.token_offender_threshold ??
        DEFAULT_SETTINGS.token_offender_threshold,
      token_abuser_threshold:
        guildData.token_abuser_threshold ??
        DEFAULT_SETTINGS.token_abuser_threshold,
      efficiency_thresholds: DEFAULT_SETTINGS.efficiency_thresholds
    }

    await appCache.set(key, settings, CACHE_TTL_SECONDS)

    return settings
  } catch (error) {
    logger.error({ err: error }, 'Error fetching guild settings:')
    return DEFAULT_SETTINGS
  }
}

// Required: the Redis backend has no pattern-delete.
export async function clearGuildSettingsCache(
  guildCode: string
): Promise<void> {
  await appCache.del(cacheKey(guildCode))
}
