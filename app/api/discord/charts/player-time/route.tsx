import { ImageResponse } from 'next/og'
import { serviceDb } from '@/app/lib/db'
import {
  fetchPlayerTimeSummary,
  formatHourLabel
} from '../../interactions/command-handlers/handlers/player/time-data'
import { BarChart, ChartFrame, DISCORD_CHART_SIZE } from '../chart-components'
import { withErrorHandler } from '@/app/lib/middleware/errorHandler'
import { getMemberLabelMap } from '@/app/lib/member-labels-server'
import { resolveMemberLabel } from '@/app/lib/member-labels'
import { cacheDiscordChart } from '../request-context'
import { verifyChartSignature } from '../signed-url'
import { guildHiddenResponse, resolveChartPrivacy } from '../privacy'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const PLAYER_TIME_ACCENT = '#22c55e'

export const GET = withErrorHandler(async (request: Request) => {
  const auth = verifyChartSignature(request)
  if (!auth.ok) return auth.response

  const { searchParams } = new URL(request.url)
  const player = searchParams.get('player')?.trim()
  const guild = searchParams.get('guild')?.trim()
  const season = searchParams.get('season')?.trim()

  if (!player) {
    return new Response('Missing player parameter', { status: 400 })
  }
  if (!guild) {
    return new Response('Missing guild parameter', { status: 400 })
  }

  const supabase = serviceDb()

  // Not routed through resolveDiscordGuildSeasonContext, so apply the privacy gate here.
  const privacy = await resolveChartPrivacy(supabase, guild)
  if (privacy.hideAll) return guildHiddenResponse()

  const memberLabels = await getMemberLabelMap()
  const summaryResult = await fetchPlayerTimeSummary(supabase, {
    playerName: player,
    linkedGuilds: [guild],
    requestedGuild: guild,
    requestedSeason: season || null
  })

  if (!summaryResult.ok) {
    return new Response(summaryResult.message, { status: 404 })
  }

  const summary = summaryResult.summary
  const chartData = summary.chartWindows.map((window) => ({
    label: formatHourLabel(window.hour),
    value: window.probability,
    displayValue: `${Math.round(window.probability * 100)}%`
  }))

  const subtitle = [
    `${privacy.playerLabel(resolveMemberLabel(summary.displayName, memberLabels))} - ${summary.guildLabel}`,
    summary.season
      ? `Season ${summary.season}`
      : `Last ${summary.lookbackDays} days`,
    summary.timezone
  ].join(' - ')

  return cacheDiscordChart(
    new ImageResponse(
      <ChartFrame
        title="Player high-activity windows"
        subtitle={subtitle}
        accentColor={PLAYER_TIME_ACCENT}
      >
        <BarChart
          data={chartData}
          accentColor={PLAYER_TIME_ACCENT}
          maxLabelWidth={120}
        />
      </ChartFrame>,
      DISCORD_CHART_SIZE
    )
  )
})
