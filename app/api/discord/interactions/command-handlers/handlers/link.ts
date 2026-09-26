import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'api.discord.interactions.command-handlers.handlers.link'
)
import type {
  Supabase,
  CommandInteraction,
  CommandResponse,
  Database,
  DiscordInviteCode
} from '../types'
import {
  createCommandResponse,
  buildErrorResponse,
  buildServerNotLinkedResponse,
  resolveTheme,
  COLOR_PALETTE,
  INFO_THEME
} from '../utils/response-builder'
import { getOptionValue } from '../utils/option-parser'
import {
  formatGuildLabel,
  getLinkedGuilds,
  guildMatchesInput
} from '../utils/guild-resolution'
import { GuildConfigService } from '@/app/lib/services/guild-config-service'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'

type DiscordInviteRow = DiscordInviteCode

export async function handleLinkCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const inviteCode = getOptionValue(interaction.data.options, 'invite-code')
  const guildOption = (
    getOptionValue(interaction.data.options, 'guild') as string | undefined
  )?.trim()
  const discordGuildId = interaction.guild_id
  const discordUserId = interaction.member?.user?.id || interaction.user?.id

  if (!discordGuildId) {
    return buildErrorResponse(
      'This command can only be used inside a Discord server.'
    )
  }

  if (!inviteCode || typeof inviteCode !== 'string') {
    return buildErrorResponse(
      'Please provide an invite code from your guild dashboard (Settings -> Integrations).'
    )
  }

  // A pasted bot invite URL carries the code in its `state` param.
  let resolvedInviteCode = inviteCode.trim()
  try {
    if (resolvedInviteCode.startsWith('http')) {
      const url = new URL(resolvedInviteCode)
      const stateParam = url.searchParams.get('state')
      if (stateParam) {
        resolvedInviteCode = stateParam
        logger.info(
          {
            guild: discordGuildId
          },
          'Extracted invite code from OAuth URL state parameter'
        )
      }
    }
  } catch {
    // Not a valid URL, use as-is
  }

  const { data: invite, error: inviteError } = await supabase
    .from('discord_invite_codes')
    .select('*')
    .eq('invite_code', resolvedInviteCode)
    .eq('is_active', true)
    .maybeSingle()

  const inviteRow = invite as DiscordInviteRow | null

  if (inviteError || !inviteRow) {
    logger.warn(
      {
        providedCode: resolvedInviteCode.substring(0, 8) + '...',
        wasUrl: inviteCode.startsWith('http'),
        discordGuildId,
        error: inviteError?.message
      },
      'Invalid invite code attempted'
    )
    return buildErrorResponse(
      'Invalid or expired invite code. Please check the code and try again.'
    )
  }

  if ((inviteRow.current_uses ?? 0) >= (inviteRow.max_uses ?? 0)) {
    return buildErrorResponse(
      'That invite code has already been used the maximum number of times.'
    )
  }

  if (inviteRow.expires_at && new Date() > new Date(inviteRow.expires_at)) {
    return buildErrorResponse(
      'That invite code has expired. Please request a new one from your officers.'
    )
  }

  const resolvedGuildCode = inviteRow.guild_code
    ? inviteRow.guild_code.trim()
    : null

  if (guildOption && resolvedGuildCode) {
    const requestedGuild = await GuildConfigService.findByCodeOrTag(
      supabase,
      guildOption
    )
    if (requestedGuild?.guild_code !== resolvedGuildCode) {
      return buildErrorResponse(
        'This invite code is tied to a different guild. Please use the matching guild tag or code.'
      )
    }
  }

  if (!resolvedGuildCode) {
    return buildErrorResponse(
      'Unable to determine which guild this invite applies to.'
    )
  }

  const guildConfig = await GuildConfigService.getBasic(
    supabase,
    resolvedGuildCode
  )

  if (!guildConfig) {
    return buildErrorResponse(
      `Guild ${resolvedGuildCode} was not found in the database.`
    )
  }
  const resolvedGuildLabel =
    guildConfig.guild_tag ?? guildConfig.display_name ?? resolvedGuildCode

  const resolvedCluster = guildConfig.cluster_code?.toUpperCase() ?? null

  const { data: existingGuilds, error: existingError } = await supabase
    .from('discord_server_guilds')
    .select('game_guild_code, cluster_code')
    .eq('discord_guild_id', discordGuildId)
    .eq('is_active', true)

  if (existingError) {
    logger.error(
      { err: existingError },
      'Failed to load existing Discord guild links'
    )
    return buildErrorResponse(
      'Failed to verify existing guild links. Please try again.'
    )
  }

  if (
    resolvedCluster &&
    (existingGuilds ?? []).some(
      (guild) =>
        guild.cluster_code &&
        guild.cluster_code.toUpperCase() !== resolvedCluster
    )
  ) {
    return buildErrorResponse(
      'This Discord server is already linked to a different cluster. Remove the existing links with `/unlink guild:<tag-or-code>` or use a dedicated server.'
    )
  }

  if (
    (existingGuilds ?? []).some((g) => g.game_guild_code === resolvedGuildCode)
  ) {
    const theme = resolveTheme(resolvedGuildCode)
    return createCommandResponse(theme, {
      title: 'Server Already Linked',
      description: `This Discord server is already linked to guild **${resolvedGuildLabel}**.`,
      fields: [
        {
          name: 'Try These Commands',
          value: '- `/tokens`\n- `/bombs`\n- `/raid-status`\n- `/help`'
        }
      ]
    })
  }

  const mappingInsert: Database['public']['Tables']['discord_server_guilds']['Insert'] =
    {
      discord_guild_id: discordGuildId,
      game_guild_code: resolvedGuildCode,
      cluster_code: resolvedCluster,
      invited_with_code: resolvedInviteCode,
      linked_by_user_id: discordUserId ?? null,
      is_active: true
    }

  const { error: mappingError } = await supabase
    .from('discord_server_guilds')
    .upsert([mappingInsert], {
      onConflict: 'discord_guild_id,game_guild_code'
    })

  if (mappingError) {
    logger.error(
      { err: mappingError },
      'Failed to create Discord server mapping:'
    )
    return buildErrorResponse(
      'Failed to link this Discord server. Please try again later.'
    )
  }

  const inviteUpdate: Database['public']['Tables']['discord_invite_codes']['Update'] =
    {
      current_uses: (inviteRow.current_uses ?? 0) + 1,
      is_active:
        (inviteRow.current_uses ?? 0) + 1 >= (inviteRow.max_uses ?? 0)
          ? false
          : true
    }

  const { error: inviteUpdateError } = await supabase
    .from('discord_invite_codes')
    .update(inviteUpdate)
    .eq('id', inviteRow.id)

  if (inviteUpdateError) {
    logger.warn(
      { inviteUpdateError: inviteUpdateError },
      'Failed to update invite usage counts:'
    )
  }

  const updatedGuildCount = (existingGuilds?.length ?? 0) + 1
  const theme = resolveTheme(resolvedGuildCode)
  return createCommandResponse(theme, {
    title: 'Server Linked Successfully',
    description: `This Discord server is now linked to guild **${resolvedGuildLabel}**. (${updatedGuildCount} total guild${
      updatedGuildCount === 1 ? '' : 's'
    } linked)`,
    color: COLOR_PALETTE.success,
    fields: [
      {
        name: 'Next Steps',
        value: [
          '- `/tokens` for Homina-style readiness gauges',
          '- `/bombs` to review bomb cooldowns',
          '- `/raid-status` for damage and loop details',
          '- `/help` to explore every command'
        ].join('\n')
      }
    ],
    footer: 'Welcome to the Tacticus Analytics bot!'
  })
}

