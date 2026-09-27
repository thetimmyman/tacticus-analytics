import { createComponentLogger } from '@/app/lib/logging'
const logger = createComponentLogger(
  'api.discord.interactions.command-handlers.utils.guild-resolution'
)
import type {
  Supabase,
  CommandInteraction,
  CommandResponse,
  LinkedGuild,
  GuildResolutionResult
} from '../types'
import {
  createCommandResponse,
  buildErrorResponse,
  ERROR_THEME
} from './response-builder'
import { formatGuildDisplayLabel } from '@/app/lib/format/guild'
import { resolveVerifiedDiscordIdentities } from '@/app/lib/auth/verified-player-authority'
import type { SupabaseClient } from '@supabase/supabase-js'

// The Discord link tables are missing from the generated types; query them untyped.
const untypedDb = (supabase: Supabase) => supabase as unknown as SupabaseClient

interface DiscordServerGuildRow {
  game_guild_code: string | null
  cluster_code: string | null
  linked_at: string | null
  guild_config:
    | {
        display_name: string | null
        cluster_code: string | null
        guild_tag: string | null
      }
    | {
        display_name: string | null
        cluster_code: string | null
        guild_tag: string | null
      }[]
    | null
}

interface ChannelGuildRow {
  game_guild_code: string | null
  cluster_code: string | null
  guild_config:
    | {
        display_name: string | null
        cluster_code: string | null
        guild_tag: string | null
      }
    | {
        display_name: string | null
        cluster_code: string | null
        guild_tag: string | null
      }[]
    | null
}

interface DiscordUserGuildDefaultRow {
  game_guild_code: string | null
  cluster_code: string | null
  guild_config:
    | {
        cluster_code: string | null
        display_name: string | null
        guild_tag: string | null
      }
    | {
        cluster_code: string | null
        display_name: string | null
        guild_tag: string | null
      }[]
    | null
}

function normalizeIdentifier(value: string | null | undefined): string {
  return (value ?? '').trim().toUpperCase()
}

export function formatGuildLabel(guild: LinkedGuild): string {
  if (guild.guildTag?.trim()) {
    return guild.displayName?.trim()
      ? `${guild.guildTag.trim()} - ${guild.displayName.trim()}`
      : guild.guildTag.trim()
  }

  return formatGuildDisplayLabel(
    {
      display_name: guild.displayName,
      guild_tag: guild.guildTag,
      guild_code: guild.guildCode
    },
    guild.guildCode
  )
}

export function guildMatchesInput(
  guild: LinkedGuild,
  input: string | null | undefined
): boolean {
  const normalized = normalizeIdentifier(input)
  if (!normalized) {
    return false
  }

  return [guild.guildCode, guild.guildTag, guild.displayName].some(
    (candidate) => normalizeIdentifier(candidate) === normalized
  )
}

export type LinkedGuildLookupResult =
  | { ok: true; guilds: LinkedGuild[] }
  | { ok: false; error: { message: string } }

/** Distinguishes a failed read from an empty result; getLinkedGuilds is the compatibility wrapper. */
export async function getLinkedGuildsResult(
  supabase: Supabase,
  discordGuildId: string | null | undefined
): Promise<LinkedGuildLookupResult> {
  if (!discordGuildId) {
    return { ok: true, guilds: [] }
  }

  const { data, error } = (await untypedDb(supabase)
    .from('discord_server_guilds')
    .select(
      `
        game_guild_code,
        cluster_code,
        linked_at,
        guild_config(display_name, cluster_code, guild_tag)
      `
    )
    .eq('discord_guild_id', discordGuildId)
    .eq('is_active', true)
    .order('linked_at', { ascending: true })) as {
    data: DiscordServerGuildRow[] | null
    error: Error | null
  }

  if (error) {
    logger.error(
      {
        discordGuildId,
        error: error.message
      },
      'Failed to load linked guilds for Discord server'
    )
    return { ok: false, error }
  }

  const guilds = (data ?? []).map((row) => {
    const rawConfig = row.guild_config
    const displayName = Array.isArray(rawConfig)
      ? (rawConfig[0]?.display_name ?? null)
      : (rawConfig?.display_name ?? null)
    const configCluster = Array.isArray(rawConfig)
      ? (rawConfig[0]?.cluster_code ?? null)
      : (rawConfig?.cluster_code ?? null)
    const guildTag = Array.isArray(rawConfig)
      ? (rawConfig[0]?.guild_tag ?? null)
      : (rawConfig?.guild_tag ?? null)

    return {
      guildCode: row.game_guild_code ?? '',
      guildTag,
      clusterCode: row.cluster_code ?? configCluster ?? null,
      displayName
    }
  })
  return { ok: true, guilds }
}

