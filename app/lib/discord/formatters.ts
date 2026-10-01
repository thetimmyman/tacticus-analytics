import type {
  DiscordEmbed,
  DiscordEmbedField,
  DiscordWebhookPayload
} from './types'
import { formatNumber } from '@tacticus/app-core/formatters'

// Re-exported for existing importers.
import { EMBED_COLORS } from './colors'
export { EMBED_COLORS }

export const EMBED_FOOTER = {
  text: 'Tacticus Analytics',
  icon_url: 'https://www.tacticusanalytics.com/images/logo-no-words.png'
}

// `GuildBoss9Boss1ThousMagnus` → `ThousMagnus` (the sync boss type).
const GUILD_BOSS_PREFIX_RE = /^GuildBoss\d+(?:Boss|MiniBoss)\d+/
const BARE_BOSS_TYPE_RE = /^[A-Za-z][A-Za-z0-9]*$/

export function stripGuildBossPrefix(value: string | undefined): string | null {
  if (!value) return null
  const stripped = value.replace(GUILD_BOSS_PREFIX_RE, '')
  if (!stripped || stripped === value) {
    return BARE_BOSS_TYPE_RE.test(value) ? value : null
  }
  return BARE_BOSS_TYPE_RE.test(stripped) ? stripped : null
}

const buildEmbed = (input: {
  title: string
  description?: string
  color: number
  fields?: DiscordEmbedField[]
  footerText?: string
}): DiscordEmbed => {
  const footerText = input.footerText || EMBED_FOOTER.text

  return {
    title: input.title,
    description: input.description,
    color: input.color,
    fields: input.fields,
    timestamp: new Date().toISOString(),
    footer: {
      text: footerText,
      icon_url: EMBED_FOOTER.icon_url
    }
  }
}

export type BossAssignment = {
  tier: string
  boss_name: string
  boss_code: string
  flex_mode?: boolean
  primary_tokens?: number
  secondary_tokens?: number
  assigned_players?: string[]
}

export type BossAssignmentEmbedOptions = {
  season?: string
  source?: string
  contextLabel?: string
}

export const formatBossAssignmentEmbed = (
  assignments: BossAssignment[],
  options: BossAssignmentEmbedOptions = {}
): DiscordWebhookPayload => {
  const legendaryAssignments = assignments.filter(
    (assignment) => assignment.tier === 'Legendary'
  )
  const mythicAssignments = assignments.filter(
    (assignment) => assignment.tier === 'Mythic'
  )
  const fields: DiscordEmbedField[] = []

  const buildAssignmentList = (items: BossAssignment[]) =>
    items
      .map((assignment) => {
        const tokens = assignment.flex_mode
          ? '🎯 Flex'
          : `${formatNumber(assignment.primary_tokens || 0)}P/${formatNumber(assignment.secondary_tokens || 0)}S`
        const players = assignment.assigned_players?.join(', ') || 'TBD'
        return `**${assignment.boss_name}** (${assignment.boss_code})\n${tokens} • ${players}`
      })
      .join('\n\n')

  if (legendaryAssignments.length > 0) {
    fields.push({
      name: '🟡 Legendary Bosses',
      value: buildAssignmentList(legendaryAssignments).substring(0, 1024),
      inline: false
    })
  }

  if (mythicAssignments.length > 0) {
    fields.push({
      name: '🔴 Mythic Bosses',
      value: buildAssignmentList(mythicAssignments).substring(0, 1024),
      inline: false
    })
  }

  const totalTokens = assignments.reduce((sum, assignment) => {
    if (assignment.flex_mode) return sum
    return (
      sum +
      (assignment.primary_tokens || 0) +
      (assignment.secondary_tokens || 0)
    )
  }, 0)

  const flexBosses = assignments.filter(
    (assignment) => assignment.flex_mode
  ).length

  fields.push({
    name: '📊 Summary',
    value: `**Total Bosses:** ${formatNumber(assignments.length)}\n**Fixed Token Bosses:** ${formatNumber(assignments.length - flexBosses)}\n**Flex Mode Bosses:** ${formatNumber(flexBosses)}\n**Total Tokens Required:** ${formatNumber(totalTokens)}`,
    inline: false
  })

  const titleSuffix = options.contextLabel ? ` - ${options.contextLabel}` : ''
  const footerText = `${options.source === 'auto' ? 'Auto-generated' : 'Manual update'} • ${EMBED_FOOTER.text}`

  return {
    embeds: [
      buildEmbed({
        title: `📋 Boss Assignments${titleSuffix}`,
        description: options.season
          ? `Assignments for Season ${options.season}`
          : 'Current boss assignments',
        color: EMBED_COLORS.info,
        fields,
        footerText
      })
    ]
  }
}