export async function handleUnlinkCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const guildOption = (
    getOptionValue(interaction.data.options, 'guild') as string | undefined
  )?.trim()

  if (!guildOption) {
    return buildErrorResponse(
      'Please provide the `guild` option for the guild you want to unlink.'
    )
  }

  const discordGuildId = interaction.guild_id
  if (!discordGuildId) {
    return buildErrorResponse(
      'This command can only be used inside a Discord server.'
    )
  }

  const linkedGuilds = await getLinkedGuilds(supabase, discordGuildId)
  if (linkedGuilds.length === 0) {
    return buildServerNotLinkedResponse()
  }

  const targetGuild = linkedGuilds.find((g) =>
    guildMatchesInput(g, guildOption)
  )
  if (!targetGuild) {
    return buildErrorResponse(
      `Guild ${guildOption} is not currently linked to this Discord server. Linked guilds: ${linkedGuilds
        .map(formatGuildLabel)
        .join(', ')}`
    )
  }

  const { error } = await supabase
    .from('discord_server_guilds')
    .update({ is_active: false })
    .eq('discord_guild_id', discordGuildId)
    .eq('game_guild_code', targetGuild.guildCode)

  if (error) {
    logger.error({ err: error }, 'Failed to unlink guild from Discord server')
    return buildErrorResponse(
      'Failed to unlink the requested guild. Please try again later.'
    )
  }

  await supabase
    .from('discord_channel_guilds')
    .delete()
    .eq('discord_guild_id', discordGuildId)
    .eq('game_guild_code', targetGuild.guildCode)

  await supabase
    .from('discord_token_reminders')
    .delete()
    .eq('discord_guild_id', discordGuildId)
    .eq('game_guild_code', targetGuild.guildCode)

  // Orphaned personal defaults would keep resolving to the unlinked guild (cross-tenant later).
  await supabase
    .from('discord_user_guild_defaults')
    .delete()
    .eq('discord_guild_id', discordGuildId)
    .eq('game_guild_code', targetGuild.guildCode)

  const theme = resolveTheme(targetGuild.guildCode)
  const targetGuildLabel = formatGuildLabel(targetGuild)
  return createCommandResponse(theme, {
    title: 'Guild Unlinked',
    description: `Guild **${targetGuildLabel}** has been unlinked from this Discord server.`,
    fields: [
      {
        name: 'Remaining Guilds',
        value:
          linkedGuilds.length > 1
            ? linkedGuilds
                .filter((g) => g.guildCode !== targetGuild.guildCode)
                .map(formatGuildLabel)
                .join(', ')
            : 'None'
      }
    ]
  })
}

