import type { DiscordCommandContext } from './command-context.ts'
import {
  calculateBombTimer,
  calculateSecondsToCap,
  chunkLines,
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
  TOKEN_REGEN_SECONDS,
  verifyUserPermissions
} from './command-shared.ts'

export async function handleRaidStatusCommand(
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
  const detailed = Boolean(
    interaction.data.options?.find((opt: any) => opt.name === 'detailed')?.value
  )

  if (!permissions.accessibleGuilds.includes(requestedGuild)) {
    await sendFollowupMessage(interaction.token, {
      content: `Access denied: You don't have access to the requested guild from this Discord server.`,
      flags: 64
    })
    return
  }

  const { data: raidData, error } = await supabase
    .from('EOT_GR_data')
    .select('displayName, Name, damageDealt, damageType, startedOn')
    .eq('Season', requestedSeason)
    .eq('Guild', requestedGuild)
    .in('damageType', ['Battle', 'Bomb'])
    .order('startedOn', { ascending: false })

  if (error) {
    await sendFollowupMessage(interaction.token, {
      content: `Failed to load raid data: ${error.message}`,
      flags: 64
    })
    return
  }

  if (!raidData || raidData.length === 0) {
    await sendFollowupMessage(interaction.token, {
      content: `No raid activity found for guild ${requestedGuild} in season ${requestedSeason}.`,
      flags: 64
    })
    return
  }

  let totalDamage = 0
  let totalBattles = 0
  let totalBombs = 0
  const uniquePlayers = new Set<string>()

  const playerTotals = new Map<
    string,
    { damage: number; battles: number; bombs: number }
  >()
  const bossTotals = new Map<string, { damage: number; hits: number }>()

  raidData.forEach((record: any) => {
    const damage = Number(record.damageDealt) || 0
    totalDamage += damage
    uniquePlayers.add(
      resolveDisplayNameWithMap(
        record.displayName,
        record.userId,
        context.playerNameMap
      )
    )

    if (record.damageType === 'Bomb') {
      totalBombs += 1
    } else {
      totalBattles += 1
    }

    const playerKey = resolveDisplayNameWithMap(
      record.displayName,
      record.userId,
      context.playerNameMap
    )
    if (!playerTotals.has(playerKey)) {
      playerTotals.set(playerKey, { damage: 0, battles: 0, bombs: 0 })
    }
    const playerStat = playerTotals.get(playerKey)!
    playerStat.damage += damage
    if (record.damageType === 'Bomb') {
      playerStat.bombs += 1
    } else {
      playerStat.battles += 1
    }

    const bossKey = record.Name || 'Unknown'
    if (!bossTotals.has(bossKey)) {
      bossTotals.set(bossKey, { damage: 0, hits: 0 })
    }
    const bossStat = bossTotals.get(bossKey)!
    bossStat.damage += damage
    bossStat.hits += 1
  })

  const topPlayers = Array.from(playerTotals.entries())
    .sort((a, b) => b[1].damage - a[1].damage)
    .slice(0, 5)
    .map(([name, stat], index) => {
      const battleInfo = stat.battles > 0 ? `${stat.battles} battles` : null
      const bombInfo = stat.bombs > 0 ? `${stat.bombs} bombs` : null
      const activity = formatList(
        [battleInfo, bombInfo].filter(Boolean) as string[],
        { emptyLabel: 'No attempts logged' }
      )
      return `${index + 1}. ${relabelForDisplay(name, context.labelMap)}: ${formatCompactNumber(
        stat.damage,
        { decimals: 2 }
      )} damage (${activity})`
    })

  const topBosses = Array.from(bossTotals.entries())
    .sort((a, b) => b[1].damage - a[1].damage)
    .slice(0, 5)
    .map(
      ([name, stat], index) =>
        `${index + 1}. ${name}: ${formatCompactNumber(stat.damage, {
          decimals: 2
        })} damage across ${stat.hits} attempts`
    )

  const summaryLines = [
    `Season: ${requestedSeason}`,
    `Guild: ${requestedGuild}`,
    `Total damage: ${formatCompactNumber(totalDamage, { decimals: 2 })}`,
    `Battles: ${totalBattles}`,
    `Bombs: ${totalBombs}`,
    `Active players: ${uniquePlayers.size}`
  ]

  const fields: Array<{ name: string; value: string; inline: boolean }> = [
    {
      name: 'Overview',
      value: summaryLines.join('\n'),
      inline: false
    },
    {
      name: 'Top Players',
      value:
        topPlayers.length > 0
          ? topPlayers.join('\n')
          : 'No player data available.',
      inline: false
    },
    {
      name: 'Top Bosses',
      value:
        topBosses.length > 0 ? topBosses.join('\n') : 'No boss data available.',
      inline: false
    }
  ]

  if (detailed) {
    const recentBattles = raidData.slice(0, 5).map((record: any) => {
      const when = record.startedOn
        ? new Date(record.startedOn).toLocaleString()
        : 'Unknown time'
      const damage = formatCompactNumber(Number(record.damageDealt) || 0, {
        decimals: 2
      })
      const typeLabel = record.damageType === 'Bomb' ? 'Bomb' : 'Battle'
      return `- ${when}: ${relabelForDisplay(
        resolveDisplayNameWithMap(
          record.displayName,
          record.userId,
          context.playerNameMap
        ),
        context.labelMap
      )} vs ${record.Name || 'Unknown'} (${typeLabel}) ${damage}`
    })

    fields.push({
      name: 'Recent Activity',
      value: recentBattles.join('\n'),
      inline: false
    })
  }

  const embed = {
    title: `Raid Status - ${requestedGuild}`,
    description: detailed
      ? 'Detailed raid report including recent activity.'
      : 'Raid performance snapshot.',
    color: 0x1abc9c,
    fields,
    footer: {
      text: `Generated at ${new Date().toLocaleString()}`
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}

export async function handleTokenReminderCommand(
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

  const action = (
    interaction.data.options?.find((opt: any) => opt.name === 'action')
      ?.value || 'enable'
  ).toLowerCase()
  const channelOption = interaction.data.options?.find(
    (opt: any) => opt.name === 'channel'
  )?.value
  const enable = action !== 'disable'
  const channelId = channelOption || interaction.channel_id
  const channelMention = channelId ? `<#${channelId}>` : 'this channel'

  let persistenceNote = 'Reminder preference saved.'
  try {
    const { error: reminderError } = await supabase
      .from('discord_token_reminders')
      .upsert(
        {
          discord_guild_id: discordGuildId,
          channel_id: channelId,
          enabled: enable,
          updated_at: new Date().toISOString()
        },
        { onConflict: 'discord_guild_id' }
      )

    if (reminderError) {
      persistenceNote =
        'Could not persist the reminder setting (database schema update required).'
    }
  } catch (error) {
    persistenceNote =
      'Token reminder persistence is not available yet. Please update the database schema.'
  }

  const embed = {
    title: 'Token Reminder Preference',
    description: enable
      ? `Token cap reminders will be posted in ${channelMention}.`
      : 'Token cap reminders have been disabled.',
    color: enable ? 0x2ecc71 : 0xe74c3c,
    fields: [
      {
        name: 'Status',
        value: enable ? 'Reminders enabled.' : 'Reminders disabled.',
        inline: false
      },
      {
        name: 'Persistence',
        value: persistenceNote,
        inline: false
      },
      {
        name: 'Next Steps',
        value:
          'Reminder messages are generated by scheduled jobs. Ensure the backend reminder job is configured to honour this setting.',
        inline: false
      }
    ],
    footer: {
      text: `Updated at ${new Date().toLocaleString()}`
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}

export async function handleTimeToBurnCommand(
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
      content: 'Please provide a player name (game display name).',
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
  const normalizedGuild = requestedGuild.trim().toUpperCase()
  const accessibleGuildsUpper = permissions.accessibleGuilds.map((g: string) =>
    g.trim().toUpperCase()
  )

  if (!accessibleGuildsUpper.includes(normalizedGuild)) {
    await sendFollowupMessage(interaction.token, {
      content: `Access denied: You don't have access to the requested guild from this Discord server.`,
      flags: 64
    })
    return
  }

  const { data: tokenData, error } = await supabase.rpc(
    'get_token_usage_for_guild',
    {
      p_guild_code: normalizedGuild,
      p_season: requestedSeason
    }
  )

  if (error) {
    await sendFollowupMessage(interaction.token, {
      content: `Failed to load token data: ${error.message}`,
      flags: 64
    })
    return
  }

  if (!Array.isArray(tokenData) || tokenData.length === 0) {
    await sendFollowupMessage(interaction.token, {
      content: `No token data found for guild ${requestedGuild} in season ${requestedSeason}.`,
      flags: 64
    })
    return
  }

  const normalizedQuery = playerName.toUpperCase()
  const row = tokenData.find((entry: any) =>
    (entry.display_name || entry.displayName || '')
      .toUpperCase()
      .includes(normalizedQuery)
  )

  if (!row) {
    await sendFollowupMessage(interaction.token, {
      content: `No players matching "${playerName}" found in guild ${requestedGuild} for season ${requestedSeason}.`,
      flags: 64
    })
    return
  }

  const tokensAvailable =
    typeof row.tokens_available === 'number'
      ? row.tokens_available
      : typeof row.tokens_available_live === 'number'
        ? row.tokens_available_live
        : null
  const tokenNextSeconds: number | null =
    typeof row.token_next_in_seconds === 'number'
      ? row.token_next_in_seconds
      : null
  const maxTokens =
    typeof row.max_possible === 'number' ? Math.min(row.max_possible, 3) : 3

  // Best-effort persist of burn state.
  try {
    await supabase.rpc('record_token_burn_state', {
      p_guild_code: normalizedGuild,
      p_season: requestedSeason,
      p_player_id: row.player_id || row.playerId || null,
      p_display_name: row.display_name || row.displayName || playerName,
      p_tokens_available: tokensAvailable,
      p_token_next_in_seconds: tokenNextSeconds
    })
  } catch {
    // ignore persistence errors for the user-facing response
  }

  let burnState: any = null
  try {
    const { data: burnData, error: burnError } = await supabase.rpc(
      'get_token_burn_state',
      {
        p_guild_code: normalizedGuild,
        p_season: requestedSeason,
        p_player_id: row.player_id || row.playerId || null,
        p_display_name: row.display_name || row.displayName || playerName
      }
    )
    if (!burnError) {
      burnState = Array.isArray(burnData) ? burnData[0] : burnData
    }
  } catch {
    // burn state is optional; ignore errors
  }

  if (tokensAvailable === null) {
    await sendFollowupMessage(interaction.token, {
      content: `Token availability is not available for ${
        row.display_name || playerName
      }.`,
      flags: 64
    })
    return
  }

  if (tokenNextSeconds === null) {
    await sendFollowupMessage(interaction.token, {
      content: `Regeneration timer unavailable for ${
        row.display_name || playerName
      }; cannot compute time to burn.`,
      flags: 64
    })
    return
  }

  const now = Date.now()
  const safeNext = Math.max(0, tokenNextSeconds)
  const asDiscordTs = (date: Date) => {
    const seconds = Math.floor(date.getTime() / 1000)
    return {
      absolute: `<t:${seconds}:T>`,
      relative: `<t:${seconds}:R>`
    }
  }

  let statusLine = ''
  let detailLine: string | undefined

  if (tokensAvailable >= maxTokens) {
    const burnAt = new Date(now + safeNext * 1000)
    const { absolute, relative } = asDiscordTs(burnAt)
    statusLine =
      safeNext === 0
        ? 'Already burning: next token will be lost immediately unless spent.'
        : `Next burned token in ${relative} (${absolute}).`
    detailLine = 'Subsequent burns follow every 12h while you remain at cap.'
  } else {
    const secondsToCap = calculateSecondsToCap(
      tokensAvailable,
      maxTokens,
      tokenNextSeconds
    )
    if (secondsToCap === null) {
      statusLine =
        'Not capped and regen timer unavailable; cannot forecast burn.'
    } else if (secondsToCap === 0) {
      // Should not happen because tokensAvailable < maxTokens, but guard anyway
      const burnAt = new Date(now + safeNext * 1000)
      const { absolute, relative } = asDiscordTs(burnAt)
      statusLine = `Next burned token in ${relative} (${absolute}).`
    } else {
      const capAt = new Date(now + secondsToCap * 1000)
      const burnAt = new Date(capAt.getTime() + TOKEN_REGEN_SECONDS * 1000)
      const capTs = asDiscordTs(capAt)
      const burnTs = asDiscordTs(burnAt)
      statusLine = [
        'Not currently capped — no burn scheduled.',
        `Est. reach cap ${capTs.relative} (${capTs.absolute}).`,
        `If you stay capped after that, first burn would be ${burnTs.relative} (${burnTs.absolute}).`
      ].join('\n')
    }
  }

  const embed = {
    title: 'Time to Token Burn',
    description: [
      `Guild: ${requestedGuild}`,
      `Season: ${requestedSeason}`,
      `Player: ${row.display_name || row.displayName || playerName}`,
      `Tokens on hand: ${tokensAvailable}/${maxTokens}`,
      statusLine,
      detailLine ?? '',
      burnState && burnState.burned_tokens !== undefined
        ? `Burned tokens this season: ${burnState.burned_tokens} (${
            formatDurationShort(burnState.time_over_cap_seconds) ??
            'time at cap unknown'
          })`
        : ''
    ]
      .filter(Boolean)
      .join('\n'),
    color: tokensAvailable >= maxTokens ? 0xe74c3c : 0x2ecc71,
    footer: {
      text: `Generated at ${new Date().toLocaleString()}`
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}

export async function handleGuildStatsCommand(
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

  if (!permissions.accessibleGuilds.includes(requestedGuild)) {
    await sendFollowupMessage(interaction.token, {
      content: `Access denied: You don't have access to the requested guild from this Discord server.`,
      flags: 64
    })
    return
  }

  const currentSeason = await getCurrentSeason(supabase)

  const { data: performanceData, error } = await supabase
    .from('EOT_GR_data')
    .select('Name, damageDealt, tier, loopIndex, rarity, set')
    .eq('Season', currentSeason)
    .eq('Guild', requestedGuild)
    .eq('damageType', 'Battle')

  if (error) {
    await sendFollowupMessage(interaction.token, {
      content: `Error: ${error.message}`,
      flags: 64
    })
    return
  }

  if (!performanceData || performanceData.length === 0) {
    await sendFollowupMessage(interaction.token, {
      content: `No battle records found for guild ${requestedGuild} in season ${currentSeason}.`,
      flags: 64
    })
    return
  }

  type BossAggregate = {
    name: string
    rarity: string | null
    set: number | null
    tier: number | null
    loop: number | null
    level: string
    totalDamage: number
    attempts: number
  }

  const bossProgress: Record<string, BossAggregate> = {}
  let totalDamage = 0

  performanceData.forEach((record: any) => {
    const rarity = record.rarity as string | null
    let prefix = ''
    switch (rarity) {
      case 'Mythic':
        prefix = 'M'
        break
      case 'Legendary':
        prefix = 'L'
        break
      case 'Epic':
        prefix = 'E'
        break
      case 'Rare':
        prefix = 'R'
        break
      case 'Uncommon':
        prefix = 'U'
        break
      case 'Common':
        prefix = 'C'
        break
      default:
        prefix = 'T'
    }

    const level =
      record.set !== null && record.set !== undefined
        ? `${prefix}${Number(record.set) + 1}`
        : `T${record.tier ?? '?'}`

    const loop = Number(record.loopIndex ?? 0)
    const key = `${record.Name}_${level}_L${loop}`

    if (!bossProgress[key]) {
      bossProgress[key] = {
        name: record.Name || 'Unknown',
        rarity,
        set: record.set ?? null,
        tier: record.tier ?? null,
        loop,
        level,
        totalDamage: 0,
        attempts: 0
      }
    }

    const damage = Number(record.damageDealt) || 0
    bossProgress[key].totalDamage += damage
    bossProgress[key].attempts += 1
    totalDamage += damage
  })

  const sortedProgress = Object.values(bossProgress)
    .sort((a, b) => {
      const rarityOrder: Record<string, number> = {
        Mythic: 3,
        Legendary: 2,
        Epic: 1
      }
      const rarityA = a.rarity ? (rarityOrder[a.rarity] ?? 0) : 0
      const rarityB = b.rarity ? (rarityOrder[b.rarity] ?? 0) : 0
      if (rarityA !== rarityB) return rarityB - rarityA

      const setA = a.set ?? a.tier ?? 0
      const setB = b.set ?? b.tier ?? 0
      if (setA !== setB) return setB - setA

      const loopA = a.loop ?? 0
      const loopB = b.loop ?? 0
      if (loopA !== loopB) return loopB - loopA

      return a.name.localeCompare(b.name)
    })
    .slice(0, 10)

  const progressLines = sortedProgress.map((boss) => {
    const averageDamage =
      boss.attempts > 0 ? boss.totalDamage / boss.attempts : null
    return (
      `- ${boss.name} (${boss.level} L${boss.loop ?? 0}): ` +
      `${formatCompactNumber(boss.totalDamage, { decimals: 2 })} total, ` +
      `${boss.attempts} attempts, avg ${formatCompactNumber(averageDamage, {
        decimals: 2
      })}`
    )
  })

  const progressChunks = chunkLines(progressLines)
  const bossFields =
    progressChunks.length > 0
      ? progressChunks.map((chunk) => ({
          name:
            progressChunks.length === 1
              ? 'Boss Progress'
              : `Boss Progress ${chunk.start}-${chunk.end}`,
          value: chunk.value,
          inline: false
        }))
      : [
          {
            name: 'Boss Progress',
            value: 'No boss progress recorded.',
            inline: false
          }
        ]

  const totalAttempts = performanceData.length
  const summaryLines = [
    `Season: ${currentSeason}`,
    `Guild: ${requestedGuild}`,
    `Battles logged: ${totalAttempts}`,
    `Unique bosses: ${sortedProgress.length}`,
    `Total damage: ${formatCompactNumber(totalDamage, { decimals: 2 })}`
  ]

  const embed = {
    title: `Guild Statistics - ${requestedGuildUpper}`,
    description: 'Current season boss performance snapshot.',
    color: 0x4caf50,
    fields: [
      {
        name: 'Overview',
        value: summaryLines.join('\n'),
        inline: false
      },
      ...bossFields
    ],
    footer: {
      text: `Generated at ${new Date().toLocaleString()}`
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}
