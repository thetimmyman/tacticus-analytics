import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'api.discord.interactions.command-handlers.handlers.guild-config'
)
import type {
  Supabase,
  CommandInteraction,
  CommandResponse,
  Database
} from '../types'
import {
  createCommandResponse,
  buildErrorResponse,
  buildServerNotLinkedResponse,
  INFO_THEME,
  SUCCESS_THEME
} from '../utils/response-builder'
import { getOptionValue } from '../utils/option-parser'
import {
  formatGuildLabel,
  getLinkedGuilds,
  guildMatchesInput,
  resolveGuildContext
} from '../utils/guild-resolution'
import { resolveVerifiedDiscordIdentities } from '@/app/lib/auth/verified-player-authority'

export async function handleSetDefaultGuildCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const requestedGuild = getOptionValue(interaction.data.options, 'guild') as
    string | undefined
  const channelOption = getOptionValue(interaction.data.options, 'channel') as
    string | undefined
  const scopeOption = (
    (getOptionValue(interaction.data.options, 'scope') as string | undefined) ??
    'tokens'
  ).toLowerCase()
  const actionOption = (
    (getOptionValue(interaction.data.options, 'action') as
      string | undefined) ?? 'set'
  ).toLowerCase()

  const scopeTokens = scopeOption === 'tokens' || scopeOption === 'both'
  const scopeNotifications =
    scopeOption === 'notifications' || scopeOption === 'both'

  const discordGuildId = interaction.guild_id
  if (!discordGuildId) {
    return buildErrorResponse(
      'This command can only be used inside a Discord server.'
    )
  }

  const channelId = channelOption || interaction.channel_id
  if (!channelId) {
    return buildErrorResponse(
      'Unable to determine which channel to target. Provide the `channel` option.'
    )
  }

  const guildResolution = await resolveGuildContext(supabase, interaction, {
    requestedGuildOption: requestedGuild,
    scope:
      actionOption === 'clear'
        ? 'tokens'
        : scopeTokens
          ? 'tokens'
          : 'notifications'
  })
  if (!guildResolution.ok) {
    return guildResolution.response
  }

  const createdBy = interaction.member?.user?.id || interaction.user?.id || null

  if (actionOption === 'clear') {
    const guildLabel = formatGuildLabel(guildResolution.guild)
    const updates: Database['public']['Tables']['discord_channel_guilds']['Update'] =
      {}
    if (scopeTokens) updates.default_for_tokens = false
    if (scopeNotifications) updates.default_for_notifications = false

    if (Object.keys(updates).length === 0) {
      updates.default_for_tokens = false
    }

    await supabase
      .from('discord_channel_guilds')
      .update(updates)
      .eq('discord_guild_id', discordGuildId)
      .eq('discord_channel_id', channelId)
      .eq('game_guild_code', guildResolution.guild.guildCode)

    await supabase
      .from('discord_channel_guilds')
      .delete()
      .eq('discord_guild_id', discordGuildId)
      .eq('discord_channel_id', channelId)
      .eq('game_guild_code', guildResolution.guild.guildCode)
      .eq('default_for_tokens', false)
      .eq('default_for_notifications', false)

    return createCommandResponse(INFO_THEME, {
      title: 'Channel Default Cleared',
      description: `Removed default guild bindings for **${guildLabel}** in <#${channelId}>.`
    })
  }

  if (scopeTokens) {
    await supabase
      .from('discord_channel_guilds')
      .update({ default_for_tokens: false })
      .eq('discord_guild_id', discordGuildId)
      .eq('discord_channel_id', channelId)
  }

  if (scopeNotifications) {
    await supabase
      .from('discord_channel_guilds')
      .update({ default_for_notifications: false })
      .eq('discord_guild_id', discordGuildId)
      .eq('discord_channel_id', channelId)
  }

  const payload: Database['public']['Tables']['discord_channel_guilds']['Insert'] =
    {
      discord_guild_id: discordGuildId,
      discord_channel_id: channelId,
      game_guild_code: guildResolution.guild.guildCode,
      cluster_code: guildResolution.guild.clusterCode,
      created_by: createdBy,
      default_for_tokens: scopeTokens,
      default_for_notifications: scopeNotifications
    }

  const { error } = await supabase
    .from('discord_channel_guilds')
    .upsert([payload], {
      onConflict: 'discord_channel_id,game_guild_code'
    })

  if (error) {
    logger.error({ err: error }, 'Failed to set channel guild default')
    return buildErrorResponse(
      'Failed to update the channel default. Please try again later.'
    )
  }

  const scopeLabel =
    scopeTokens && scopeNotifications
      ? 'tokens and notifications'
      : scopeTokens
        ? 'tokens'
        : 'notifications'

  return createCommandResponse(SUCCESS_THEME, {
    title: 'Channel Default Updated',
    description: `Set **${formatGuildLabel(guildResolution.guild)}** as the default guild for ${scopeLabel} in <#${channelId}>.`
  })
}

