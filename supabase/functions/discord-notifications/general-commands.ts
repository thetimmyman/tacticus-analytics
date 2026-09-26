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
  verifyUserPermissions
} from './command-shared.ts'

export async function handleHelpCommand(
  context: DiscordCommandContext,
  interaction: any
) {
  const supabase = context.supabase
  const embed = {
    title: 'Tacticus Analytics Bot',
    description: 'Slash commands available in this server:',
    color: 0x5865f2,
    fields: [
      {
        name: 'Setup',
        value: [
          '- `/link <invite-code>` link this server to your guild',
          '- `/link-cluster <invite-code>` link every guild in a cluster',
          '- `/unlink <guild>` unlink a guild from this server',
          '- `/set-default-guild <guild> [channel] [scope] [action]` set/clear channel defaults',
          '- `/set-user-guild <guild> [action]` set/clear your personal default',
          '- `/status` show current link status',
          '- `/help` display this message'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Guild Tools',
        value: [
          '- `/tokens [season] [guild]` review token and bomb availability',
          '- `/token-usage [season] [guild]` highlight token usage leaders',
          '- `/guild-stats [guild]` summarise boss progress',
          '- `/bombs [ready-only]` list bomb readiness',
          '- `/time-to-burn <player>` time until the next token burn (server regen timer)'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Player Tools',
        value: [
          '- `/player-stats <player>` season performance breakdown',
          '- `/player-tokens <player>` quick token lookup'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Automation',
        value: [
          '- `/token-reminder <enable> [channel]` manage token cap reminders'
        ].join('\n'),
        inline: false
      },
      {
        name: 'Getting Started',
        value: [
          '1. Open dashboard -> Settings -> Integrations',
          '2. Generate a Discord invite code',
          '3. Run `/link <invite-code>` in this server',
          '4. Try `/tokens` once connected'
        ].join('\n'),
        inline: false
      }
    ],
    footer: {
      text: 'Need help? Visit tacticusanalytics.com'
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}
export async function handleStatusCommand(
  context: DiscordCommandContext,
  interaction: any
) {
  const supabase = context.supabase
  const discordGuildId = interaction.guild_id

  const mapping = await getGuildMapping(supabase, discordGuildId)

  if (!mapping) {
    const embed = {
      title: 'Server Not Linked',
      description: 'This Discord server is not linked to a guild yet.',
      color: 0xff6b6b,
      fields: [
        {
          name: 'How to Link',
          value: [
            '1. Open your guild dashboard -> Settings -> Integrations',
            '2. Generate an invite code',
            '3. Use `/link <invite-code>` here'
          ].join('\n'),
          inline: false
        }
      ],
      footer: {
        text: 'Need assistance? Run /help'
      }
    }

    await sendFollowupMessage(interaction.token, { embeds: [embed] })
    return
  }

  const embed = {
    title: 'Server Linked',
    description: `This Discord server is linked to guild **${mapping.guildLabel}**`,
    color: 0x4caf50,
    fields: [
      {
        name: 'Guild',
        value: mapping.guildLabel,
        inline: true
      },
      {
        name: 'Cluster',
        value: mapping.clusterCode || 'Not set',
        inline: true
      },
      {
        name: 'Next Steps',
        value:
          'Try `/tokens`, `/raid-status`, or `/help` to explore available features.',
        inline: false
      }
    ],
    footer: {
      text: 'Linked via Tacticus Analytics'
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}
export async function handleLinkCommand(
  context: DiscordCommandContext,
  interaction: any
) {
  const supabase = context.supabase
  const inviteCode = interaction.data.options?.find(
    (opt: any) => opt.name === 'invite-code'
  )?.value
  const discordGuildId = interaction.guild_id
  const discordUserId = interaction.member?.user?.id || interaction.user?.id

  if (!inviteCode) {
    await sendFollowupMessage(interaction.token, {
      content:
        'Please provide an invite code from your guild dashboard (Settings -> Integrations).',
      flags: 64
    })
    return
  }

  const { data: invite, error: inviteError } = await supabase
    .from('discord_invite_codes')
    .select('*')
    .eq('invite_code', inviteCode)
    .eq('is_active', true)
    .single()

  if (inviteError || !invite) {
    await sendFollowupMessage(interaction.token, {
      content:
        'Invalid or expired invite code. Please check the code and try again.',
      flags: 64
    })
    return
  }

  if (invite.current_uses >= invite.max_uses) {
    await sendFollowupMessage(interaction.token, {
      content:
        'That invite code has already been used the maximum number of times.',
      flags: 64
    })
    return
  }

  if (new Date() > new Date(invite.expires_at)) {
    await sendFollowupMessage(interaction.token, {
      content:
        'That invite code has expired. Please request a new one from your officers.',
      flags: 64
    })
    return
  }

  const { data: guildConfig } = await supabase
    .from('guild_config')
    .select('guild_code, cluster_code, display_name, guild_tag')
    .eq('guild_code', invite.guild_code)
    .maybeSingle()

  const inviteGuildLabel = formatGuildLabel(guildConfig, invite.guild_code)

  const { data: existingMapping } = await supabase
    .from('discord_server_guilds')
    .select('*')
    .eq('discord_guild_id', discordGuildId)
    .eq('game_guild_code', invite.guild_code)
    .eq('is_active', true)
    .maybeSingle()

  if (existingMapping) {
    await sendFollowupMessage(interaction.token, {
      content: `This Discord server is already linked to guild **${inviteGuildLabel}**. You can use commands like /tokens right away.`
    })
    return
  }

  const { error: mappingError } = await supabase
    .from('discord_server_guilds')
    .upsert(
      {
        discord_guild_id: discordGuildId,
        game_guild_code: invite.guild_code,
        cluster_code: guildConfig?.cluster_code ?? null,
        invited_with_code: inviteCode,
        linked_by_user_id: discordUserId,
        is_active: true
      },
      {
        onConflict: 'discord_guild_id,game_guild_code'
      }
    )

  if (mappingError) {
    console.error('Failed to create server mapping:', mappingError)
    await sendFollowupMessage(interaction.token, {
      content: 'Failed to link this Discord server. Please try again later.',
      flags: 64
    })
    return
  }

  await supabase
    .from('discord_invite_codes')
    .update({
      current_uses: invite.current_uses + 1,
      is_active: invite.current_uses + 1 >= invite.max_uses ? false : true
    })
    .eq('id', invite.id)

  const embed = {
    title: 'Server Linked Successfully',
    description: `This Discord server is now linked to guild **${inviteGuildLabel}**`,
    color: 0x4caf50,
    fields: [
      {
        name: "What's Next?",
        value: [
          '- Use `/tokens` to view token availability',
          '- Try `/bombs` to review bomb readiness',
          '- Run `/raid-status` to see guild progress',
          '- Use `/help` to review all commands'
        ].join('\n'),
        inline: false
      }
    ],
    footer: {
      text: 'Welcome to the Tacticus Analytics bot!'
    }
  }

  await sendFollowupMessage(interaction.token, { embeds: [embed] })
}
export async function handlePlayerStatsCommand(
  context: DiscordCommandContext,
  interaction: any
) {
  const supabase = context.supabase
  const playerName = interaction.data.options?.find(
    (opt: any) => opt.name === 'player'
  )?.value
  const currentSeason = await getCurrentSeason(supabase)

  if (!playerName) {
    await sendFollowupMessage(interaction.token, {
      content: 'Please provide a player name.',
      flags: 64
    })
    return
  }

  const { data, error } = await supabase
    .from('EOT_GR_data')
    .select('Name, Guild, damageDealt, damageType')
    .eq('Season', currentSeason)
    .eq('displayName', playerName)
    .in('damageType', ['Battle', 'Bomb'])

  if (error) {
    await sendFollowupMessage(interaction.token, {
      content: `Error: ${error.message}`,
      flags: 64
    })
    return
  }

  if (!data || data.length === 0) {
    await sendFollowupMessage(interaction.token, {
      content: `No data found for player ${playerName} in season ${currentSeason}.`,
      flags: 64
    })
    return
  }

  type BossStats = {
    battles: number
    bombs: number
    totalDamage: number
    topDamage: number
  }

  const bossMap = new Map<string, BossStats>()
  const guild = data[0]?.Guild || 'Unknown'

  let totalDamage = 0
  let totalBattles = 0
  let totalBombs = 0

  data.forEach((record: any) => {
    const bossName = record.Name || 'Unknown'
    if (!bossMap.has(bossName)) {
      bossMap.set(bossName, {
        battles: 0,
        bombs: 0,
        totalDamage: 0,
        topDamage: 0
      })
    }

    const stats = bossMap.get(bossName)!
    const damage = Number(record.damageDealt) || 0

    if (record.damageType === 'Battle') {
      stats.battles += 1
      totalBattles += 1
    } else if (record.damageType === 'Bomb') {
      stats.bombs += 1
      totalBombs += 1
    }

    stats.totalDamage += damage
    stats.topDamage = Math.max(stats.topDamage, damage)
    totalDamage += damage
  })

  const bosses = Array.from(bossMap.entries()).sort((a, b) => {
    const damageDiff = b[1].totalDamage - a[1].totalDamage
    if (damageDiff !== 0) return damageDiff
    return a[0].localeCompare(b[0])
  })

  const bossLines = bosses.map(([bossName, stats]) => {
    const attempts = stats.battles + stats.bombs
    const averageDamage = attempts > 0 ? stats.totalDamage / attempts : null
    return `- ${bossName}: ${stats.battles} battles, ${stats.bombs} bombs, avg ${formatCompactNumber(
      averageDamage,
      { decimals: 2 }
    )}, top ${formatCompactNumber(stats.topDamage, { decimals: 2 })}`
  })

  const bossChunks = chunkLines(bossLines)
  const bossFields =
    bossChunks.length > 0
      ? bossChunks.map((chunk) => ({
          name:
            bossChunks.length === 1
              ? 'Boss Performance'
              : `Boss Performance ${chunk.start}-${chunk.end}`,
          value: chunk.value,
          inline: false
        }))
      : [
          {
            name: 'Boss Performance',
            value: 'No boss data available.',
            inline: false
          }
        ]

  const overviewLines = [
    `Guild: ${guild}`,
    `Total battles: ${totalBattles}`,
    `Total bombs: ${totalBombs}`,
    `Total damage: ${formatCompactNumber(totalDamage, { decimals: 2 })}`,
    `Unique bosses: ${bosses.length}`
  ]

  const embed = {
    title: `Player Statistics - ${playerName}`,
    description: `Performance metrics for season ${currentSeason}.`,
    color: 0x9c27b0,
    fields: [
      {
        name: 'Overview',
        value: overviewLines.join('\n'),
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
