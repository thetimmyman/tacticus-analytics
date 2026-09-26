export type DiscordGuildMapping = {
  guildCode: string
  guildLabel: string
  clusterCode: string | null
}

export type DiscordUserPermissions = {
  allowed: boolean
  userRole: 'member' | 'officer' | 'leader'
  accessibleGuilds: string[]
  reason?: string
}

function normalizeGuildCode(value: string | null | undefined): string {
  return value?.trim().toUpperCase() ?? ''
}

export function formatGuildLabel(
  source: { display_name?: string | null; guild_tag?: string | null } | null,
  guildCode: string
): string {
  const display = source?.display_name?.trim()
  if (display) return display
  const tag = source?.guild_tag?.trim()
  if (tag) return tag
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      guildCode ?? ''
    )
  return isUuid ? `Guild ${guildCode.slice(0, 8)}` : guildCode || 'Guild'
}

export async function getGuildMapping(
  supabase: any,
  discordGuildId: string
): Promise<DiscordGuildMapping | null> {
  const { data, error } = await supabase
    .from('discord_server_guilds')
    .select(
      `
      game_guild_code,
      guild_config!inner(cluster_code, display_name, guild_tag)
    `
    )
    .eq('discord_guild_id', discordGuildId)
    .eq('is_active', true)
    .single()

  if (error || !data) return null

  return {
    guildCode: data.game_guild_code,
    guildLabel: formatGuildLabel(data.guild_config, data.game_guild_code),
    clusterCode: data.guild_config.cluster_code
  }
}

export async function verifyUserPermissions(
  supabase: any,
  discordUserId: string,
  discordGuildId: string,
  requestedGuild?: string
): Promise<DiscordUserPermissions> {
  const mapping = await getGuildMapping(supabase, discordGuildId)
  if (!mapping) {
    return {
      allowed: false,
      userRole: 'member',
      accessibleGuilds: [],
      reason: 'Discord server not linked to any guild'
    }
  }

  const { data, error } = await supabase.rpc(
    'resolve_verified_discord_identities',
    { p_discord_user_ids: [discordUserId] }
  )
  if (error) {
    return {
      allowed: false,
      userRole: 'member',
      accessibleGuilds: [],
      reason: 'Unable to verify your linked Discord identity'
    }
  }

  const mappedGuild = normalizeGuildCode(mapping.guildCode)
  const identity = (data ?? []).find(
    (candidate: { guild_code?: string | null }) =>
      normalizeGuildCode(candidate.guild_code) === mappedGuild
  ) as { role?: string | null; is_app_admin?: boolean | null } | undefined

  if (!identity) {
    return {
      allowed: false,
      userRole: 'member',
      accessibleGuilds: [],
      reason: 'Link your Discord account to an active member of this guild'
    }
  }

  // app_role has both 'leader' and 'Leader'; lowercase like the SQL so mixed case is not demoted.
  const storedRole = (identity.role ?? '').toLowerCase()
  const role: DiscordUserPermissions['userRole'] = identity.is_app_admin
    ? 'leader'
    : storedRole === 'leader'
      ? 'leader'
      : storedRole === 'officer'
        ? 'officer'
        : 'member'
  const accessibleGuilds = [mapping.guildCode]
  if (
    requestedGuild &&
    requestedGuild !== 'ALL' &&
    normalizeGuildCode(requestedGuild) !== mappedGuild
  ) {
    return {
      allowed: false,
      userRole: role,
      accessibleGuilds,
      reason: `No access to guild ${requestedGuild}`
    }
  }

  return { allowed: true, userRole: role, accessibleGuilds }
}
