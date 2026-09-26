import type { Database as SupabaseDatabase } from '@tacticus/app-core/database.generated'
import type { TypedSupabaseClient } from '@tacticus/app-core/types'
import {
  CONFIG,
  fetchWithCircuitBreaker,
  getErrorMessage,
  logger
} from './api-client'

type StrictSupabaseClient = TypedSupabaseClient
type GuildConfigRow =
  SupabaseDatabase['public']['Tables']['guild_config']['Row']

export async function autoPatchGuildConfig(
  supabase: StrictSupabaseClient,
  guildCode: string,
  apiKey: string,
  options: { forceRefreshTag?: boolean } = {}
): Promise<GuildConfigRow> {
  let needsUpdate = false
  const updateData: Partial<GuildConfigRow> = {}

  const { data: config, error: configError } = await supabase
    .from('guild_config')
    .select('*')
    .eq('guild_code', guildCode)
    .single()

  if (configError || !config) {
    throw new Error('Guild configuration not found')
  }

  const updatedConfig: GuildConfigRow = { ...config }

  if (
    (!config.guild_id || !config.guild_tag || options.forceRefreshTag) &&
    apiKey
  ) {
    logger.info(
      { guildCode },
      'Missing guild_id or guild_tag, attempting to extract from API...'
    )
    try {
      const guildResult = await fetchWithCircuitBreaker(
        `${CONFIG.api.baseUrl}/guild`,
        {
          headers: {
            'X-API-KEY': apiKey,
            Accept: 'application/json'
          }
        },
        2,
        10000
      )

      if (guildResult.ok) {
        const guildData = await guildResult.json()

        // The API returns guildTag, not our guildCode, so compare by guildId.
        const guildId =
          guildData.guild?.guildId || guildData.guildId || guildData.id
        if (guildId && config.guild_id && guildId !== config.guild_id) {
          logger.warn(
            {
              guildCode,
              guildId,
              expectedGuildId: config.guild_id
            },
            'API key guild identity mismatch'
          )
          throw new Error('API key belongs to a different guild')
        }

        if (guildId) {
          updateData.guild_id = guildId
          updatedConfig.guild_id = guildId
          needsUpdate = true
          logger.info(
            { guildCode, guildId },
            'Auto-discovered guild identifier'
          )
        }

        // Only fill a missing tag unless forceRefreshTag (admin backfill) is set.
        const guildTag = guildData.guild?.guildTag || guildData.guildTag
        if (
          guildTag &&
          (!config.guild_tag ||
            (options.forceRefreshTag && guildTag !== config.guild_tag))
        ) {
          updateData.guild_tag = guildTag
          updatedConfig.guild_tag = guildTag
          needsUpdate = true
          logger.info(
            {
              guildCode,
              guildTag,
              previousGuildTag: config.guild_tag ?? null
            },
            'Auto-discovered guild tag'
          )
        }
      }
    } catch (error: unknown) {
      // Guild mismatch is a security check, not a transient failure: propagate.
      if (
        error instanceof Error &&
        error.message.startsWith('API key belongs to')
      ) {
        throw error
      }
      logger.error(
        { guildCode },
        `Failed to auto-discover guild_id: ${getErrorMessage(error)}`
      )
    }
  }

  if (needsUpdate) {
    try {
      const { error } = await supabase
        .from('guild_config')
        .update(updateData)
        .eq('guild_code', guildCode)

      if (error) {
        logger.error(
          { guildCode },
          `Failed to update guild config: ${error.message}`
        )
      } else {
        logger.info(
          { guildCode },
          `Successfully auto-patched guild config with: ${Object.keys(updateData).join(', ')}`
        )
      }
    } catch (error: unknown) {
      logger.error(
        { guildCode },
        `Exception during config update: ${getErrorMessage(error)}`
      )
    }
  }

  return updatedConfig
}