export type WarResultSummary = {
  reportType: 'war_result'
  opponentGuildName: string
  result: 'win' | 'loss' | 'draw' | null
  guildScore: number
  opponentScore: number
  warSeason?: number | null
  battlefieldLevel?: number | null
  topPerformers?: Array<{ name: string; score: number }>
}

export type WarActivitySummary = {
  reportType: 'weekly_activity'
  dateRange: { start: string; end: string }
  totalActivities: number
  activePlayers: number
  inactivePlayers: number
  topPlayers?: Array<{ name: string; totalActivities: number }>
}

export type WarInactivitySummary = {
  reportType: 'inactivity_alert'
  totalPlayers: number
  criticalCount: number
  warningCount: number
  minorCount: number
  players: Array<{ name: string; daysInactive: number; warsMissed: number }>
}

export type WarUpdateData =
  WarResultSummary | WarActivitySummary | WarInactivitySummary

export const formatWarUpdateEmbed = (
  data: WarUpdateData
): DiscordWebhookPayload => {
  if (data.reportType === 'war_result') {
    const isWin = data.result === 'win'
    const isDraw = data.result === 'draw'

    const fields: DiscordEmbedField[] = [
      {
        name: 'Result',
        value: data.result ? data.result.toUpperCase() : 'UNKNOWN',
        inline: true
      },
      {
        name: 'Score',
        value: `${formatNumber(data.guildScore)} - ${formatNumber(data.opponentScore)}`,
        inline: true
      },
      {
        name: 'Differential',
        value: `${data.guildScore - data.opponentScore > 0 ? '+' : ''}${formatNumber(data.guildScore - data.opponentScore)}`,
        inline: true
      }
    ]

    if (data.warSeason) {
      fields.push({
        name: 'Season / Battlefield',
        value: `Season ${formatNumber(data.warSeason)} / BF ${data.battlefieldLevel != null ? formatNumber(data.battlefieldLevel) : 'N/A'}`,
        inline: true
      })
    }

    if (data.topPerformers && data.topPerformers.length > 0) {
      fields.push({
        name: '🌟 Top Performers',
        value: data.topPerformers
          .slice(0, 3)
          .map(
            (performer, index) =>
              `${index === 0 ? '🥇' : index === 1 ? '🥈' : '🥉'} ${performer.name}: ${formatNumber(performer.score)} pts`
          )
          .join('\n'),
        inline: false
      })
    }

    return {
      embeds: [
        buildEmbed({
          title: `${isWin ? '🏆' : isDraw ? '🤝' : '💀'} War ${isWin ? 'Victory' : isDraw ? 'Draw' : 'Defeat'} vs ${data.opponentGuildName}`,
          color: isWin
            ? EMBED_COLORS.success
            : isDraw
              ? EMBED_COLORS.warning
              : EMBED_COLORS.error,
          fields,
          footerText: `${EMBED_FOOTER.text} • War Tracking`
        })
      ]
    }
  }

  if (data.reportType === 'weekly_activity') {
    const fields: DiscordEmbedField[] = [
      {
        name: 'Total Activities',
        value: formatNumber(data.totalActivities),
        inline: true
      },
      {
        name: 'Active Players',
        value: `${formatNumber(data.activePlayers)} players`,
        inline: true
      },
      {
        name: 'Inactive Players',
        value: `${formatNumber(data.inactivePlayers)} players`,
        inline: true
      }
    ]

    if (data.topPlayers && data.topPlayers.length > 0) {
      fields.push({
        name: '🏆 Most Active Players',
        value: data.topPlayers
          .slice(0, 5)
          .map(
            (player, index) =>
              `${index + 1}. ${player.name}: ${formatNumber(player.totalActivities)} activities`
          )
          .join('\n'),
        inline: false
      })
    }

    return {
      embeds: [
        buildEmbed({
          title: '📊 Weekly War Activity Report',
          description: `Activity summary for ${data.dateRange.start} to ${data.dateRange.end}`,
          color: EMBED_COLORS.info,
          fields,
          footerText: `${EMBED_FOOTER.text} • War Tracking`
        })
      ]
    }
  }

  const summaryLines = [
    data.criticalCount > 0
      ? `🔴 Critical (7+ days): ${formatNumber(data.criticalCount)}`
      : null,
    data.warningCount > 0
      ? `🟠 Warning (5-6 days): ${formatNumber(data.warningCount)}`
      : null,
    data.minorCount > 0
      ? `🟡 Minor (3-4 days): ${formatNumber(data.minorCount)}`
      : null
  ].filter(Boolean)

  const fields: DiscordEmbedField[] = [
    {
      name: 'Summary',
      value: summaryLines.join('\n') || 'No inactive players',
      inline: false
    },
    {
      name: 'Inactive Players',
      value:
        data.players
          .slice(0, 10)
          .map((player) => {
            const icon =
              player.daysInactive >= 7
                ? '🔴'
                : player.daysInactive >= 5
                  ? '🟠'
                  : '🟡'
            return `${icon} **${player.name}**: ${formatNumber(player.daysInactive)}d idle, ${formatNumber(player.warsMissed)} war${player.warsMissed !== 1 ? 's' : ''} missed`
          })
          .join('\n') || 'No inactive players',
      inline: false
    }
  ]

  if (data.players.length > 10) {
    fields.push({
      name: '',
      value: `...and ${formatNumber(data.players.length - 10)} more`,
      inline: false
    })
  }

  return {
    embeds: [
      buildEmbed({
        title: '⚠️ Inactivity Alert',
        description: `${formatNumber(data.totalPlayers)} player${data.totalPlayers !== 1 ? 's' : ''} with war inactivity detected`,
        color:
          data.criticalCount > 0
            ? EMBED_COLORS.error
            : data.warningCount > 0
              ? EMBED_COLORS.warning
              : EMBED_COLORS.info,
        fields,
        footerText: `${EMBED_FOOTER.text} • War Tracking`
      })
    ]
  }
}