export async function handleSetUserGuildCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const discordGuildId = interaction.guild_id
  const discordUserId =
    interaction.member?.user?.id || interaction.user?.id || null
  if (!discordGuildId || !discordUserId) {
    return buildErrorResponse(
      'This command can only be used inside a Discord server.'
    )
  }

  const verifiedIdentity = await resolveVerifiedDiscordIdentities(supabase, [
    discordUserId
  ])
  if (!verifiedIdentity.some((row) => row.discordUserId === discordUserId)) {
    return buildErrorResponse(
      'Claim your player profile with a single-use invite and link Discord from Profile before setting a personal guild default.'
    )
  }

  const linkedGuilds = await getLinkedGuilds(supabase, discordGuildId)
  if (linkedGuilds.length === 0) {
    return buildServerNotLinkedResponse()
  }

  const action = (
    (getOptionValue(interaction.data.options, 'action') as
      string | undefined) ?? 'set'
  ).toLowerCase()
  const guildOption = (
    getOptionValue(interaction.data.options, 'guild') as string | undefined
  )?.trim()

  if (action === 'clear') {
    const { error } = await supabase
      .from('discord_user_guild_defaults')
      .delete()
      .eq('discord_guild_id', discordGuildId)
      .eq('discord_user_id', discordUserId)

    if (error) {
      logger.error({ err: error }, 'Failed to clear user guild default')
      return buildErrorResponse(
        'Failed to clear your default guild. Please try again later.'
      )
    }

    return createCommandResponse(INFO_THEME, {
      title: 'User Default Cleared',
      description:
        'Removed your personal guild default for this Discord server.'
    })
  }

  if (!guildOption) {
    return buildErrorResponse(
      'Please provide the `guild` option when setting a personal default.'
    )
  }

  const match = linkedGuilds.find((g) => guildMatchesInput(g, guildOption))
  if (!match) {
    return buildErrorResponse(
      `Guild ${guildOption} is not linked to this Discord server. Linked guilds: ${linkedGuilds
        .map(formatGuildLabel)
        .join(', ')}`
    )
  }

  const payload: Database['public']['Tables']['discord_user_guild_defaults']['Insert'] =
    {
      discord_user_id: discordUserId,
      discord_guild_id: discordGuildId,
      game_guild_code: match.guildCode,
      cluster_code: match.clusterCode
    }

  const { error } = await supabase
    .from('discord_user_guild_defaults')
    .upsert([payload], {
      onConflict: 'discord_guild_id,discord_user_id'
    })

  if (error) {
    logger.error({ err: error }, 'Failed to set user guild default')
    return buildErrorResponse(
      'Failed to save your default guild. Please try again later.'
    )
  }

  return createCommandResponse(SUCCESS_THEME, {
    title: 'User Default Updated',
    description: `You will now default to guild **${formatGuildLabel(match)}** when running commands. Override with the \`guild\` option at any time.`
  })
}