export async function getLinkedGuilds(
  supabase: Supabase,
  discordGuildId: string | null | undefined
): Promise<LinkedGuild[]> {
  const result = await getLinkedGuildsResult(supabase, discordGuildId)
  return result.ok ? result.guilds : []
}

export async function getChannelDefaultGuild(
  supabase: Supabase,
  discordGuildId: string | null | undefined,
  channelId: string | null | undefined,
  scope: 'tokens' | 'notifications'
): Promise<LinkedGuild | null> {
  if (!discordGuildId || !channelId) {
    return null
  }

  const scopeColumn =
    scope === 'notifications'
      ? 'default_for_notifications'
      : 'default_for_tokens'
  const { data, error } = (await untypedDb(supabase)
    .from('discord_channel_guilds')
    .select(
      `
        game_guild_code,
        cluster_code,
        guild_config(display_name, cluster_code, guild_tag)
      `
    )
    .eq('discord_guild_id', discordGuildId)
    .eq('discord_channel_id', channelId)
    .eq(scopeColumn, true)
    .maybeSingle()) as { data: ChannelGuildRow | null; error: Error | null }

  if (error) {
    logger.warn(
      {
        discordGuildId,
        channelId,
        error: error.message
      },
      'Failed to load channel default guild'
    )
    return null
  }

  if (!data?.game_guild_code) {
    return null
  }

  const rawConfig = data.guild_config as
    | {
        display_name: string | null
        cluster_code: string | null
        guild_tag: string | null
      }
    | {
        display_name: string | null
        cluster_code: string | null
        guild_tag: string | null
      }[]
    | null

  const displayName = Array.isArray(rawConfig)
    ? (rawConfig[0]?.display_name ?? null)
    : (rawConfig?.display_name ?? null)
  const configCluster = Array.isArray(rawConfig)
    ? (rawConfig[0]?.cluster_code ?? null)
    : (rawConfig?.cluster_code ?? null)
  const guildTag = Array.isArray(rawConfig)
    ? (rawConfig[0]?.guild_tag ?? null)
    : (rawConfig?.guild_tag ?? null)

  return {
    guildCode: data.game_guild_code,
    guildTag,
    clusterCode: data.cluster_code ?? configCluster ?? null,
    displayName
  }
}

export async function getUserDefaultGuild(
  supabase: Supabase,
  discordGuildId: string | null | undefined,
  discordUserId: string | null | undefined
): Promise<LinkedGuild | null> {
  if (!discordGuildId || !discordUserId) {
    return null
  }

  const { data, error } = (await untypedDb(supabase)
    .from('discord_user_guild_defaults')
    .select(
      `
        game_guild_code,
        cluster_code,
        guild_config(display_name, cluster_code, guild_tag)
      `
    )
    .eq('discord_guild_id', discordGuildId)
    .eq('discord_user_id', discordUserId)
    .maybeSingle()) as {
    data: DiscordUserGuildDefaultRow | null
    error: Error | null
  }

  if (error) {
    logger.warn(
      {
        discordGuildId,
        discordUserId,
        error: error.message
      },
      'Failed to load user default guild'
    )
    return null
  }

  if (!data?.game_guild_code) {
    return null
  }

  const rawConfig = data.guild_config
  const displayName = Array.isArray(rawConfig)
    ? (rawConfig[0]?.display_name ?? null)
    : (rawConfig?.display_name ?? null)
  const configCluster = Array.isArray(rawConfig)
    ? (rawConfig[0]?.cluster_code ?? null)
    : (rawConfig?.cluster_code ?? null)
  const guildTag = Array.isArray(rawConfig)
    ? (rawConfig[0]?.guild_tag ?? null)
    : (rawConfig?.guild_tag ?? null)

  return {
    guildCode: data.game_guild_code,
    guildTag,
    clusterCode: data.cluster_code ?? configCluster ?? null,
    displayName
  }
}

