import type { APIEmbedField } from 'discord-api-types/v10'
import { resolveVisibilityOptions } from '../../utils/visibility'
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
  formatLeaderboardLine
} from '../../utils/formatting'
import { getCurrentSeason } from '../tokens/shared'
import { buildChartUrl, DISCORD_CHART_ENDPOINTS } from '../../utils/charting'
import { fetchBossLeaderboardSummary } from './data'

const formatBossLabel = (entry: {
  name: string
  level: string
  loop: number
}) => `${entry.name} ${entry.level} L${entry.loop}`

export async function handleGuildStatsCommand(
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
  // Only an explicit public:true posts to the channel.
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
    } catch {
      return errorVisibility(
        buildErrorResponse(
          'Unable to determine the current season. Please specify a season or try again later.'
        )
      )
    }
  }

  const summaryResult = await fetchBossLeaderboardSummary(supabase, {
    guild: guildResolution.guild.guildCode,
    guildLabel: formatGuildLabel(guildResolution.guild),
    season: requestedSeason,
    limit: 10
  })

  if (!summaryResult.ok) {
    return errorVisibility(buildErrorResponse(summaryResult.message))
  }

  const summary = summaryResult.summary
  const overviewLines = [
    `Season: ${summary.season}`,
    `Guild: ${summary.guildLabel}`,
    `Total damage: ${formatCompactNumber(summary.totalDamage, { decimals: 2 })}`,
    `Battles logged: ${summary.totalAttempts}`,
    `Boss stages tracked: ${summary.uniqueBosses}`
  ]

  const leaderboardLines = summary.leaderboard.map((entry, index) =>
    formatLeaderboardLine(
      index + 1,
      formatBossLabel(entry),
      `${formatCompactNumber(entry.totalDamage, { decimals: 2 })} damage`,
      `avg ${formatCompactNumber(entry.averageDamage, { decimals: 2 })} over ${entry.attempts} hits`
    )
  )

  const fields: APIEmbedField[] = [
    {
      name: 'Overview',
      value: overviewLines.join('\n')
    },
    {
      name: 'Boss Leaderboard',
      value:
        leaderboardLines.length > 0
          ? leaderboardLines.join('\n')
          : 'No boss data available.'
    }
  ]

  const chartUrl = buildChartUrl(DISCORD_CHART_ENDPOINTS.boss, {
    guild: summary.guild,
    season: summary.season
  })

  const theme = resolveTheme(summary.guild)
  return createCommandResponse(theme, {
    title: `Boss Leaderboards - ${summary.guildLabel}`,
    description: 'Current season boss performance rankings.',
    color: COLOR_PALETTE.success,
    fields,
    footer: `Generated at ${new Date().toLocaleString()}`,
    useThemeAccent: false,
    imageUrl: chartUrl ?? undefined,
    ephemeral: !isPublic
  })
}
