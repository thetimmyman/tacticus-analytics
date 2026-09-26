import type { DiscordCommandContext } from './command-context.ts'
import {
  calculateBombTimer,
  calculateSecondsToCap,
  chunkLines,
  EMBED_FIELD_SAFE_LENGTH,
  fetchGuildAvailability,
  formatCompactNumber,
  formatDurationShort,
  formatGuildLabel,
  formatIntervalDuration,
  formatList,
  formatPercentage,
  formatRelativeDuration,
  getCurrentSeason,
  getGuildMapping,
  InteractionResponseType,
  relabelForDisplay,
  resolveDisplayNameWithMap,
  sendFollowupMessage,
  TOKENS_PER_SEASON_CAP,
  verifyUserPermissions
} from './command-shared.ts'

export async function handleTokensCommand(
  context: DiscordCommandContext,
  interaction: any
) {
  const supabase = context.supabase
  const discordGuildId = interaction.guild_id
  const discordUserId = interaction.member?.user?.id || interaction.user?.id

  const permissions = await verifyUserPermissions(
    supabase,
    discordUserId,
    discordGuildId
  )

  if (!permissions.allowed) {
    await sendFollowupMessage(interaction.token, {
      content: `Access denied: ${permissions.reason}. Please contact an administrator to link this Discord server to a guild.`,
      flags: 64
    })
    return
  }

  const requestedGuild =
    interaction.data.options?.find((opt: any) => opt.name === 'guild')?.value ||
    permissions.accessibleGuilds[0]
  const requestedSeason =
    interaction.data.options?.find((opt: any) => opt.name === 'season')
      ?.value || (await getCurrentSeason(supabase))

  const availability = await fetchGuildAvailability(
    context,
    permissions,
    requestedGuild,
    requestedSeason
  )

  if (!availability.ok) {
    await sendFollowupMessage(interaction.token, {
      content: availability.message,
      flags: 64
    })
    return
  }

  const summaryLines = [
    `Season: ${availability.season}`,
    `Guilds covered: ${availability.guilds
      .map((guild) => guild.label)
      .join(', ')}`,
    `Players tracked: ${availability.totals.players}`,
    `Tokens remaining: ${availability.totals.tokensReady}/${
      availability.totals.players * TOKENS_PER_SEASON_CAP
    }`,
    `Bombs ready: ${availability.totals.bombsReady}/${availability.totals.players}`
  ]

  const memberFields = availability.guilds.flatMap((guild) => {
    const lines = guild.members.map((member) => {
      const tokensSummary = `${member.tokensRemaining}/${member.tokenCapacity} tokens remaining${
        member.tokensUsed > 0 ? ` (used ${member.tokensUsed})` : ''
      }`
      const bombSummary = member.bombReady ? 'Bomb ready' : member.bombStatus
      return `- ${member.displayName}: ${tokensSummary}, ${bombSummary}`
    })

    const valueRaw = lines.join('\n')
    const maxLen = EMBED_FIELD_SAFE_LENGTH // 900
    const value =
      valueRaw.length > maxLen
        ? `${valueRaw.slice(0, maxLen - 3)}...`
        : valueRaw || 'No player activity recorded this season.'

    return [
      {
        name: `${guild.label} Members`,
        value,
        inline: false
      }
    ]
  })

  const embed = {
    title:
      availability.requestedGuildUpper === 'ALL'
        ? 'Token Availability - Linked Guilds'
        : `Token Availability - ${availability.requestedGuildLabel}`,
    description: 'Current snapshot of token reserves and bomb readiness.',
    color: 0x5865f2,
    fields: [
      {
        name: 'Overview',
        value: summaryLines.join('\n'),
        inline: false
      },
      ...memberFields
    ],
    footer: {
      text: `Generated at ${new Date().toLocaleString()}`
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}

export async function handleBombsCommand(
  context: DiscordCommandContext,
  interaction: any
) {
  const supabase = context.supabase
  const discordGuildId = interaction.guild_id
  const discordUserId = interaction.member?.user?.id || interaction.user?.id

  const permissions = await verifyUserPermissions(
    supabase,
    discordUserId,
    discordGuildId
  )

  if (!permissions.allowed) {
    await sendFollowupMessage(interaction.token, {
      content: `Access denied: ${permissions.reason}. Please contact an administrator to link this Discord server to a guild.`,
      flags: 64
    })
    return
  }

  const requestedGuild =
    interaction.data.options?.find((opt: any) => opt.name === 'guild')?.value ||
    permissions.accessibleGuilds[0]
  const requestedSeason =
    interaction.data.options?.find((opt: any) => opt.name === 'season')
      ?.value || (await getCurrentSeason(supabase))
  const readyOnly = Boolean(
    interaction.data.options?.find((opt: any) => opt.name === 'ready-only')
      ?.value
  )

  const availability = await fetchGuildAvailability(
    context,
    permissions,
    requestedGuild,
    requestedSeason
  )

  if (!availability.ok) {
    await sendFollowupMessage(interaction.token, {
      content: availability.message,
      flags: 64
    })
    return
  }

  const summaryLines = [
    `Season: ${availability.season}`,
    `Guilds covered: ${availability.guilds
      .map((guild) => guild.label)
      .join(', ')}`,
    `Players tracked: ${availability.totals.players}`,
    `Bombs ready: ${availability.totals.bombsReady}/${availability.totals.players}`
  ]

  const memberFields = availability.guilds.flatMap((guild) => {
    const members = readyOnly
      ? guild.members.filter((member) => member.bombReady)
      : guild.members

    if (members.length === 0) {
      return [
        {
          name: `${guild.label} Members`,
          value: readyOnly
            ? 'No bombs are ready at the moment.'
            : 'No player activity recorded this season.',
          inline: false
        }
      ]
    }

    const lines = members.map((member) => {
      const bombSummary = member.bombReady ? 'Ready now' : member.bombStatus
      const tokenInfo = readyOnly
        ? ''
        : `, ${member.tokensRemaining}/${member.tokenCapacity} tokens remaining`
      return `- ${member.displayName}: ${bombSummary}${tokenInfo}`
    })

    const chunks = chunkLines(lines)
    return chunks.map((chunk) => ({
      name:
        chunks.length === 1
          ? `${guild.label} Bomb Status`
          : `${guild.label} Bomb Status ${chunk.start}-${chunk.end}`,
      value: chunk.value,
      inline: false
    }))
  })

  const embed = {
    title:
      availability.requestedGuildUpper === 'ALL'
        ? 'Bomb Availability - Linked Guilds'
        : `Bomb Availability - ${availability.requestedGuildLabel}`,
    description: readyOnly
      ? 'Listing members with bombs ready to deploy.'
      : 'Tracking bomb cooldowns and readiness.',
    color: 0xf39c12,
    fields: [
      {
        name: 'Overview',
        value: summaryLines.join('\n'),
        inline: false
      },
      ...memberFields
    ],
    footer: {
      text: `Generated at ${new Date().toLocaleString()}`
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}

export async function handleTokenUsageCommand(
  context: DiscordCommandContext,
  interaction: any
) {
  const supabase = context.supabase
  const discordGuildId = interaction.guild_id
  const discordUserId = interaction.member?.user?.id || interaction.user?.id

  const permissions = await verifyUserPermissions(
    supabase,
    discordUserId,
    discordGuildId
  )

  if (!permissions.allowed) {
    await sendFollowupMessage(interaction.token, {
      content: `Access denied: ${permissions.reason}. Please contact an administrator to link this Discord server to a guild.`,
      flags: 64
    })
    return
  }

  const requestedGuild =
    interaction.data.options?.find((opt: any) => opt.name === 'guild')?.value ||
    permissions.accessibleGuilds[0]
  const requestedGuildUpper = requestedGuild.trim().toUpperCase()
  const requestedSeason =
    interaction.data.options?.find((opt: any) => opt.name === 'season')
      ?.value || (await getCurrentSeason(supabase))

  const accessibleGuildsUpper = permissions.accessibleGuilds.map((g) =>
    g.trim().toUpperCase()
  )
  const resolveGuildLabel = (normalized: string) => {
    const index = accessibleGuildsUpper.indexOf(normalized)
    return index >= 0 ? permissions.accessibleGuilds[index] : normalized
  }

  if (
    requestedGuildUpper !== 'ALL' &&
    !accessibleGuildsUpper.includes(requestedGuildUpper)
  ) {
    await sendFollowupMessage(interaction.token, {
      content: `Access denied: You don't have access to the requested guild from this Discord server.`,
      flags: 64
    })
    return
  }

  const targetGuilds =
    requestedGuildUpper === 'ALL'
      ? accessibleGuildsUpper
      : [requestedGuildUpper]

  let query = supabase
    .from('EOT_GR_data')
    .select('displayName, Guild')
    .eq('Season', requestedSeason)
    .eq('damageType', 'Battle')

  if (requestedGuildUpper !== 'ALL') {
    query = query.in(
      'Guild',
      permissions.accessibleGuilds.filter(
        (g) => g.trim().toUpperCase() === requestedGuildUpper
      )
    )
  } else {
    query = query.in('Guild', permissions.accessibleGuilds)
  }

  const { data, error } = await query
  if (error) {
    await sendFollowupMessage(interaction.token, {
      content: `Error: ${error.message}`,
      flags: 64
    })
    return
  }

  if (!data || data.length === 0) {
    const guildLabels = targetGuilds.map(resolveGuildLabel).join(', ')
    await sendFollowupMessage(interaction.token, {
      content: `No token usage data found for ${guildLabels} in season ${requestedSeason}.`,
      flags: 64
    })
    return
  }

  type PlayerUsage = {
    displayName: string
    normalizedName: string
    guild: string
    normalizedGuild: string
    tokens: number
  }

  const usageByPlayer: Record<string, PlayerUsage> = {}

  data.forEach((record: any) => {
    const normalizedGuild = (record.Guild || '').trim().toUpperCase()
    if (!targetGuilds.includes(normalizedGuild)) {
      return
    }
    const rawDisplayName = resolveDisplayNameWithMap(
      record.displayName,
      record.userId,
      context.playerNameMap
    )
    const normalizedName = rawDisplayName.trim().toUpperCase()
    const key = `${normalizedGuild}:${normalizedName}`

    if (!usageByPlayer[key]) {
      usageByPlayer[key] = {
        // Relabel for DISPLAY; key/normalizedName stay raw.
        displayName: relabelForDisplay(rawDisplayName, context.labelMap),
        normalizedName,
        guild: record.Guild || normalizedGuild,
        normalizedGuild,
        tokens: 0
      }
    }

    usageByPlayer[key].tokens += 1
  })

  const participants = Object.values(usageByPlayer)

  if (participants.length === 0) {
    const guildLabels = targetGuilds.map(resolveGuildLabel).join(', ')
    await sendFollowupMessage(interaction.token, {
      content: `No token usage data found for ${guildLabels} in season ${requestedSeason}.`,
      flags: 64
    })
    return
  }

  const totalTokensUsed = participants.reduce(
    (sum, player) => sum + player.tokens,
    0
  )
  const counts = participants
    .map((player) => player.tokens)
    .sort((a, b) => a - b)
  const median = counts[Math.floor(counts.length / 2)] || 0
  const average =
    counts.length > 0
      ? counts.reduce((sum, value) => sum + value, 0) / counts.length
      : 0
  const variance =
    counts.length > 0
      ? counts.reduce((sum, value) => sum + Math.pow(value - average, 2), 0) /
        counts.length
      : 0
  const stdDeviation = Math.sqrt(variance)

  const sortedPlayers = [...participants]
    .sort((a, b) => {
      if (b.tokens !== a.tokens) {
        return b.tokens - a.tokens
      }
      if (a.normalizedGuild !== b.normalizedGuild) {
        return a.normalizedGuild.localeCompare(b.normalizedGuild)
      }
      return a.displayName.localeCompare(b.displayName)
    })
    .slice(0, 30)

  const rankingLines = sortedPlayers.map((player, index) => {
    const placement = index + 1
    const guildLabel = resolveGuildLabel(player.normalizedGuild)
    return `${placement}. ${player.displayName} - ${player.tokens} tokens (${guildLabel})`
  })

  const rankingChunks = chunkLines(rankingLines)

  const rankingFields =
    rankingChunks.length > 0
      ? rankingChunks.map((chunk) => ({
          name:
            rankingChunks.length === 1
              ? 'Top Members'
              : `Top Members ${chunk.start}-${chunk.end}`,
          value: chunk.value,
          inline: false
        }))
      : [
          {
            name: 'Top Members',
            value: 'No participants recorded.',
            inline: false
          }
        ]

  const highlightLines = [
    `- Median tokens used: ${median}`,
    `- Average tokens used: ${average.toFixed(1)}`,
    `- Standard deviation: ${stdDeviation.toFixed(1)}`,
    `- Total tokens logged: ${totalTokensUsed}`,
    `- Participants: ${participants.length}`
  ]

  const summaryLines = [
    `Season: ${requestedSeason}`,
    `Guilds covered: ${targetGuilds.map(resolveGuildLabel).join(', ')}`
  ]

  const embed = {
    title:
      requestedGuildUpper === 'ALL'
        ? `Token Usage - Season ${requestedSeason} (All Linked Guilds)`
        : `Token Usage - Season ${requestedSeason}`,
    description: 'Token consumption snapshot for the selected guilds.',
    color: 0x1e88e5,
    fields: [
      {
        name: 'Overview',
        value: summaryLines.join('\n'),
        inline: false
      },
      {
        name: 'Highlights',
        value: highlightLines.join('\n'),
        inline: false
      },
      ...rankingFields
    ],
    footer: {
      text: `Generated at ${new Date().toLocaleTimeString()}`
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}

export async function handlePlayerTokensCommand(
  context: DiscordCommandContext,
  interaction: any
) {
  const supabase = context.supabase
  const discordGuildId = interaction.guild_id
  const discordUserId = interaction.member?.user?.id || interaction.user?.id

  const permissions = await verifyUserPermissions(
    supabase,
    discordUserId,
    discordGuildId
  )

  if (!permissions.allowed) {
    await sendFollowupMessage(interaction.token, {
      content: `Access denied: ${permissions.reason}. Please contact an administrator to link this Discord server to a guild.`,
      flags: 64
    })
    return
  }

  const playerName = interaction.data.options
    ?.find((opt: any) => opt.name === 'player')
    ?.value?.trim()

  if (!playerName) {
    await sendFollowupMessage(interaction.token, {
      content: 'Please provide a player name.',
      flags: 64
    })
    return
  }

  const requestedGuild =
    interaction.data.options?.find((opt: any) => opt.name === 'guild')?.value ||
    'ALL'
  const requestedSeason =
    interaction.data.options?.find((opt: any) => opt.name === 'season')
      ?.value || (await getCurrentSeason(supabase))

  const availability = await fetchGuildAvailability(
    context,
    permissions,
    requestedGuild,
    requestedSeason
  )

  if (!availability.ok) {
    await sendFollowupMessage(interaction.token, {
      content: availability.message,
      flags: 64
    })
    return
  }

  const normalizedQuery = playerName.trim().toUpperCase()
  const matches = availability.guilds.flatMap((guild) =>
    guild.members
      .filter(
        (member) =>
          member.displayName.toUpperCase().includes(normalizedQuery) ||
          member.rawDisplayName.toUpperCase().includes(normalizedQuery)
      )
      .map((member) => ({
        guildLabel: guild.label,
        displayName: member.displayName,
        tokensRemaining: member.tokensRemaining,
        tokenCapacity: member.tokenCapacity,
        tokensUsed: member.tokensUsed,
        bombReady: member.bombReady,
        bombStatus: member.bombStatus
      }))
  )

  if (matches.length === 0) {
    await sendFollowupMessage(interaction.token, {
      content: `No players matching "${playerName}" were found in the selected guilds for season ${availability.season}.`,
      flags: 64
    })
    return
  }

  const limitedMatches = matches.slice(0, 20)
  const summaryLines = [
    `Season: ${availability.season}`,
    `Matches returned: ${limitedMatches.length}${
      matches.length > limitedMatches.length
        ? ` (showing first ${limitedMatches.length})`
        : ''
    }`
  ]

  const lines = limitedMatches.map((match) => {
    const tokenSummary = `${match.tokensRemaining}/${match.tokenCapacity} tokens remaining${
      match.tokensUsed > 0 ? ` (used ${match.tokensUsed})` : ''
    }`
    const bombSummary = match.bombReady ? 'Bomb ready' : match.bombStatus
    return `- ${match.displayName} [${match.guildLabel}]: ${tokenSummary}, ${bombSummary}`
  })

  const chunks = chunkLines(lines)
  const memberFields = chunks.map((chunk) => ({
    name:
      chunks.length === 1 ? 'Players' : `Players ${chunk.start}-${chunk.end}`,
    value: chunk.value,
    inline: false
  }))

  const embed = {
    title: `Player Tokens - "${playerName}"`,
    description: 'Token availability for the requested player name.',
    color: 0x3498db,
    fields: [
      {
        name: 'Overview',
        value: summaryLines.join('\n'),
        inline: false
      },
      ...memberFields
    ],
    footer: {
      text: `Generated at ${new Date().toLocaleString()}`
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}
