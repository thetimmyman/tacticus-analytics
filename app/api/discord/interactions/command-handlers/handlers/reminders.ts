import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'api.discord.interactions.command-handlers.handlers.reminders'
)
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import type {
  Supabase,
  CommandInteraction,
  CommandResponse,
  Database
} from '../types'
import {
  createCommandResponse,
  buildErrorResponse,
  SUCCESS_THEME,
  ERROR_THEME
} from '../utils/response-builder'
import { getOptionValue } from '../utils/option-parser'
import {
  formatGuildLabel,
  resolveGuildContext
} from '../utils/guild-resolution'

export async function handleTokenReminderCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const action = (
    (getOptionValue(interaction.data.options, 'action') as
      string | undefined) ?? 'enable'
  ).toLowerCase()
  const requestedGuildOption = getOptionValue(
    interaction.data.options,
    'guild'
  ) as string | undefined
  const channelOption = getOptionValue(interaction.data.options, 'channel') as
    string | undefined
  const enable = action !== 'disable'
  const channelId = channelOption || interaction.channel_id || null
  if (!channelId) {
    return buildErrorResponse(
      'Unable to determine which channel to use for reminders. Specify the `channel` option.'
    )
  }
  const guildResolution = await resolveGuildContext(supabase, interaction, {
    requestedGuildOption,
    scope: 'notifications'
  })
  if (!guildResolution.ok) {
    return guildResolution.response
  }

  let persistenceNote = 'Reminder preference saved.'
  try {
    const guildId = interaction.guild_id
    if (!guildId) {
      throw new Error(
        'Discord guild ID is required for token reminder persistence.'
      )
    }

    const reminderRecord: Database['public']['Tables']['discord_token_reminders']['Insert'] =
      {
        discord_guild_id: guildId,
        channel_id: channelId,
        game_guild_code: guildResolution.guild.guildCode,
        cluster_code: guildResolution.guild.clusterCode,
        enabled: enable,
        updated_at: new Date().toISOString()
      }

    const { error: reminderError } = await supabase
      .from('discord_token_reminders')
      .upsert([reminderRecord], {
        onConflict: 'discord_guild_id,game_guild_code'
      })

    if (reminderError) {
      logger.error(
        { err: reminderError },
        'Failed to persist token reminder preference:'
      )
      persistenceNote =
        'Could not persist the reminder setting (database schema update required).'
    }
  } catch (error) {
    rethrowIfAppError(error)
    logger.error({ err: error }, 'Token reminder persistence threw:')
    persistenceNote =
      'Token reminder persistence is not available yet. Please update the database schema.'
  }

  const theme = enable ? SUCCESS_THEME : ERROR_THEME
  const guildLabel = formatGuildLabel(guildResolution.guild)
  return createCommandResponse(theme, {
    title: 'Token Reminder Preference',
    // Delivery goes to the guild's configured webhook, not this channel.
    description: enable
      ? `Token cap reminders for **${guildLabel}** are enabled. Reminders are delivered through the guild's configured Discord webhook (set up in the web dashboard), which may differ from this channel.`
      : `Token cap reminders for **${guildLabel}** have been disabled. The scheduled reminder job will stop sending reminders for this guild.`,
    fields: [
      {
        name: 'Guild',
        value: guildLabel,
        inline: true
      },
      {
        name: 'Status',
        value: enable ? 'Reminders enabled.' : 'Reminders disabled.'
      },
      {
        name: 'Persistence',
        value: persistenceNote
      },
      {
        name: 'Next Steps',
        value: enable
          ? 'Reminders are sent by a scheduled job through the webhook configured in the web dashboard (Guild Settings). Use `/token-reminder action:disable` to stop them.'
          : 'Re-enable at any time with `/token-reminder action:enable`.'
      }
    ],
    footer: `Updated at ${new Date().toLocaleString()}`
  })
}