export type TokenCapPlayer = {
  name: string
  tokens: number
  lastBattle?: string | null
}

export type TokenCapAlertOptions = {
  guildName?: string | null
  guildCode?: string | null
  manual?: boolean
}

export const formatTokenCapAlert = (
  players: TokenCapPlayer[],
  options: TokenCapAlertOptions = {}
): DiscordWebhookPayload => {
  const guildLabel = options.guildName || options.guildCode || 'Guild'
  const urgencyColor =
    players.length >= 10
      ? EMBED_COLORS.error
      : players.length >= 5
        ? EMBED_COLORS.warning
        : EMBED_COLORS.info
  const description =
    players.length >= 5
      ? '**Multiple players are at 3/3 tokens!**\nConsider coordinating attacks to maximize damage.'
      : `${formatNumber(players.length)} player(s) have maximum tokens.`

  const fields: DiscordEmbedField[] = [
    {
      name: '🔔 Capped Players',
      value: players
        .slice(0, 20)
        .map(
          (player) =>
            `• **${player.name}** - ${formatNumber(player.tokens)}/3 tokens`
        )
        .join('\n'),
      inline: false
    },
    {
      name: '📊 Summary',
      value: `**Total Capped:** ${formatNumber(players.length)} players\n**Action:** Coordinate attacks to use tokens`,
      inline: false
    }
  ]

  return {
    embeds: [
      buildEmbed({
        title: `⚠️ Token Cap Alert - ${guildLabel}`,
        description,
        color: urgencyColor,
        fields,
        footerText: options.manual ? 'Manual Check' : 'Automatic Detection'
      })
    ]
  }
}

