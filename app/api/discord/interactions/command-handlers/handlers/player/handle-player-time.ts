import type { APIEmbedField } from 'discord-api-types/v10'
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
import { formatLeaderboardLine } from '../../utils/formatting'
import { buildChartUrl, DISCORD_CHART_ENDPOINTS } from '../../utils/charting'
import { fetchPlayerTimeSummary, formatHourLabel } from './time-data'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'

export async function handlePlayerTimeCommand(
  supabase: Supabase,
  interaction: CommandInteraction
): Promise<CommandResponse> {
  const linkedGuilds = await getLinkedGuilds(supabase, interaction.guild_id)
  if (linkedGuilds.length === 0) {
    return buildServerNotLinkedResponse()
  }

  const playerName = (
    getOptionValue(interaction.data.options, 'player') as string | undefined
  )?.trim()
  if (!playerName) {
    return buildErrorResponse('Please provide a player name.')
  }

  const requestedGuild = getOptionValue(interaction.data.options, 'guild') as
    string | undefined
  const requestedSeason = getOptionValue(interaction.data.options, 'season') as
    string | undefined
  const requestedGuildCode = requestedGuild
    ? (linkedGuilds.find((guild) => guildMatchesInput(guild, requestedGuild))
        ?.guildCode ?? requestedGuild)
    : null

  const summaryResult = await fetchPlayerTimeSummary(supabase, {
    playerName,
    linkedGuilds: linkedGuilds.map((guild) => guild.guildCode),
    requestedGuild: requestedGuildCode,
    requestedSeason: requestedSeason ?? null
  })

  if (!summaryResult.ok) {
    return buildErrorResponse(summaryResult.message)
  }

  const summary = summaryResult.summary
  // The chart URL `player` param stays raw (a DB lookup key).
  const memberLabels = await getMemberLabelMap()
  const yesNo = summary.withinOneHour ? 'Yes' : 'No'
  const timezoneLine = summary.timezoneFallbackReason
    ? `${summary.timezone} (${summary.timezoneFallbackReason} -> UTC fallback)`
    : summary.timezone

  const overviewLines = [
    `Scope: ${summary.scopeLabel}`,
    `Guild: ${summary.guildLabel}`,
    `Timezone: ${timezoneLine}`,
    `Local time now: ${summary.nowLocalTimeLabel} (${formatHourLabel(summary.nowLocalHour)})`,
    `Peak activity hour: ${formatHourLabel(summary.peakHour)} (${Math.round(summary.peakProbability * 100)}% of observed days)`,
    `Within +/-1 hour now: ${yesNo}`,
    `Distance to peak: ${summary.distanceToPeakHours} hour(s)`,
    `Observed days: ${summary.observedDays}`,
    `Events analyzed: ${summary.totalEvents}`
  ]

  const activityLines = summary.topActivityWindows.map((window, index) =>
    formatLeaderboardLine(
      index + 1,
      formatHourLabel(window.hour),
      `${Math.round(window.probability * 100)}%`,
      `${window.daysWithActivity}/${summary.observedDays} days`
    )
  )

  const fields: APIEmbedField[] = [
    {
      name: 'Overview',
      value: overviewLines.join('\n')
    },
    {
      name: 'Top Activity Windows',
      value:
        activityLines.length > 0
          ? activityLines.join('\n')
          : 'No activity windows available.'
    }
  ]

  const chartUrl = buildChartUrl(DISCORD_CHART_ENDPOINTS.playerTime, {
    player: summary.displayName,
    guild: summary.guild,
    season: summary.season
  })

  const theme = resolveTheme(summary.guild)
  const generatedAt = `${new Date().toISOString().replace('T', ' ').slice(0, 16)} UTC`
  return createCommandResponse(theme, {
    title: `Player Time - ${resolveMemberLabel(summary.displayName, memberLabels)}`,
    description:
      yesNo === 'Yes'
        ? 'Player is currently close to their typical high-activity window.'
        : 'Player is currently outside their typical high-activity window.',
    color: summary.withinOneHour
      ? COLOR_PALETTE.success
      : COLOR_PALETTE.warning,
    fields,
    footer: `Generated at ${generatedAt}`,
    useThemeAccent: false,
    imageUrl: chartUrl ?? undefined
  })
}
