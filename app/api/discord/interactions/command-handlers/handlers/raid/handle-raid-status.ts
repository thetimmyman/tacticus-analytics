import type { APIEmbedField } from 'discord-api-types/v10'
import { resolveVisibilityOptions } from '../../utils/visibility'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  resolveTheme,
  COLOR_PALETTE
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import {
  formatGuildLabel,
  resolveGuildContext
} from '../../utils/guild-resolution'
import {
  formatCompactNumber,
  formatList,
  chunkLinesIntoFields,
  formatLeaderboardLine,
  formatAvailabilityLine
} from '../../utils/formatting'
import { getCurrentSeason } from '../tokens/shared'
import { fetchGuildTokens } from '../tokens/fetch-guild-tokens'
import { buildChartUrl, DISCORD_CHART_ENDPOINTS } from '../../utils/charting'
import { fetchRaidStatusSummary } from './data'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

const formatTimestamp = (value: string | null) => {
  if (!value) return 'Unknown time'
  const timestamp = new Date(value).toISOString()
  return timestamp.replace('T', ' ').slice(0, 16)
}

export async function handleRaidStatusCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const requestedGuildOption = getOptionValue(
    interaction.data.options,
    'guild'
  ) as string | undefined
  const requestedSeasonOption = getOptionValue(
    interaction.data.options,
    'season'
  ) as string | undefined
  const detailed = Boolean(getOptionValue(interaction.data.options, 'detailed'))
  // Default PRIVATE: only an explicit public:true posts to the channel.
  const { isPublic, errorVisibility } = resolveVisibilityOptions(
    interaction.data.options,
    { defaultPublic: false }
  )

  const guildResolution = await resolveGuildContext(supabase, interaction, {
    requestedGuildOption,
    scope: 'tokens'
  })
  if (!guildResolution.ok) {
    return errorVisibility(guildResolution.response)
  }

  let requestedSeason = requestedSeasonOption
  if (!requestedSeason) {
    try {
      requestedSeason = await getCurrentSeason(supabase)
    } catch (error) {
      rethrowIfAppError(error)
      return errorVisibility(
        buildErrorResponse(
          'Unable to determine the current season. Please specify a season or try again later.'
        )
      )
    }
  }

  // The token section is optional, so its failure must not sink the summary.
  const [summaryResult, tokensResult] = await Promise.all([
    fetchRaidStatusSummary(supabase, {
      guild: guildResolution.guild.guildCode,
      guildLabel: formatGuildLabel(guildResolution.guild),
      season: requestedSeason,
      recentLimit: detailed ? 6 : 3,
      trendDays: 7
    }),
    fetchGuildTokens(
      supabase,
      guildResolution.guild.guildCode,
      requestedSeason,
      guildResolution.guild.clusterCode
    ).catch(() => ({
      ok: false as const,
      message: 'Token data unavailable'
    }))
  ])

  if (!summaryResult.ok) {
    return errorVisibility(buildErrorResponse(summaryResult.message))
  }

  const summary = summaryResult.summary
  // Display only; displayName stays raw as the sort/lookup key.
  const memberLabels = await getMemberLabelMap()
  const overviewLines = [
    `Season: ${summary.season}`,
    `Guild: ${summary.guildLabel}`,
    `Total damage: ${formatCompactNumber(summary.totalDamage, { decimals: 2 })}`,
    `Battles: ${summary.totalBattles}`,
    `Bombs: ${summary.totalBombs}`,
    `Active players: ${summary.activePlayers}`
  ]
  const fields: APIEmbedField[] = []

  if (tokensResult.ok) {
    const players = tokensResult.players
    const totalTokensAvailable = players.reduce(
      (sum, player) => sum + player.tokensAvailable,
      0
    )
    const totalBombsAvailable = players.reduce(
      (sum, player) => sum + player.bombsAvailable,
      0
    )
    const cappedPlayers = players.filter(
      (player) => player.tokensAvailable >= 3
    ).length

    overviewLines.push(
      `Tokens ready: ${totalTokensAvailable}`,
      `Bombs ready: ${totalBombsAvailable}`,
      `Capped players: ${cappedPlayers}`
    )

    const readinessPool = players.filter(
      (player) => player.tokensAvailable > 0 || player.bombsAvailable > 0
    )
    const sortedPlayers = [
      ...(readinessPool.length > 0 ? readinessPool : players)
    ].sort((a, b) => {
      if (a.tokensAvailable !== b.tokensAvailable) {
        return b.tokensAvailable - a.tokensAvailable
      }
      if (a.bombsAvailable !== b.bombsAvailable) {
        return b.bombsAvailable - a.bombsAvailable
      }
      return a.displayName.localeCompare(b.displayName)
    })

    const readinessLines = sortedPlayers.slice(0, 12).map((player) => {
      const bombReady = player.bombsAvailable > 0
      const bombStatus = bombReady
        ? 'Ready'
        : player.bombCooldown
          ? `Cooldown ${player.bombCooldown}`
          : 'Cooldown'
      return formatAvailabilityLine({
        displayName: resolveMemberLabel(player.displayName, memberLabels),
        tokensRemaining: player.tokensAvailable,
        tokenCapacity: 3,
        bombReady,
        bombStatus
      })
    })

    const readinessFields = chunkLinesIntoFields(
      'Raid Readiness',
      readinessLines
    )
    fields.push(...readinessFields)
  } else {
    fields.push({
      name: 'Raid Readiness',
      value: tokensResult.message
    })
  }

  fields.unshift({
    name: 'Overview',
    value: overviewLines.join('\n')
  })

  const topPlayerLines = summary.topPlayers.map((player, index) => {
    const activity = formatList(
      [
        player.battles > 0 ? `${player.battles} battles` : null,
        player.bombs > 0 ? `${player.bombs} bombs` : null
      ].filter(Boolean) as string[],
      { emptyLabel: 'No attempts logged' }
    )
    return formatLeaderboardLine(
      index + 1,
      player.name,
      `${formatCompactNumber(player.damage, { decimals: 2 })} damage`,
      activity
    )
  })

  fields.push({
    name: 'Top Players',
    value:
      topPlayerLines.length > 0
        ? topPlayerLines.join('\n')
        : 'No player data available.'
  })

  const topBossLines = summary.topBosses.map((boss, index) =>
    formatLeaderboardLine(
      index + 1,
      boss.name,
      `${formatCompactNumber(boss.damage, { decimals: 2 })} damage`,
      `${boss.hits} attempts`
    )
  )

  fields.push({
    name: 'Top Bosses',
    value:
      topBossLines.length > 0
        ? topBossLines.join('\n')
        : 'No boss data available.'
  })

  if (detailed) {
    const recentLines = summary.recentActivity.map((row) => {
      const when = formatTimestamp(row.timestamp)
      const damage = formatCompactNumber(row.damage, { decimals: 2 })
      const typeLabel = row.damageType === 'Bomb' ? 'Bomb' : 'Battle'
      return `${when} - ${row.name} vs ${row.bossName || 'Unknown'} (${typeLabel}) ${damage}`
    })

    fields.push({
      name: 'Recent Activity',
      value:
        recentLines.length > 0
          ? recentLines.join('\n')
          : 'No recent activity recorded.',
      inline: false
    })
  }

  const chartUrl = buildChartUrl(DISCORD_CHART_ENDPOINTS.raid, {
    guild: summary.guild,
    season: summary.season
  })

  const theme = resolveTheme(summary.guild)
  return createCommandResponse(theme, {
    title: `Raid Status - ${summary.guildLabel}`,
    description: detailed
      ? 'Raid availability with recent activity highlights.'
      : 'Raid availability snapshot.',
    color: COLOR_PALETTE.info,
    fields,
    footer: `Generated at ${new Date().toLocaleString()}`,
    useThemeAccent: false,
    imageUrl: chartUrl ?? undefined,
    ephemeral: !isPublic
  })
}