// Discord rejects embed fields over 1024 chars.
export function formatGuildListCapped(
  guilds: LinkedGuild[],
  { prefix = '', separator = ', ', maxLength = 1000 } = {}
): string {
  const labels = guilds.map((g) => `${prefix}${formatGuildLabel(g)}`)
  const included: string[] = []
  let length = 0
  for (const label of labels) {
    const nextLength =
      length + label.length + (included.length > 0 ? separator.length : 0)
    if (nextLength > maxLength) break
    included.push(label)
    length = nextLength
  }
  const omitted = labels.length - included.length
  if (omitted === 0) {
    return included.join(separator)
  }
  return `${included.join(separator)}${separator}…and ${omitted} more`
}

export function buildGuildSelectionRequiredResponse(
  guilds: LinkedGuild[]
): CommandResponse {
  const guildList =
    guilds.length === 0
      ? 'None linked'
      : formatGuildListCapped(guilds, { prefix: '• ', separator: '\n' })

  return createCommandResponse(ERROR_THEME, {
    title: 'Specify a Guild',
    description: [
      'Multiple guilds share this Discord server.',
      'Provide the `guild` option (for example `/tokens guild:SXPKW`), run `/set-user-guild guild:<tag-or-code>` to set a personal default, or use `/set-default-guild guild:<tag-or-code>` in this channel to establish a shared default.'
    ].join('\n'),
    fields: [
      {
        name: 'Linked Guilds',
        value: guildList
      }
    ]
  })
}

export async function resolveGuildContext(
  supabase: Supabase,
  interaction: CommandInteraction,
  {
    requestedGuildOption,
    scope = 'tokens'
  }: {
    requestedGuildOption?: string | null
    scope?: 'tokens' | 'notifications'
  } = {}
): Promise<GuildResolutionResult> {
  const discordGuildId = interaction.guild_id
  const discordUserIdCandidate =
    interaction.member?.user?.id || interaction.user?.id || null
  if (!discordGuildId) {
    return {
      ok: false,
      response: buildErrorResponse(
        'This command can only be used inside a Discord server.'
      )
    }
  }

  const verifiedDiscordRows = discordUserIdCandidate
    ? await resolveVerifiedDiscordIdentities(supabase, [discordUserIdCandidate])
    : []
  const discordUserId = verifiedDiscordRows.some(
    (row) => row.discordUserId === discordUserIdCandidate
  )
    ? discordUserIdCandidate
    : null

  const { data, error } = await supabase.rpc('resolve_discord_guild_context', {
    p_discord_guild_id: discordGuildId,
    p_discord_user_id: discordUserId ?? undefined,
    p_discord_channel_id: interaction.channel_id ?? undefined,
    p_scope: scope,
    p_requested_guild: requestedGuildOption?.trim() ?? undefined
  })

  if (error) {
    logger.warn(
      { error: error.message },
      'resolve_discord_guild_context RPC failed, falling back to legacy'
    )
    return resolveGuildContextLegacy(supabase, interaction, {
      requestedGuildOption,
      scope,
      verifiedDiscordUserId: discordUserId
    })
  }

  const rows: RpcGuildContextRow[] = Array.isArray(data) ? data : []
  if (rows.length === 0) {
    return { ok: false, response: buildServerNotLinkedResponse() }
  }

  const row = rows[0]!
  const allGuilds: LinkedGuild[] = (
    (Array.isArray(row.all_guilds) ? row.all_guilds : []) as Array<{
      guildCode: string
      guildTag?: string | null
      clusterCode: string | null
      displayName: string | null
    }>
  ).map((g) => ({
    guildCode: g.guildCode,
    guildTag: g.guildTag ?? null,
    clusterCode: g.clusterCode ?? null,
    displayName: g.displayName ?? null
  }))

  if (row.source === 'not_found') {
    const requestedGuild = requestedGuildOption?.trim() ?? ''
    return {
      ok: false,
      response: buildErrorResponse(
        `Guild ${requestedGuild} is not linked to this Discord server. Linked guilds: ${formatGuildListCapped(allGuilds)}`
      )
    }
  }

  if (row.source === 'ambiguous') {
    return {
      ok: false,
      response: buildGuildSelectionRequiredResponse(allGuilds)
    }
  }

  const resolvedGuild =
    allGuilds.find((guild) => guild.guildCode === row.guild_code) ?? null

  // A guild outside the active linked set is stale (e.g. survived /unlink) and would serve another server's data.
  if (!resolvedGuild) {
    if (allGuilds.length === 1) {
      return {
        ok: true,
        guild: allGuilds[0]!,
        allGuilds,
        source: 'default'
      }
    }
    return {
      ok: false,
      response:
        allGuilds.length === 0
          ? buildServerNotLinkedResponse()
          : buildGuildSelectionRequiredResponse(allGuilds)
    }
  }

  return {
    ok: true,
    guild: {
      guildCode: resolvedGuild.guildCode,
      guildTag: resolvedGuild.guildTag ?? null,
      clusterCode: row.cluster_code ?? resolvedGuild.clusterCode ?? null,
      displayName: row.display_name ?? resolvedGuild.displayName ?? null
    },
    allGuilds,
    source: row.source as 'option' | 'user' | 'channel' | 'default'
  }
}

