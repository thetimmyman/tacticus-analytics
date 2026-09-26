import type { APIEmbedField } from 'discord-api-types/v10'
import { resolveVisibilityOptions } from '../../utils/visibility'
import { rethrowIfAppError } from '@/app/lib/errors/AppError'
import type { Supabase, CommandInteraction, CommandResponse } from '../../types'
import {
  createCommandResponse,
  buildErrorResponse,
  buildServerNotLinkedResponse,
  resolveTheme,
  COLOR_PALETTE
} from '../../utils/response-builder'
import { getOptionValue } from '../../utils/option-parser'
import {
  getLinkedGuilds,
  guildMatchesInput
} from '../../utils/guild-resolution'
import {
  formatCompactNumber,
  formatList,
  formatLeaderboardLine
} from '../../utils/formatting'
import { buildChartUrl, DISCORD_CHART_ENDPOINTS } from '../../utils/charting'
import { fetchPlayerStatsSummary, type PlayerStatsResult } from './data'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

export async function handlePlayerStatsCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  // Only /stats registers `public`, so /player-stats stays ephemeral.
  const { isPublic, errorVisibility } = resolveVisibilityOptions(
    interaction.data.options,
    { defaultPublic: false }
  )

  const linkedGuilds = await getLinkedGuilds(supabase, interaction.guild_id)
  if (linkedGuilds.length === 0) {
    return errorVisibility(buildServerNotLinkedResponse())
  }

  const playerName = (
    getOptionValue(interaction.data.options, 'player') as string | undefined
  )?.trim()
  if (!playerName) {
    return errorVisibility(buildErrorResponse('Please provide a player name.'))
  }

  const requestedGuild = getOptionValue(interaction.data.options, 'guild') as
    string | undefined
  const requestedSeason = getOptionValue(interaction.data.options, 'season') as
    string | undefined

  const requestedGuildCode = requestedGuild
    ? (linkedGuilds.find((guild) => guildMatchesInput(guild, requestedGuild))
        ?.guildCode ?? requestedGuild)
    : null

  let summaryResult: PlayerStatsResult
  try {
    summaryResult = await fetchPlayerStatsSummary(supabase, {
      playerName,
      season: requestedSeason,
      linkedGuilds: linkedGuilds.map((guild) => guild.guildCode),
      requestedGuild: requestedGuildCode
    })
  } catch (error) {
    rethrowIfAppError(error)
    return errorVisibility(
      buildErrorResponse(
        'Unable to determine the current season. Please specify a season or try again later.'
      )
    )
  }

  if (!summaryResult.ok) {
    return errorVisibility(buildErrorResponse(summaryResult.message))
  }

  const summary = summaryResult.summary
  // The chart URL `player` param stays raw (a DB lookup key).
  const memberLabels = await getMemberLabelMap()
  const overviewLines = [
    `Season: ${summary.season}`,
    `Guild: ${summary.guildLabel}`,
    `Total damage: ${formatCompactNumber(summary.totalDamage, { decimals: 2 })}`,
    `Battles: ${summary.totalBattles}`,
    `Bombs: ${summary.totalBombs}`,
    `Unique bosses: ${summary.uniqueBosses}`
  ]

  if (summary.topBoss) {
    overviewLines.push(
      `Top boss: ${summary.topBoss.name} (${formatCompactNumber(summary.topBoss.totalDamage, { decimals: 2 })} damage)`
    )
  }

  const bossLines = summary.bossBreakdown.slice(0, 8).map((boss, index) => {
    const attempts = formatList(
      [
        boss.battles > 0 ? `${boss.battles} battles` : null,
        boss.bombs > 0 ? `${boss.bombs} bombs` : null
      ].filter(Boolean) as string[],
      { emptyLabel: 'No attempts' }
    )
    return formatLeaderboardLine(
      index + 1,
      boss.name,
      `${formatCompactNumber(boss.totalDamage, { decimals: 2 })} damage`,
      attempts
    )
  })

  const highlightLines: string[] = []
  if (summary.biggestHit) {
    highlightLines.push(
      `Biggest hit: ${summary.biggestHit.bossName} (${formatCompactNumber(summary.biggestHit.value, { decimals: 2 })} damage)`
    )
  }
  if (summary.topBoss) {
    highlightLines.push(
      `Highest total: ${summary.topBoss.name} (${formatCompactNumber(summary.topBoss.totalDamage, { decimals: 2 })} damage)`
    )
  }

  const fields: APIEmbedField[] = [
    {
      name: 'Overview',
      value: overviewLines.join('\n')
    },
    {
      name: 'Boss Breakdown',
      value:
        bossLines.length > 0 ? bossLines.join('\n') : 'No boss data available.'
    }
  ]

  if (highlightLines.length > 0) {
    fields.push({
      name: 'Highlights',
      value: highlightLines.join('\n')
    })
  }

  const chartUrl = buildChartUrl(DISCORD_CHART_ENDPOINTS.player, {
    player: summary.displayName,
    guild: summary.guild,
    season: summary.season
  })

  const theme = resolveTheme(summary.guild)
  return createCommandResponse(theme, {
    title: `Player Stats - ${resolveMemberLabel(summary.displayName, memberLabels)}`,
    description: 'Current season raid performance snapshot.',
    color: COLOR_PALETTE.info,
    fields,
    footer: `Generated at ${new Date().toLocaleString()}`,
    useThemeAccent: false,
    imageUrl: chartUrl ?? undefined,
    ephemeral: !isPublic
  })
}