export async function handleLinkClusterCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const inviteCode = getOptionValue(interaction.data.options, 'invite-code')
  const discordGuildId = interaction.guild_id
  const discordUserId = interaction.member?.user?.id || interaction.user?.id

  if (!discordGuildId) {
    return buildErrorResponse(
      'This command can only be used inside a Discord server.'
    )
  }

  if (!inviteCode || typeof inviteCode !== 'string') {
    return buildErrorResponse(
      'Please provide a cluster invite code from your dashboard.'
    )
  }

  let resolvedInviteCode = inviteCode.trim()
  try {
    if (resolvedInviteCode.startsWith('http')) {
      const url = new URL(resolvedInviteCode)
      const stateParam = url.searchParams.get('state')
      if (stateParam) {
        resolvedInviteCode = stateParam
      }
    }
  } catch {
    // Not a valid URL, use as-is
  }

  const { data: invite, error: inviteError } = await supabase
    .from('discord_invite_codes')
    .select('*')
    .eq('invite_code', resolvedInviteCode)
    .eq('is_active', true)
    .maybeSingle()

  const inviteRow = invite as DiscordInviteRow | null
  if (inviteError || !inviteRow) {
    logger.warn(
      {
        providedCode: resolvedInviteCode.substring(0, 8) + '...',
        wasUrl: inviteCode.startsWith('http'),
        discordGuildId,
        error: inviteError?.message
      },
      'Invalid cluster invite code attempted'
    )
    return buildErrorResponse(
      'Invalid or expired invite code. Please check the code and try again.'
    )
  }

  if ((inviteRow.current_uses ?? 0) >= (inviteRow.max_uses ?? 0)) {
    return buildErrorResponse(
      'That invite code has already been used the maximum number of times.'
    )
  }

  if (inviteRow.expires_at && new Date() > new Date(inviteRow.expires_at)) {
    return buildErrorResponse(
      'That invite code has expired. Please request a new one from your officers.'
    )
  }

  const inviteGuildCode = inviteRow.guild_code?.trim() ?? null
  if (!inviteGuildCode) {
    return buildErrorResponse(
      'This invite is missing guild metadata. Please generate a new invite.'
    )
  }

  // Uncached: a stale cluster could link the server to the guild's former cluster.
  const { data: inviteGuild, error: inviteGuildError } = await supabase
    .from('guild_config')
    .select('cluster_code')
    .eq('guild_code', inviteGuildCode)
    .maybeSingle()

  if (inviteGuildError || !inviteGuild?.cluster_code) {
    return buildErrorResponse(
      `No cluster information was found for guild ${inviteGuildCode}.`
    )
  }

  const inviteCluster = inviteGuild.cluster_code.toUpperCase()

  const { data: linkedGuilds, error: linkedGuildError } = await supabase
    .from('discord_server_guilds')
    .select('game_guild_code, cluster_code')
    .eq('discord_guild_id', discordGuildId)
    .eq('is_active', true)

  if (linkedGuildError) {
    logger.error(
      { err: linkedGuildError },
      'Failed to load linked guilds during cluster link command'
    )
    return buildErrorResponse(
      'Unable to verify existing links. Please try again later.'
    )
  }

  const mismatchedCluster = (linkedGuilds ?? []).find(
    (guild) =>
      guild.cluster_code && guild.cluster_code.toUpperCase() !== inviteCluster
  )
  if (mismatchedCluster) {
    return buildErrorResponse(
      `This server already contains guild **${formatGuildDisplayLabel(
        null,
        mismatchedCluster.game_guild_code
      )}** from another cluster. Remove those links before using a new cluster invite.`
    )
  }

  const { data: clusterGuilds, error: clusterGuildError } = await supabase
    .from('guild_config')
    .select('guild_code, guild_tag, display_name')
    .eq('cluster_code', inviteCluster)
    .eq('enabled', true)
    .order('guild_code', { ascending: true })

  if (clusterGuildError || !clusterGuilds || clusterGuilds.length === 0) {
    return buildErrorResponse(
      `No enabled guilds were found for cluster ${inviteCluster}. Verify the cluster configuration and try again.`
    )
  }

  const alreadyLinked = new Set(
    (linkedGuilds ?? []).map((g) => g.game_guild_code)
  )
  const guildsToInsert = clusterGuilds.filter(
    (guild) => !alreadyLinked.has(guild.guild_code)
  )

  if (guildsToInsert.length === 0) {
    return createCommandResponse(INFO_THEME, {
      title: 'All Guilds Already Linked',
      description: `Every guild in cluster **${inviteCluster}** is already linked to this Discord server.`,
      fields: [
        {
          name: 'Linked Guilds',
          value: clusterGuilds
            .map((g) => g.guild_tag ?? g.display_name ?? g.guild_code)
            .join(', ')
        }
      ]
    })
  }

  const insertRows: Database['public']['Tables']['discord_server_guilds']['Insert'][] =
    guildsToInsert.map((guild) => ({
      discord_guild_id: discordGuildId,
      game_guild_code: guild.guild_code,
      cluster_code: inviteCluster,
      invited_with_code: resolvedInviteCode,
      linked_by_user_id: discordUserId ?? null,
      is_active: true
    }))

  const { error: insertError } = await supabase
    .from('discord_server_guilds')
    .upsert(insertRows, {
      onConflict: 'discord_guild_id,game_guild_code'
    })

  if (insertError) {
    logger.error(
      { err: insertError },
      'Failed to bulk link guilds via cluster command'
    )
    return buildErrorResponse(
      'Failed to link all guilds. Please try again later.'
    )
  }

  const { error: inviteUpdateError } = await supabase
    .from('discord_invite_codes')
    .update({
      current_uses: (inviteRow.current_uses ?? 0) + 1,
      is_active:
        (inviteRow.current_uses ?? 0) + 1 >= (inviteRow.max_uses ?? 0)
          ? false
          : true
    })
    .eq('id', inviteRow.id)

  if (inviteUpdateError) {
    logger.warn(
      { inviteUpdateError: inviteUpdateError },
      'Failed to update cluster invite usage counts:'
    )
  }

  const theme = resolveTheme(inviteCluster)
  return createCommandResponse(theme, {
    title: 'Cluster Linked Successfully',
    description: `Linked **${guildsToInsert.length}** guild${
      guildsToInsert.length === 1 ? '' : 's'
    } from cluster **${inviteCluster}** to this Discord server.`,
    fields: [
      {
        name: 'Newly Added Guilds',
        value: guildsToInsert
          .map((g) => g.guild_tag ?? g.display_name ?? g.guild_code)
          .join(', ')
      },
      {
        name: 'Already Linked',
        value:
          alreadyLinked.size > 0 ? Array.from(alreadyLinked).join(', ') : 'None'
      }
    ]
  })
}