interface RpcGuildContextRow {
  guild_code: string | null
  cluster_code: string | null
  display_name: string | null
  source: string
  all_guilds: unknown
}

async function resolveGuildContextLegacy(
  supabase: Supabase,
  interaction: CommandInteraction,
  {
    requestedGuildOption,
    scope = 'tokens',
    verifiedDiscordUserId
  }: {
    requestedGuildOption?: string | null
    scope?: 'tokens' | 'notifications'
    verifiedDiscordUserId: string | null
  }
): Promise<GuildResolutionResult> {
  const discordGuildId = interaction.guild_id!

  const linkedGuilds = await getLinkedGuilds(supabase, discordGuildId)
  if (linkedGuilds.length === 0) {
    return { ok: false, response: buildServerNotLinkedResponse() }
  }

  const requestedGuild = requestedGuildOption?.trim() ?? null
  if (requestedGuild) {
    const match = linkedGuilds.find((g) => guildMatchesInput(g, requestedGuild))
    if (!match) {
      return {
        ok: false,
        response: buildErrorResponse(
          `Guild ${requestedGuild} is not linked to this Discord server. Linked guilds: ${formatGuildListCapped(linkedGuilds)}`
        )
      }
    }
    return { ok: true, guild: match, allGuilds: linkedGuilds, source: 'option' }
  }

  const userDefault = await getUserDefaultGuild(
    supabase,
    discordGuildId,
    verifiedDiscordUserId
  )
  if (userDefault) {
    const match = linkedGuilds.find(
      (g) => g.guildCode === userDefault.guildCode
    )
    if (match) {
      return { ok: true, guild: match, allGuilds: linkedGuilds, source: 'user' }
    }
  }

  const channelDefault = await getChannelDefaultGuild(
    supabase,
    discordGuildId,
    interaction.channel_id,
    scope
  )
  if (channelDefault) {
    const match = linkedGuilds.find(
      (g) => g.guildCode === channelDefault.guildCode
    )
    if (match) {
      return {
        ok: true,
        guild: match,
        allGuilds: linkedGuilds,
        source: 'channel'
      }
    }
  }

  if (linkedGuilds.length === 1) {
    return {
      ok: true,
      guild: linkedGuilds[0]!,
      allGuilds: linkedGuilds,
      source: 'default'
    }
  }

  return {
    ok: false,
    response: buildGuildSelectionRequiredResponse(linkedGuilds)
  }
}

function buildServerNotLinkedResponse(): CommandResponse {
  return createCommandResponse(ERROR_THEME, {
    title: 'Server Not Linked',
    description: 'This Discord server is not linked to any guilds yet.',
    fields: [
      {
        name: 'How to Link',
        value: [
          '1. Open the Tacticus Analytics dashboard -> Settings -> Integrations',
          '2. Generate a guild or cluster invite code',
          '3. Run `/link invite-code:<code>` or `/link-cluster invite-code:<code>` in this server'
        ].join('\n')
      }
    ],
    footer: 'Need help? Use /help for a quickstart guide.'
  })
}