export type AwardEntry = {
  title: string
  description?: string
  value?: string
  icon?: string
}

export type AwardsEmbedOptions = {
  season?: string | number
  title?: string
}

export type OverallLeaderboardEntry = {
  display_name: string
  total_damage: number
  battle_count: number
  guild_code: string
}

export type BossLeaderboardEntry = {
  display_name: string
  boss_name: string
  damage: number
}

export type PrimeLeaderboardEntry = {
  display_name: string
  prime1_damage?: number
  prime2_damage?: number
}

export type LeaderboardEmbedInput =
  | {
      type: 'overall_leaderboard'
      season: string
      data: OverallLeaderboardEntry[]
    }
  | { type: 'boss_leaderboard'; season: string; data: BossLeaderboardEntry[] }
  | { type: 'prime_leaderboard'; season: string; data: PrimeLeaderboardEntry[] }

export const formatLeaderboardEmbed = (
  payload: LeaderboardEmbedInput
): DiscordWebhookPayload => {
  if (payload.type === 'overall_leaderboard') {
    const fields: DiscordEmbedField[] = payload.data
      .slice(0, 10)
      .map((player, index) => ({
        name: `${index + 1}. ${player.display_name}`,
        value: `**Damage:** ${formatNumber(player.total_damage)}\n**Battles:** ${formatNumber(player.battle_count)}`,
        inline: true
      }))

    fields.push({
      name: '📊 Ranking Method',
      value:
        '**Performance Efficiency Algorithm**\nRankings based on % above/below cluster average\nFair comparison regardless of token usage',
      inline: false
    })

    return {
      embeds: [
        buildEmbed({
          title: `🏆 Overall Leaderboard - Season ${payload.season}`,
          description:
            'Top performers across all guilds using **Performance Efficiency** calculations',
          color: EMBED_COLORS.gold,
          fields,
          footerText: `${EMBED_FOOTER.text} | View detailed calculations on dashboard`
        })
      ]
    }
  }

  if (payload.type === 'boss_leaderboard') {
    const bosses = [
      ...new Set(payload.data.map((entry) => entry.boss_name))
    ].slice(0, 3)

    const fields: DiscordEmbedField[] = bosses.map((boss) => {
      const bossData = payload.data
        .filter((entry) => entry.boss_name === boss)
        .slice(0, 5)
      const playerList = bossData
        .map(
          (player, index) =>
            `${index + 1}. **${player.display_name}** - ${formatNumber(player.damage)}`
        )
        .join('\n')

      return {
        name: `⚔️ ${boss}`,
        value: playerList || 'No data',
        inline: false
      }
    })

    fields.push({
      name: '🔍 Deduplication Applied',
      value:
        'Only highest damage per unique team composition shown\nMultiple teams = multiple leaderboard entries',
      inline: false
    })

    return {
      embeds: [
        buildEmbed({
          title: `🎯 Boss Leaderboards - Season ${payload.season}`,
          description:
            'Top damage dealers per boss with **team composition deduplication**',
          color: EMBED_COLORS.error,
          fields,
          footerText: `${EMBED_FOOTER.text} | Full team details on dashboard`
        })
      ]
    }
  }

  const fields: DiscordEmbedField[] = payload.data
    .slice(0, 10)
    .map((player, index) => ({
      name: `${index + 1}. ${player.display_name}`,
      value: `**Prime 1:** ${player.prime1_damage != null ? formatNumber(player.prime1_damage) : 'N/A'}\n**Prime 2:** ${player.prime2_damage != null ? formatNumber(player.prime2_damage) : 'N/A'}`,
      inline: true
    }))

  return {
    embeds: [
      buildEmbed({
        title: `⚡ Prime Boss Leaderboard - Season ${payload.season}`,
        description: 'Top performers on Prime bosses',
        color: EMBED_COLORS.warning,
        fields
      })
    ]
  }
}
